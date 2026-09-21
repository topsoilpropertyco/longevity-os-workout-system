/**
 * Longevity OS — Fixture Days
 *
 * The five scenarios PRD §9 requires the engine to be pinned against:
 * high readiness, low readiness, injury flare, 15 minutes at home, and
 * 90 minutes at Planet Fitness.
 *
 * Every fixture is a complete `PlanInput`, so a test can call `plan(fixture)`
 * and assert on the whole result. Dates are fixed so nothing depends on when
 * the suite runs.
 */

import type {
  BodyMetric,
  CardioLog,
  OuraDaily,
  PlanInput,
  SelfReport,
  SessionLog,
  ZoneMinutes,
} from '../src/types.js';
import { addDays } from '../src/util.js';
import {
  BASELINE_INJURIES,
  BODYWEIGHT_ONLY,
  DEFAULT_GOALS,
  EXERCISES,
  HOME,
  KOT,
  PLANET_FITNESS,
  SETH,
} from './library.js';

/** Tuesday. The definition of done in CLAUDE.md is written about a Tuesday. */
export const TODAY = '2026-09-22';

function zones(z2: number, z4 = 0): ZoneMinutes {
  return { z1: 5, z2, z3: 2, z4, z5: 0 };
}

/** 28 nights of Oura, parameterised so each fixture can bend the trend. */
function ouraHistory(opts: {
  readiness: number;
  hrv: number;
  /** Multiply the last 7 nights' HRV by this, to simulate a suppressed week. */
  recentHrvFactor?: number;
} ): OuraDaily[] {
  const out: OuraDaily[] = [];
  for (let i = 28; i >= 1; i--) {
    const date = addDays(TODAY, -i);
    const recent = i <= 7;
    out.push({
      date,
      readiness_score: opts.readiness + ((i % 5) - 2),
      sleep_score: 78 + ((i % 4) - 2),
      activity_score: 80,
      hrv_ms: Math.round(opts.hrv * (recent ? (opts.recentHrvFactor ?? 1) : 1) + ((i % 3) - 1)),
      resting_hr: 54,
      steps: 7500,
      vo2max: 42.5,
      cardiovascular_age: 31,
    });
  }
  return out;
}

/** A plausible four weeks of training: KOT twice a week, strength twice, walks. */
function trainingHistory(): SessionLog[] {
  const out: SessionLog[] = [];
  for (let week = 4; week >= 1; week--) {
    const monday = addDays(TODAY, -(week * 7));
    out.push({
      id: `s-${monday}-kot`,
      date: monday,
      type: 'kot',
      location_id: HOME.id,
      duration_min: 35,
      completed: true,
      exercises: [
        { exercise_id: 'backward-walk', sets: [{ set_index: 0, reps: 0, load_lb: 0, duration_s: 600, completed: true }] },
        { exercise_id: 'tibialis-raise', sets: setsOf(3, 25, 0, 6) },
        { exercise_id: 'atg-split-squat', sets: setsOf(3, 5, 50 + (4 - week) * 5, 7) },
      ],
    });
    out.push({
      id: `s-${addDays(monday, 2)}-strength`,
      date: addDays(monday, 2),
      type: 'strength',
      location_id: HOME.id,
      duration_min: 40,
      completed: true,
      exercises: [
        { exercise_id: 'db-bench-press', sets: setsOf(3, 10, 120 + (4 - week) * 5, 8) },
        { exercise_id: 'db-row', sets: setsOf(3, 10, 60 + (4 - week) * 5, 8) },
        { exercise_id: 'db-rdl', sets: setsOf(3, 10, 140 + (4 - week) * 5, 8) },
      ],
    });
  }
  return out;
}

function setsOf(count: number, reps: number, load: number, rpe: number) {
  return Array.from({ length: count }, (_, i) => ({
    set_index: i,
    reps,
    load_lb: load,
    rpe: rpe as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
    completed: true,
  }));
}

