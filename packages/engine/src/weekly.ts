/**
 * Longevity OS — Weekly Dose Accounting
 *
 * What has actually been done this week, measured against the evidence targets
 * in RESEARCH §6.1. The template stage reads this to decide what is missing.
 */

import { WEEKLY } from './constants.js';
import type { CardioLog, Exercise, SessionLog, WeeklyDose } from './types.js';
import { round, sum, withinDays } from './util.js';
import { zone2Ceiling, zone2MinutesLast7 } from './cardio.js';

/** Tonnage in pounds: every completed rep × its total load. */
export function tonnage(sessions: SessionLog[]): number {
  return round(
    sum(
      sessions.flatMap((s) =>
        s.exercises.flatMap((e) => e.sets.filter((set) => set.completed).map((set) => set.reps * set.load_lb)),
      ),
    ),
    0,
  );
}

/** Ground contacts logged in a window, for the plyometric volume rule. */
export function plyoContacts(sessions: SessionLog[], exercises: Exercise[]): number {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  return round(
    sum(
      sessions.flatMap((s) =>
        s.exercises.flatMap((e) => {
          const ex = byId.get(e.exercise_id);
          if (!ex || ex.plyo_contacts_per_rep <= 0) return [0];
          return e.sets.filter((set) => set.completed).map((set) => set.reps * ex.plyo_contacts_per_rep);
        }),
      ),
    ),
    0,
  );
}

/** The full weekly picture, anchored on the trailing 7 days ending today. */
export function weeklyDose(args: {
  today: string;
  history: SessionLog[];
  cardioHistory: CardioLog[];
  exercises: Exercise[];
  ouraSteps?: number[];
}): WeeklyDose {
  const { today, history, cardioHistory, exercises, ouraSteps } = args;
  const week = history.filter((s) => withinDays(s.date, today, 7) && s.completed);

  const strengthMin = round(
    sum(week.filter((s) => s.type === 'strength' || s.type === 'kot' || s.type === 'power').map((s) => s.duration_min)),
    0,
  );

  return {
    zone2_min: zone2MinutesLast7(cardioHistory, today),
    zone2_target_min: WEEKLY.zone2_target_min,
    zone2_ceiling_min: zone2Ceiling(cardioHistory, today),
    vo2_sessions: week.filter((s) => s.type === 'vo2').length,
    strength_min: strengthMin,
    strength_target_min: WEEKLY.strength_min_range,
    mobility_sessions: week.filter((s) => s.type === 'mobility' || s.type === 'recovery').length,
    plyo_contacts: plyoContacts(week, exercises),
    tonnage_lb: tonnage(week),
    sessions: week.length,
    steps_avg: ouraSteps && ouraSteps.length ? round(sum(ouraSteps) / ouraSteps.length, 0) : undefined,
  };
}

/** Sessions of a given type in the trailing 7 days. */
export function countThisWeek(history: SessionLog[], today: string, type: SessionLog['type']): number {
  return history.filter((s) => withinDays(s.date, today, 7) && s.completed && s.type === type).length;
}

/**
 * How badly each dose is behind, 0 (met) to 1 (nothing done). Drives the
 * template's priority ordering: the biggest deficit gets today.
 */
export function deficits(dose: WeeklyDose): Record<'zone2' | 'vo2' | 'strength' | 'mobility' | 'kot', number> {
  const zone2Goal = Math.min(dose.zone2_ceiling_min, dose.zone2_target_min);
  return {
    zone2: clampDeficit(1 - dose.zone2_min / Math.max(zone2Goal, 1)),
    vo2: clampDeficit(1 - dose.vo2_sessions / WEEKLY.vo2_sessions),
    strength: clampDeficit(1 - dose.strength_min / WEEKLY.strength_min_range[0]),
    mobility: clampDeficit(1 - dose.mobility_sessions / WEEKLY.mobility_sessions_min),
    // KOT is counted by the caller against program progress; default to neutral.
    kot: 0.5,
  };
}

function clampDeficit(n: number): number {
  return round(Math.min(1, Math.max(0, n)), 3);
}
