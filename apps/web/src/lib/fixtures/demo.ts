/**
 * Demo athlete state.
 *
 * FIXTURE DATA ONLY. `loadPlanInput()` returns this whenever Supabase is not
 * configured, so every screen renders realistically on a cold clone. Series are
 * generated from a seeded PRNG so server and client agree (no hydration drift)
 * and screenshots are stable.
 */

import type {
  Athlete,
  BodyMetric,
  CardioLog,
  Equipment,
  GoalSettings,
  GymLocation,
  Injury,
  LocationEquipmentSpec,
  OuraDaily,
  PlanInput,
  Program,
  ProgramProgress,
  SelfReport,
  SessionLog,
  Slider1to5,
} from '../engine-bridge';
import { addDays } from '../format';
import { DEMO_EXERCISES } from './library';

export const DEMO_USER_ID = 'demo-seth';

/** Deterministic PRNG — same inputs, same fixtures, every render. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const DEMO_ATHLETE: Athlete = {
  user_id: DEMO_USER_ID,
  birth_date: '1992-03-14',
  height_in: 75,
  bodyweight_lb: 214.2,
  hr_max: 188,
  hr_max_source: 'measured_strava',
  resting_hr: 52,
  standing_reach_in: 100,
};

export const DEMO_GOALS: GoalSettings = {
  mode: 'maintain',
  vertical_jump_focus: true,
  warmup_min: 6,
  cooldown_min: 5,
  warmup_outside_budget: true,
};

// ───────────────────────────── Locations ─────────────────────────────

function equip(list: [Equipment, Partial<LocationEquipmentSpec>?][]): LocationEquipmentSpec[] {
  return list.map(([equipment, extra]) => ({ equipment, available: true, ...(extra ?? {}) }));
}

export const HOME_LOCATION: GymLocation = {
  id: 'loc-home',
  user_id: DEMO_USER_ID,
  name: 'Home',
  kind: 'home',
  bar_weight_lb: 0,
  smith_bar_weight_lb: 20,
  overhead_min: 0,
  equipment: equip([
    ['bodyweight'],
    ['adjustable_dumbbell', { min_lb: 5, max_lb: 52.5, increment_lb: 2.5, notes: 'Bowflex pair — log both hands' }],
    ['bench_adjustable', { notes: 'Flat / incline with Nordic support' }],
    ['nordic_support'],
    ['pull_up_bar'],
    ['resistance_bands'],
    ['yoga_mat'],
    ['foam_roller'],
    ['slant_board'],
    ['wall_space'],
    ['outdoor_route'],
    ['track_or_open_space'],
    ['jump_rope'],
  ]),
};

export const PF_LOCATION: GymLocation = {
  id: 'loc-pf-24',
  user_id: DEMO_USER_ID,
  name: 'Planet Fitness — 8 Mile',
  kind: 'planet_fitness',
  bar_weight_lb: 0,
  smith_bar_weight_lb: 20,
  overhead_min: 12,
  equipment: equip([
    ['bodyweight'],
    ['dumbbell', { min_lb: 5, max_lb: 75, increment_lb: 5 }],
    ['fixed_barbell', { min_lb: 20, max_lb: 70, increment_lb: 10 }],
    ['ez_curl_bar'],
    ['smith_machine', { notes: 'Counterbalanced — effective bar ≈ 20 lb' }],
    ['bench_flat'],
    ['bench_adjustable'],
    ['cable_machine'],
    ['functional_trainer'],
    ['lat_pulldown'],
    ['seated_row'],
    ['chest_press_machine'],
    ['shoulder_press_machine'],
    ['leg_press'],
    ['leg_extension'],
    ['leg_curl'],
    ['hip_abductor_adductor'],
    ['calf_machine'],
    ['back_extension_bench'],
    ['ab_crunch_machine'],
    ['pec_deck'],
    ['assisted_pullup_machine'],
    ['treadmill'],
    ['elliptical'],
    ['arc_trainer'],
    ['stair_climber'],
    ['stationary_bike'],
    ['recumbent_bike'],
    ['rower'],
    ['medicine_ball'],
    ['stability_ball'],
    ['yoga_mat'],
    ['wall_space'],
  ]),
};

export const BOX_LOCATION: GymLocation = {
  id: 'loc-box',
  user_id: DEMO_USER_ID,
  name: 'CrossFit box',
  kind: 'crossfit_box',
  bar_weight_lb: 45,
  smith_bar_weight_lb: 45,
  overhead_min: 15,
  equipment: equip([
    ['bodyweight'],
    ['barbell'],
    ['bumper_plates'],
    ['power_rack'],
    ['dumbbell', { min_lb: 10, max_lb: 100, increment_lb: 5 }],
    ['kettlebell'],
    ['pull_up_bar'],
    ['rings'],
    ['ghd'],
    ['plyo_box'],
    ['rower'],
    ['assault_bike'],
    ['ski_erg'],
    ['sled'],
    ['jump_rope'],
    ['medicine_ball'],
    ['slam_ball'],
    ['chalk'],
    ['wall_space'],
  ]),
};

export const TRAVEL_LOCATION: GymLocation = {
  id: 'loc-travel',
  user_id: DEMO_USER_ID,
  name: 'Bodyweight only',
  kind: 'bodyweight_only',
  bar_weight_lb: 0,
  smith_bar_weight_lb: 20,
  overhead_min: 0,
  equipment: equip([['bodyweight'], ['yoga_mat'], ['wall_space'], ['outdoor_route'], ['track_or_open_space']]),
};

export const DEMO_LOCATIONS: GymLocation[] = [HOME_LOCATION, PF_LOCATION, BOX_LOCATION, TRAVEL_LOCATION];

/** The four clonable presets from PRD §8.3. */
export const LOCATION_PRESETS: { key: string; name: string; note: string; template: GymLocation }[] = [
  { key: 'home', name: 'Home', note: 'Adjustable DBs, bench, pull-up bar, bands', template: HOME_LOCATION },
  {
    key: 'planet_fitness',
    name: 'Planet Fitness — standard',
    note: 'No barbells or racks · Smith bar ≈ 20 lb · full selectorized line',
    template: PF_LOCATION,
  },
  { key: 'crossfit_box', name: 'CrossFit box — typical', note: 'Barbells, rig, ergs, sled', template: BOX_LOCATION },
  { key: 'bodyweight_only', name: 'Bodyweight only', note: 'Travel — a mat and a wall', template: TRAVEL_LOCATION },
];

