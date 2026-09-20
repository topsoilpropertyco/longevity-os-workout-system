/**
 * Longevity OS — Progression & Prediction
 *
 * Estimates what Seth can lift today and decides when to add weight.
 * RESEARCH §6.4.
 *
 * Every number here is in TOTAL LOAD pounds, per the convention in types.ts.
 */

import { GOAL_BANDS, PROGRESSION } from './constants.js';
import type {
  Exercise,
  GoalMode,
  LoggedExercise,
  PredictionBand,
  ProgramStandard,
  ReadinessAssessment,
  SessionLog,
  SetLog,
} from './types.js';
import { clamp, iqr, linearTrend, median, round } from './util.js';

/** Epley: `1RM = w × (1 + r/30)`. Generous at high reps. */
export function epley(load: number, reps: number): number {
  return load * (1 + reps / 30);
}

/** Brzycki: `1RM = w × 36/(37 − r)`. Conservative at high reps. */
export function brzycki(load: number, reps: number): number {
  if (reps >= 37) return load;
  return load * (36 / (37 - reps));
}

/**
 * Averaged estimate. Only meaningful at or below 10 reps (PROGRESSION.max_reps_for_e1rm);
 * beyond that the two formulas diverge badly and the answer is a guess dressed up
 * as a number, so we return the honest thing and let the caller downweight it.
 */
export function estimateOneRepMax(load: number, reps: number): number {
  if (load <= 0 || reps <= 0) return 0;
  if (reps === 1) return round(load, 1);
  return round((epley(load, reps) + brzycki(load, reps)) / 2, 1);
}

/** Invert the estimate: the load that should be achievable for `reps` reps. */
export function loadForReps(oneRepMax: number, reps: number): number {
  if (oneRepMax <= 0 || reps <= 0) return 0;
  if (reps === 1) return round(oneRepMax, 1);
  const fromEpley = oneRepMax / (1 + reps / 30);
  const fromBrzycki = reps >= 37 ? oneRepMax : oneRepMax * ((37 - reps) / 36);
  return round((fromEpley + fromBrzycki) / 2, 1);
}