function cardioHistory(weeklyZone2Min: number): CardioLog[] {
  const out: CardioLog[] = [];
  for (let week = 3; week >= 1; week--) {
    for (let n = 0; n < 2; n++) {
      const date = addDays(TODAY, -(week * 7) + n);
      out.push({
        date,
        modality: 'walk',
        duration_min: weeklyZone2Min / 2,
        distance_mi: 1.8,
        avg_hr: 118,
        max_hr: 132,
        zone_minutes: zones(weeklyZone2Min / 2),
        source: 'strava',
      });
    }
  }
  return out;
}

const BODY: BodyMetric[] = [
  { date: addDays(TODAY, -14), weight_lb: 207, body_fat_pct: 21.4, source: 'manual' },
  { date: addDays(TODAY, -7), weight_lb: 206, body_fat_pct: 21.1, source: 'manual' },
  { date: addDays(TODAY, -1), weight_lb: 205, body_fat_pct: 20.8, source: 'manual' },
];

function reports(soreness: 1 | 2 | 3 | 4 | 5, energy: 1 | 2 | 3 | 4 | 5, stress: 1 | 2 | 3 | 4 | 5, days = 5): SelfReport[] {
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(TODAY, -(days - 1 - i)),
    soreness,
    energy,
    stress,
  }));
}