// ───────────────────────────── Injuries ─────────────────────────────

export const DEMO_INJURIES: Injury[] = [
  {
    id: 'inj-knees',
    region: 'knees_quads',
    label: 'Both knees — anterior, patellar',
    onset: '2019-06-01',
    kind: 'longstanding',
    current_pain: 3,
    aggravators: ['Deep squats under load', 'Running downhill', 'Long sitting'],
    notes: 'The reason KOT is the active program. Tibialis and ATG work keeps it quiet.',
  },
  {
    id: 'inj-low-back',
    region: 'low_back',
    label: 'Low back — right-side flexion intolerance',
    onset: '2023-11-12',
    kind: 'longstanding',
    current_pain: 2,
    aggravators: ['Loaded spinal flexion', 'Morning deadlifts', 'Sitting > 60 min'],
    notes: 'McGill Big 3 daily. Hinge pattern progresses only when pain sits ≤ 2 for a week.',
  },
];

// ───────────────────────────── Oura / body / history ─────────────────────────────

export function demoOuraHistory(today: string, days = 28): OuraDaily[] {
  const rand = mulberry32(seedFromString(`oura-${today}`));
  const out: OuraDaily[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const wobble = rand();
    const readiness = Math.round(66 + wobble * 22 + (i % 7 === 0 ? -6 : 0));
    out.push({
      date,
      readiness_score: readiness,
      sleep_score: Math.round(62 + rand() * 30),
      activity_score: Math.round(70 + rand() * 22),
      hrv_ms: Math.round(48 + rand() * 24),
      resting_hr: Math.round(49 + rand() * 6),
      body_temp_deviation_c: Math.round((rand() * 0.6 - 0.3) * 100) / 100,
      respiratory_rate: Math.round((14 + rand() * 1.6) * 10) / 10,
      steps: Math.round(6200 + rand() * 6400),
      active_calories: Math.round(420 + rand() * 380),
      met_minutes: Math.round(320 + rand() * 240),
      vo2max: Math.round((44.1 + (days - i) * 0.02 + rand() * 0.4) * 10) / 10,
      cardiovascular_age: Math.round(30 - rand() * 2),
      stress_high_min: Math.round(30 + rand() * 90),
      resilience: readiness > 82 ? 'strong' : readiness > 72 ? 'solid' : 'adequate',
    });
  }
  return out;
}

export function demoSelfReports(today: string, days = 14): SelfReport[] {
  const rand = mulberry32(seedFromString(`self-${today}`));
  const pick = (): Slider1to5 => (Math.floor(rand() * 3) + 3) as Slider1to5;
  const out: SelfReport[] = [];
  for (let i = days - 1; i >= 1; i -= 1) {
    out.push({ date: addDays(today, -i), soreness: pick(), energy: pick(), stress: (pick() - 1) as Slider1to5 });
  }
  return out;
}