/** Every logged instance of one exercise, newest last. */
export function historyFor(exerciseId: string, history: SessionLog[]): { date: string; logged: LoggedExercise }[] {
  return history
    .filter((s) => s.completed)
    .flatMap((s) => s.exercises.filter((e) => e.exercise_id === exerciseId).map((logged) => ({ date: s.date, logged })))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Best e1RM in a single logged appearance, across its working sets. */
export function sessionE1rm(logged: LoggedExercise): number {
  const candidates = logged.sets
    .filter((s) => s.completed && s.reps > 0 && s.reps <= PROGRESSION.max_reps_for_e1rm && s.load_lb > 0)
    .map((s) => estimateOneRepMax(s.load_lb, s.reps));
  return candidates.length ? Math.max(...candidates) : 0;
}

/** e1RM per session for one exercise, oldest first. Zeros dropped. */
export function e1rmSeries(exerciseId: string, history: SessionLog[]): { date: string; e1rm: number }[] {
  return historyFor(exerciseId, history)
    .map(({ date, logged }) => ({ date, e1rm: sessionE1rm(logged) }))
    .filter((p) => p.e1rm > 0);
}

/** Current best estimate of an exercise's 1RM: the trend's value at the latest point. */
export function currentE1rm(exerciseId: string, history: SessionLog[]): number {
  const series = e1rmSeries(exerciseId, history);
  if (series.length === 0) return 0;
  if (series.length < 3) return round(Math.max(...series.map((p) => p.e1rm)), 1);
  const recent = series.slice(-8);
  const { slope, intercept } = linearTrend(recent.map((p) => p.e1rm));
  const projected = intercept + slope * (recent.length - 1);
  // Never project below what he has actually done recently.
  return round(Math.max(projected, median(recent.map((p) => p.e1rm))), 1);
}

/**
 * The three-part prediction band shown on every exercise card.
 *
 *   normal   — median ± IQR of recent e1RM, mapped to today's rep count
 *   probable — the linear trend, adjusted for readiness. What he should hit.
 *   max      — the e1RM-derived rep max. The honest ceiling, not a target.
 *
 * Confidence shrinks below three sessions of history and is zero on cold start,
 * where we fall back to a program standard as a percentage of bodyweight.
 */
export function predictionBand(args: {
  exerciseId: string;
  reps: number;
  history: SessionLog[];
  readiness: ReadinessAssessment;
  bodyweightLb: number;
  standard?: ProgramStandard;
}): PredictionBand {
  const { exerciseId, reps, history, readiness, bodyweightLb, standard } = args;
  const series = e1rmSeries(exerciseId, history);

  if (series.length === 0) {
    // Cold start. A program standard is a real number; anything else is a guess
    // we mark as such so the UI can say "first time — find your weight".
    if (standard?.pct_bodyweight) {
      const target = standard.pct_bodyweight * bodyweightLb * (standard.per_hand ? 2 : 1);
      return {
        normal: [round(target * 0.7, 1), round(target, 1)],
        probable: round(target * 0.8, 1),
        max: round(target * 1.1, 1),
        confidence: 0.3,
        basis: 'program_standard',
      };
    }
    return { normal: [0, 0], probable: 0, max: 0, confidence: 0, basis: 'cold_start' };
  }

  const recent = series.slice(-8).map((p) => p.e1rm);
  const [q1, q3] = iqr(recent);
  const e1rm = currentE1rm(exerciseId, history);

  const normalLow = loadForReps(q1, reps);
  const normalHigh = loadForReps(q3, reps);
  const probable = round(loadForReps(e1rm, reps) * readiness.load_multiplier, 1);
  const max = loadForReps(e1rm, reps);

  const n = series.length;
  const confidence = round(
    clamp(
      (n - 1) / (PROGRESSION.full_confidence_sessions - 1),
      n >= PROGRESSION.min_sessions_for_confidence ? 0.4 : 0.15,
      1,
    ),
    2,
  );

  return {
    normal: [round(Math.min(normalLow, normalHigh), 1), round(Math.max(normalLow, normalHigh), 1)],
    probable,
    max: round(max, 1),
    confidence,
    basis: 'history',
  };
}

/**
 * Double progression. Top of the rep range on every set, two sessions running,
 * earns the load bump — +5 lb upper, +10 lb lower, or the next dumbbell notch.
 */
export function doubleProgressionBump(args: {
  exerciseId: string;
  exercise: Exercise;
  history: SessionLog[];
  repRange: [number, number];
}): { bump: number; reason: string } {
  const { exerciseId, exercise, history, repRange } = args;
  const appearances = historyFor(exerciseId, history).slice(-PROGRESSION.sessions_at_top_before_load_bump);
  if (appearances.length < PROGRESSION.sessions_at_top_before_load_bump) {
    return { bump: 0, reason: '' };
  }

  const topReps = repRange[1];
  const allAtTop = appearances.every(({ logged }) => {
    const working = logged.sets.filter((s) => s.completed && !isWarmup(s));
    return working.length > 0 && working.every((s) => s.reps >= topReps);
  });

  if (!allAtTop) return { bump: 0, reason: '' };

  const isLower = ['squat', 'hinge', 'lunge', 'isolation_lower'].includes(exercise.pattern);
  const bump = isLower ? PROGRESSION.load_bump_lower_lb : PROGRESSION.load_bump_upper_lb;
  return {
    bump,
    reason: `You hit ${topReps} on every set twice running — up ${bump} lb.`,
  };
}

function isWarmup(s: SetLog): boolean {
  // Warm-ups are not flagged in the log type; infer them as light early sets.
  return s.set_index === 0 && s.reps > 12 && (s.rpe ?? 0) <= 5;
}

/**
 * Plateau detection for the dashboard: a flat or falling trend across the
 * plateau window, when the athlete has enough history for that to mean anything.
 */
export function detectPlateau(exerciseId: string, history: SessionLog[]): {
  plateaued: boolean;
  slopePerSession: number;
  sessions: number;
} {
  const series = e1rmSeries(exerciseId, history);
  const window = series.slice(-PROGRESSION.plateau_window_sessions);
  if (window.length < PROGRESSION.plateau_window_sessions) {
    return { plateaued: false, slopePerSession: 0, sessions: series.length };
  }
  const values = window.map((p) => p.e1rm);
  const { slope } = linearTrend(values);
  const base = median(values) || 1;
  const relative = slope / base;
  return {
    plateaued: relative <= PROGRESSION.plateau_threshold_pct,
    slopePerSession: round(slope, 2),
    sessions: series.length,
  };
}

/**
 * Prescribed sets and reps for an exercise under a goal mode, after readiness
 * and deload have had their say. Set count is clamped to at least one — a
 * prescription of zero sets is a scheduling decision, not a prescription.
 */
export function setsAndReps(args: {
  goal: GoalMode;
  readiness: ReadinessAssessment;
  isPrimary: boolean;
  deloadVolumeMultiplier: number;
}): { sets: number; reps: [number, number]; rpe: number; rest_s: number } {
  const band = GOAL_BANDS[args.goal];
  const baseSets = args.isPrimary ? band.sets[1] : band.sets[0];
  const withReadiness = baseSets + (args.isPrimary ? args.readiness.set_delta : 0);
  const sets = Math.max(1, Math.round(withReadiness * args.deloadVolumeMultiplier));

  let rpe = args.isPrimary ? band.rpe[1] : band.rpe[0];
  if (args.readiness.rpe_cap) rpe = Math.min(rpe, args.readiness.rpe_cap);

  return { sets, reps: band.reps, rpe, rest_s: band.rest_s };
}