function base(): PlanInput {
  return {
    today: TODAY,
    athlete: SETH,
    goals: { ...DEFAULT_GOALS },
    budget_min: 45,
    location: HOME,
    all_locations: [HOME, PLANET_FITNESS, BODYWEIGHT_ONLY],
    oura_history: ouraHistory({ readiness: 78, hrv: 60 }),
    recent_self_reports: reports(4, 4, 2),
    history: trainingHistory(),
    cardio_history: cardioHistory(50),
    injuries: BASELINE_INJURIES.map((i) => ({ ...i })),
    body_metrics: BODY,
    program: KOT,
    exercises: EXERCISES,
    seed: 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The five fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Readiness 92, HRV above baseline, 45 min at home. The engine should push. */
export const HIGH_READINESS: PlanInput = {
  ...base(),
  oura_today: {
    date: TODAY, readiness_score: 92, sleep_score: 88, hrv_ms: 72, resting_hr: 51,
    steps: 8200, vo2max: 42.5, cardiovascular_age: 31,
  },
  self_report: { date: TODAY, soreness: 5, energy: 5, stress: 1 },
};

/** Readiness 48 and HRV 18% down. The engine must convert this to recovery. */
export const LOW_READINESS: PlanInput = {
  ...base(),
  oura_history: ouraHistory({ readiness: 62, hrv: 60, recentHrvFactor: 0.82 }),
  oura_today: {
    date: TODAY, readiness_score: 48, sleep_score: 54, hrv_ms: 47, resting_hr: 61,
    steps: 4100, vo2max: 42.1, cardiovascular_age: 32,
  },
  self_report: { date: TODAY, soreness: 2, energy: 2, stress: 4 },
  recent_self_reports: reports(2, 2, 4),
};

/** Knee pain at 7/10. Nothing heavy may go through the knee — but KOT may. */
export const INJURY_FLARE: PlanInput = {
  ...base(),
  oura_today: { date: TODAY, readiness_score: 76, sleep_score: 80, hrv_ms: 61, resting_hr: 54 },
  self_report: { date: TODAY, soreness: 3, energy: 4, stress: 2 },
  injuries: [
    { ...BASELINE_INJURIES[0]!, current_pain: 7 },
    { ...BASELINE_INJURIES[1]!, current_pain: 3 },
  ],
};

/** Fifteen minutes, at home, on an ordinary day. Supersets, no fluff. */
export const FIFTEEN_MIN_HOME: PlanInput = {
  ...base(),
  budget_min: 15,
  location: HOME,
  goals: { ...DEFAULT_GOALS, warmup_outside_budget: false, warmup_min: 3, cooldown_min: 2 },
  oura_today: { date: TODAY, readiness_score: 77, sleep_score: 79, hrv_ms: 60, resting_hr: 54 },
  self_report: { date: TODAY, soreness: 3, energy: 4, stress: 2 },
};

/** Ninety minutes at Planet Fitness. No barbell exists here — not one. */
export const NINETY_MIN_PF: PlanInput = {
  ...base(),
  budget_min: 90,
  location: PLANET_FITNESS,
  goals: { ...DEFAULT_GOALS, mode: 'bulk' },
  oura_today: { date: TODAY, readiness_score: 81, sleep_score: 84, hrv_ms: 64, resting_hr: 52 },
  self_report: { date: TODAY, soreness: 4, energy: 4, stress: 2 },
};

/** A sixth, for the cold-start path: no history, no Oura, no sliders. */
export const COLD_START: PlanInput = {
  ...base(),
  history: [],
  cardio_history: [],
  oura_history: [],
  recent_self_reports: [],
  oura_today: undefined,
  self_report: undefined,
  body_metrics: [],
  program: undefined,
  budget_min: 30,
};

export const ALL_FIXTURES: Record<string, PlanInput> = {
  high_readiness: HIGH_READINESS,
  low_readiness: LOW_READINESS,
  injury_flare: INJURY_FLARE,
  fifteen_min_home: FIFTEEN_MIN_HOME,
  ninety_min_pf: NINETY_MIN_PF,
  cold_start: COLD_START,
};

export { HOME, PLANET_FITNESS, BODYWEIGHT_ONLY, EXERCISES, KOT, SETH, BASELINE_INJURIES };

/**
 * The worked example in `docs/ENGINE.md`: a Tuesday, 30 minutes, at home, with
 * readiness 72. The doc walks this input through the pipeline stage by stage.
 *
 * It lives here as a fixture so the documentation and the engine cannot drift
 * apart silently — `test/golden.test.ts` asserts the doc's stated outcomes.
 */
export const DOCS_WORKED_EXAMPLE: PlanInput = {
  ...base(),
  budget_min: 30,
  location: HOME,
  // The doc's stated setup: Sunday was a 25-minute Zone 2 bike, MONDAY a
  // 45-minute lower-body KOT day. Monday is what puts the knees 24 hours into a
  // 48-hour window on Tuesday, which is the point the example is making — at 48
  // hours exactly they would be free and the ledger would teach nothing.
  history: [
    ...base().history,
    {
      id: 'mon-kot', date: addDays(TODAY, -1), type: 'kot', location_id: HOME.id,
      duration_min: 45, completed: true,
      exercises: [
        { exercise_id: 'backward-walk', sets: [{ set_index: 0, reps: 0, load_lb: 0, duration_s: 600, completed: true }] },
        { exercise_id: 'tibialis-raise', sets: [{ set_index: 0, reps: 25, load_lb: 0, rpe: 7, completed: true }] },
        { exercise_id: 'atg-split-squat', sets: [
          { set_index: 0, reps: 5, load_lb: 70, rpe: 9, completed: true },
          { set_index: 1, reps: 5, load_lb: 70, rpe: 9, completed: true },
          { set_index: 2, reps: 5, load_lb: 70, rpe: 9, completed: true },
        ] },
        { exercise_id: 'db-rdl', sets: [
          { set_index: 0, reps: 8, load_lb: 160, rpe: 8, completed: true },
          { set_index: 1, reps: 8, load_lb: 160, rpe: 8, completed: true },
        ] },
      ],
    },
  ],
  cardio_history: [
    ...base().cardio_history,
    {
      date: addDays(TODAY, -2), modality: 'bike', duration_min: 25, avg_hr: 121,
      zone_minutes: { z1: 3, z2: 22, z3: 0, z4: 0, z5: 0 }, source: 'strava',
    },
  ],
  oura_today: {
    date: TODAY, readiness_score: 72, sleep_score: 76, hrv_ms: 60, resting_hr: 55,
    steps: 6800, vo2max: 42.5, cardiovascular_age: 31,
  },
  // No self-report: with Oura present the sliders collapse to a small edit
  // affordance in the UI, and the doc's "readiness 72" is the ring's number.
  // Supplying sliders here would blend them in and the doc would read wrong.
  self_report: undefined,
};