export function demoBodyMetrics(today: string, weeks = 12): BodyMetric[] {
  const rand = mulberry32(seedFromString(`body-${today}`));
  const out: BodyMetric[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    out.push({
      date: addDays(today, -i * 7),
      weight_lb: Math.round((218.4 - (weeks - 1 - i) * 0.35 + (rand() - 0.5) * 1.2) * 10) / 10,
      body_fat_pct: Math.round((22.6 - (weeks - 1 - i) * 0.12 + (rand() - 0.5) * 0.4) * 10) / 10,
      source: 'manual',
    });
  }
  return out;
}

const HISTORY_SHAPES: { type: SessionLog['type']; exercises: string[]; minutes: number }[] = [
  { type: 'strength', exercises: ['goblet_squat', 'db_rdl', 'db_bench_press', 'db_row'], minutes: 45 },
  { type: 'kot', exercises: ['tibialis_raise', 'atg_split_squat', 'patrick_step', 'reverse_nordic'], minutes: 30 },
  { type: 'zone2', exercises: [], minutes: 42 },
  { type: 'strength', exercises: ['db_incline_press', 'lat_pulldown', 'db_shoulder_press', 'farmer_carry'], minutes: 40 },
  { type: 'mobility', exercises: ['couch_stretch', 'ninety_ninety_hip', 'bird_dog'], minutes: 18 },
  { type: 'vo2', exercises: [], minutes: 32 },
  { type: 'recovery', exercises: ['mcgill_curl_up', 'side_plank', 'bird_dog'], minutes: 15 },
];

export function demoHistory(today: string, days = 28): SessionLog[] {
  const rand = mulberry32(seedFromString(`hist-${today}`));
  const out: SessionLog[] = [];
  for (let i = days; i >= 1; i -= 1) {
    const date = addDays(today, -i);
    const shape = HISTORY_SHAPES[i % HISTORY_SHAPES.length];
    if (!shape) continue;
    if (rand() < 0.1) continue; // a missed day, because life
    const progress = (days - i) / days;
    out.push({
      id: `sess-${date}`,
      date,
      type: shape.type,
      location_id: i % 3 === 0 ? PF_LOCATION.id : HOME_LOCATION.id,
      duration_min: shape.minutes,
      completed: true,
      exercises: shape.exercises.map((slug) => {
        const base = baseLoadFor(slug);
        const load = Math.round((base * (0.9 + progress * 0.14 + rand() * 0.04)) / 2.5) * 2.5;
        return {
          exercise_id: slug,
          sets: [0, 1, 2].map((set_index) => ({
            set_index,
            reps: 8,
            load_lb: load,
            rpe: (7 + (set_index === 2 ? 1 : 0)) as SessionLog['exercises'][number]['sets'][number]['rpe'],
            completed: true,
          })),
        };
      }),
    });
  }
  return out;
}

export function baseLoadFor(slug: string): number {
  const table: Record<string, number> = {
    goblet_squat: 70,
    db_rdl: 105,
    db_bench_press: 95,
    db_incline_press: 80,
    db_row: 55,
    lat_pulldown: 130,
    seated_cable_row: 125,
    db_shoulder_press: 60,
    atg_split_squat: 30,
    bulgarian_split_squat: 60,
    smith_squat: 135,
    leg_press: 250,
    farmer_carry: 105,
    db_thruster: 60,
    chest_press_machine: 120,
    leg_curl_machine: 90,
    calf_raise: 60,
  };
  return table[slug] ?? 0;
}

export function demoCardio(today: string, days = 28): CardioLog[] {
  const rand = mulberry32(seedFromString(`cardio-${today}`));
  const out: CardioLog[] = [];
  for (let i = days; i >= 1; i -= 1) {
    if (i % 3 !== 0) continue;
    const date = addDays(today, -i);
    const isVo2 = i % 9 === 0;
    const duration = isVo2 ? 32 : Math.round(34 + rand() * 20);
    out.push({
      date,
      modality: isVo2 ? 'bike' : i % 6 === 0 ? 'ruck' : 'walk',
      duration_min: duration,
      distance_mi: Math.round((duration / 17) * 100) / 100,
      avg_hr: isVo2 ? 158 : Math.round(118 + rand() * 10),
      max_hr: isVo2 ? 179 : Math.round(138 + rand() * 8),
      zone_minutes: isVo2
        ? { z1: 6, z2: 8, z3: 4, z4: 12, z5: 2 }
        : { z1: 8, z2: Math.max(0, duration - 12), z3: 4, z4: 0, z5: 0 },
      source: 'strava',
      strava_activity_id: `demo-${date}`,
    });
  }
  return out;
}

// ───────────────────────────── Program (KOT) ─────────────────────────────

export const DEMO_PROGRAM: Program = {
  slug: 'kot',
  name: 'Knees Over Toes',
  description:
    'Ground-up knee resilience. Every session starts at the ankle and works up; standards are expressed as a fraction of bodyweight.',
  ordering: 'ground_up',
  days_per_week: [2, 3],
  target_cycles: 2,
  source: 'docs/programs/kot/raw — Seth’s spreadsheets',
  attribution: 'Knees Over Toes Guy — Ben Patrick',
  blocks: [
    { id: 'blk-ankle', name: 'Ankle & tibialis', order: 1 },
    { id: 'blk-knee', name: 'Knee ability', order: 2 },
    { id: 'blk-hip', name: 'Hip & posterior', order: 3 },
  ],
  steps: [
    {
      id: 'kot-01-tibialis',
      order: 1,
      name: 'Tibialis raise',
      standard_text: '25 reps × 3 sets, bodyweight, full range',
      standard: { reps: 25, sets: 3 },
      exercise_slug: 'tibialis_raise',
      block: 'blk-ankle',
    },
    {
      id: 'kot-02-backward-walk',
      order: 2,
      name: 'Backward walking',
      standard_text: '10 minutes continuous, or 0.5 mi',
      standard: { duration_min: 10, distance_mi: 0.5 },
      exercise_slug: 'backward_walk',
      substitutions: [{ equipment_missing: 'sled', use_slug: 'backward_walk', note: 'Powered-off treadmill at PF' }],
      block: 'blk-ankle',
    },
    {
      id: 'kot-03-atg-split-squat',
      order: 3,
      name: 'ATG split squat',
      standard_text: '25% BW per hand × 5 reps each side',
      standard: { pct_bodyweight: 0.25, per_hand: true, reps: 5 },
      exercise_slug: 'atg_split_squat',
      prerequisites: ['kot-01-tibialis'],
      block: 'blk-knee',
    },
    {
      id: 'kot-04-poliquin-step-up',
      order: 4,
      name: 'Poliquin step-up',
      standard_text: 'Bodyweight × 10 reps each side, 8" step',
      standard: { reps: 10 },
      exercise_slug: 'poliquin_step_up',
      prerequisites: ['kot-03-atg-split-squat'],
      block: 'blk-knee',
    },
    {
      id: 'kot-05-patrick-step',
      order: 5,
      name: 'Patrick step',
      standard_text: 'Bodyweight × 10 reps each side, controlled',
      standard: { reps: 10 },
      exercise_slug: 'patrick_step',
      prerequisites: ['kot-03-atg-split-squat'],
      block: 'blk-knee',
    },
    {
      id: 'kot-06-nordic',
      order: 6,
      name: 'Nordic curl',
      standard_text: '3 unassisted full-range reps',
      standard: { reps: 3 },
      exercise_slug: 'nordic_curl',
      prerequisites: ['kot-04-poliquin-step-up'],
      block: 'blk-hip',
    },
    {
      id: 'kot-07-reverse-nordic',
      order: 7,
      name: 'Reverse Nordic',
      standard_text: '10 reps to a 45° lean',
      standard: { reps: 10 },
      exercise_slug: 'reverse_nordic',
      prerequisites: ['kot-05-patrick-step'],
      block: 'blk-hip',
    },
  ],
};

export function demoProgramProgress(today: string): ProgramProgress {
  return {
    program_slug: 'kot',
    cycle: 1,
    current_step_ids: ['kot-03-atg-split-squat', 'kot-05-patrick-step'],
    met: {
      'kot-01-tibialis': { date: addDays(today, -24), evidence: '3 × 25 bodyweight, clean range' },
      'kot-02-backward-walk': { date: addDays(today, -11), evidence: '12 min treadmill, powered off' },
      'kot-04-poliquin-step-up': { date: addDays(today, -6), evidence: '2 × 10 each side, 8" step' },
    },
  };
}

// ───────────────────────────── The assembled input ─────────────────────────────

export function demoPlanInput(today: string, overrides: Partial<PlanInput> = {}): PlanInput {
  const ouraHistory = demoOuraHistory(today);
  const ouraToday = ouraHistory[ouraHistory.length - 1];
  return {
    today,
    athlete: DEMO_ATHLETE,
    goals: DEMO_GOALS,
    budget_min: 45,
    location: HOME_LOCATION,
    all_locations: DEMO_LOCATIONS,
    ...(ouraToday ? { oura_today: ouraToday } : {}),
    oura_history: ouraHistory,
    recent_self_reports: demoSelfReports(today),
    history: demoHistory(today),
    cardio_history: demoCardio(today),
    injuries: DEMO_INJURIES,
    body_metrics: demoBodyMetrics(today),
    program: DEMO_PROGRAM,
    program_progress: demoProgramProgress(today),
    exercises: DEMO_EXERCISES,
    seed: seedFromString(today),
    ...overrides,
  };
}
