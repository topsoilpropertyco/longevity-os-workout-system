/**
 * Longevity OS — Fixture Library
 *
 * A small, hand-checked slice of the world: enough exercises, locations, and
 * history to exercise every branch of the engine, small enough that a human can
 * read a failing test and know why it failed.
 *
 * These are NOT the production exercise library (that is `data/exercises.json`).
 * They exist so the engine's behaviour is pinned independently of data drift.
 */

import type {
  Athlete,
  Exercise,
  GoalSettings,
  GymLocation,
  Injury,
  Program,
  RegionLoadMap,
} from '../src/types.js';

function ex(partial: Partial<Exercise> & Pick<Exercise, 'id' | 'name' | 'pattern'>): Exercise {
  return {
    slug: partial.id,
    aliases: [],
    force: 'push',
    mechanic: 'compound',
    level: 'intermediate',
    equipment: [],
    region_loads: {} as RegionLoadMap,
    load_style: 'bodyweight',
    barbell_free: true,
    eccentric_dominant: false,
    plyo_contacts_per_rep: 0,
    instructions: [],
    source: 'curated',
    ...partial,
  };
}

export const EXERCISES: Exercise[] = [
  // ── Lower, knee-dominant ───────────────────────────────────────────────────
  ex({
    id: 'goblet-squat', name: 'Goblet Squat', pattern: 'squat', force: 'push',
    equipment: ['dumbbell', 'adjustable_dumbbell', 'kettlebell'], load_style: 'single_implement',
    region_loads: { knees_quads: 1, hips_glutes: 0.6, core: 0.4 },
  }),
  ex({
    id: 'smith-squat', name: 'Smith Machine Squat', pattern: 'squat', force: 'push',
    equipment: ['smith_machine'], load_style: 'smith', level: 'intermediate',
    region_loads: { knees_quads: 1, hips_glutes: 0.7, low_back: 0.4, spine: 0.4 },
    preferred_alternatives: ['leg-press', 'goblet-squat'],
  }),
  ex({
    id: 'barbell-back-squat', name: 'Barbell Back Squat', pattern: 'squat', force: 'push',
    equipment: ['barbell', 'power_rack'], load_style: 'barbell', level: 'expert', barbell_free: false,
    region_loads: { knees_quads: 1, hips_glutes: 0.8, low_back: 0.6, spine: 0.6 },
    preferred_alternatives: ['smith-squat', 'goblet-squat', 'leg-press'],
  }),
  ex({
    id: 'leg-press', name: 'Leg Press', pattern: 'squat', force: 'push',
    equipment: ['leg_press'], load_style: 'stack', level: 'beginner',
    region_loads: { knees_quads: 0.9, hips_glutes: 0.5 },
  }),
  ex({
    id: 'atg-split-squat', name: 'ATG Split Squat', pattern: 'lunge', force: 'push',
    equipment: ['dumbbell', 'adjustable_dumbbell', 'bodyweight'], load_style: 'total_dumbbell_pair',
    region_loads: { knees_quads: 1, hips_glutes: 0.5, calves_achilles: 0.3 },
    kot_step: 'split-squat', rehab_for: ['knees_quads'], cue: 'Front knee travels past the toe. Back knee to the floor.',
  }),
  ex({
    id: 'patrick-step', name: 'Patrick Step', pattern: 'lunge', force: 'push',
    equipment: ['bodyweight', 'plyo_box'], region_loads: { knees_quads: 0.9 },
    kot_step: 'step-ups', rehab_for: ['knees_quads'],
  }),
  ex({
    id: 'tibialis-raise', name: 'Tibialis Raise', pattern: 'isolation_lower', force: 'pull',
    equipment: ['bodyweight', 'wall_space', 'tibialis_bar'], mechanic: 'isolation', level: 'beginner',
    region_loads: { calves_achilles: 0.8, knees_quads: 0.2 },
    kot_step: 'lower-legs', rehab_for: ['knees_quads', 'calves_achilles'],
  }),
  ex({
    id: 'backward-walk', name: 'Backward Walking', pattern: 'gait', force: 'static',
    equipment: ['bodyweight', 'outdoor_route', 'treadmill'], load_style: 'none', level: 'beginner',
    region_loads: { knees_quads: 0.4, calves_achilles: 0.3 },
    kot_step: 'backward-locomotion', rehab_for: ['knees_quads'],
  }),

  // ── Lower, hip-dominant ────────────────────────────────────────────────────
  ex({
    id: 'db-rdl', name: 'Dumbbell RDL', pattern: 'hinge', force: 'pull',
    equipment: ['dumbbell', 'adjustable_dumbbell'], load_style: 'total_dumbbell_pair',
    region_loads: { posterior_chain: 1, low_back: 0.5, hips_glutes: 0.7 },
  }),
  ex({
    id: 'trap-bar-deadlift', name: 'Trap Bar Deadlift', pattern: 'hinge', force: 'pull',
    equipment: ['trap_bar'], load_style: 'barbell', level: 'expert', barbell_free: false,
    region_loads: { posterior_chain: 1, low_back: 0.8, knees_quads: 0.5, spine: 0.7 },
  }),
  ex({
    id: 'nordic-curl', name: 'Nordic Hamstring Curl', pattern: 'hinge', force: 'pull',
    equipment: ['bodyweight', 'nordic_support', 'bench_adjustable'], level: 'expert',
    eccentric_dominant: true, region_loads: { posterior_chain: 1, knees_quads: 0.3 },
    cue: 'Lower as slowly as you can. Catch yourself with your hands.',
  }),

  // ── Upper ──────────────────────────────────────────────────────────────────
  ex({
    id: 'db-bench-press', name: 'Dumbbell Bench Press', pattern: 'horizontal_push', force: 'push',
    equipment: ['dumbbell', 'adjustable_dumbbell', 'bench_flat', 'bench_adjustable'],
    load_style: 'total_dumbbell_pair', region_loads: { chest: 1, shoulders: 0.5, elbows_forearms: 0.4 },
  }),
  ex({
    id: 'db-overhead-press', name: 'Dumbbell Overhead Press', pattern: 'vertical_push', force: 'push',
    equipment: ['dumbbell', 'adjustable_dumbbell'], load_style: 'total_dumbbell_pair',
    region_loads: { shoulders: 1, chest: 0.3, elbows_forearms: 0.4, core: 0.3 },
  }),
  ex({
    id: 'pull-up', name: 'Pull-Up', pattern: 'vertical_pull', force: 'pull',
    equipment: ['pull_up_bar'], load_style: 'bodyweight', level: 'expert',
    region_loads: { upper_back: 1, elbows_forearms: 0.6, shoulders: 0.4 },
    preferred_alternatives: ['lat-pulldown', 'assisted-pull-up'],
  }),
  ex({
    id: 'lat-pulldown', name: 'Lat Pulldown', pattern: 'vertical_pull', force: 'pull',
    equipment: ['lat_pulldown', 'cable_machine'], load_style: 'stack', level: 'beginner',
    region_loads: { upper_back: 0.9, elbows_forearms: 0.5 },
  }),
  ex({
    id: 'assisted-pull-up', name: 'Assisted Pull-Up', pattern: 'vertical_pull', force: 'pull',
    equipment: ['assisted_pullup_machine'], load_style: 'assisted', level: 'beginner',
    region_loads: { upper_back: 0.8, elbows_forearms: 0.5 },
  }),
  ex({
    id: 'db-row', name: 'Dumbbell Row', pattern: 'horizontal_pull', force: 'pull',
    equipment: ['dumbbell', 'adjustable_dumbbell', 'bench_flat'], load_style: 'single_implement',
    region_loads: { upper_back: 1, elbows_forearms: 0.5, low_back: 0.3 },
  }),
  ex({
    id: 'farmers-carry', name: "Farmer's Carry", pattern: 'carry', force: 'static',
    equipment: ['dumbbell', 'adjustable_dumbbell', 'kettlebell'], load_style: 'total_dumbbell_pair',
    region_loads: { elbows_forearms: 1, core: 0.6, upper_back: 0.5 },
  }),

  // ── Core ───────────────────────────────────────────────────────────────────
  ex({
    id: 'mcgill-curl-up', name: 'McGill Curl-Up', pattern: 'anti_extension', force: 'static',
    equipment: ['yoga_mat', 'bodyweight'], mechanic: 'isolation', level: 'beginner', load_style: 'none',
    region_loads: { core: 0.8, low_back: 0.2 }, rehab_for: ['low_back'],
  }),
  ex({
    id: 'side-plank', name: 'Side Plank', pattern: 'anti_lateral_flexion', force: 'static',
    equipment: ['yoga_mat', 'bodyweight'], mechanic: 'isolation', level: 'beginner', load_style: 'none',
    region_loads: { core: 0.9, low_back: 0.3 }, rehab_for: ['low_back'],
  }),
  ex({
    id: 'bird-dog', name: 'Bird Dog', pattern: 'anti_rotation', force: 'static',
    equipment: ['yoga_mat', 'bodyweight'], mechanic: 'isolation', level: 'beginner', load_style: 'none',
    region_loads: { core: 0.7, low_back: 0.4 }, rehab_for: ['low_back'],
  }),
  ex({
    id: 'pallof-press', name: 'Pallof Press', pattern: 'anti_rotation', force: 'push',
    equipment: ['cable_machine', 'resistance_bands'], mechanic: 'isolation', load_style: 'stack',
    region_loads: { core: 0.9 },
  }),

  // ── Power ──────────────────────────────────────────────────────────────────
  ex({
    id: 'box-jump', name: 'Box Jump (step down)', pattern: 'jump', force: 'push',
    equipment: ['plyo_box', 'bench_adjustable'], load_style: 'bodyweight',
    plyo_contacts_per_rep: 1, region_loads: { knees_quads: 0.8, calves_achilles: 0.6, hips_glutes: 0.6 },
  }),
  ex({
    id: 'pogo-hop', name: 'Pogo Hops', pattern: 'jump', force: 'push',
    equipment: ['bodyweight'], load_style: 'bodyweight', level: 'beginner',
    plyo_contacts_per_rep: 1, region_loads: { calves_achilles: 0.9, knees_quads: 0.3 },
  }),
  ex({
    id: 'depth-jump', name: 'Depth Jump', pattern: 'jump', force: 'push',
    equipment: ['plyo_box'], load_style: 'bodyweight', level: 'expert', eccentric_dominant: true,
    plyo_contacts_per_rep: 2, region_loads: { knees_quads: 1, calves_achilles: 0.8, posterior_chain: 0.6 },
  }),
  ex({
    id: 'sprint-accel', name: '20 m Acceleration', pattern: 'sprint', force: 'push',
    equipment: ['track_or_open_space', 'outdoor_route'], load_style: 'none',
    plyo_contacts_per_rep: 10, region_loads: { posterior_chain: 1, knees_quads: 0.6, calves_achilles: 0.7 },
  }),

  // ── Mobility ───────────────────────────────────────────────────────────────
  ex({
    id: 'couch-stretch', name: 'Couch Stretch', pattern: 'mobility', force: 'static',
    equipment: ['yoga_mat', 'wall_space', 'bodyweight'], mechanic: 'isolation', level: 'beginner',
    load_style: 'none', region_loads: { hips_glutes: 0.3, knees_quads: 0.2 },
  }),
  ex({
    id: 'deep-squat-hold', name: 'Deep Squat Hold', pattern: 'mobility', force: 'static',
    equipment: ['bodyweight'], mechanic: 'isolation', level: 'beginner', load_style: 'none',
    region_loads: { hips_glutes: 0.3, knees_quads: 0.3 }, kot_step: 'deep-squat',
  }),
  ex({
    id: 'elephant-walk', name: 'Elephant Walk', pattern: 'mobility', force: 'static',
    equipment: ['bodyweight'], mechanic: 'isolation', level: 'beginner', load_style: 'none',
    region_loads: { posterior_chain: 0.3 }, kot_step: 'lower-legs',
  }),
  ex({
    id: 'thoracic-opener', name: 'Thoracic Opener', pattern: 'mobility', force: 'static',
    equipment: ['yoga_mat', 'foam_roller', 'bodyweight'], mechanic: 'isolation', level: 'beginner',
    load_style: 'none', region_loads: { upper_back: 0.3, spine: 0.2 },
  }),
];

export const EXERCISE_BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

// ─────────────────────────────────────────────────────────────────────────────
// Locations
// ─────────────────────────────────────────────────────────────────────────────

/** Bowflex adjustable dumbbells to 52.5 lb, adjustable bench with Nordic support. */
export const HOME: GymLocation = {
  id: 'loc-home',
  user_id: 'seth',
  name: 'Home',
  kind: 'home',
  bar_weight_lb: 0,
  smith_bar_weight_lb: 0,
  overhead_min: 0,
  equipment: [
    { equipment: 'bodyweight', available: true },
    { equipment: 'adjustable_dumbbell', available: true, min_lb: 5, max_lb: 52.5, increment_lb: 2.5, notes: 'Bowflex SelectTech, per hand' },
    { equipment: 'bench_adjustable', available: true, notes: 'Flat/incline with Nordic support' },
    { equipment: 'nordic_support', available: true },
    { equipment: 'pull_up_bar', available: true },
    { equipment: 'resistance_bands', available: true },
    { equipment: 'yoga_mat', available: true },
    { equipment: 'wall_space', available: true },
    { equipment: 'outdoor_route', available: true },
    { equipment: 'foam_roller', available: true },
  ],
};

/**
 * Planet Fitness, standard club. RESEARCH §2: no Olympic barbells, no racks, no
 * bumpers, no chalk, no GHD. Smith bar counterbalanced to ~20 lb effective.
 */
export const PLANET_FITNESS: GymLocation = {
  id: 'loc-pf',
  user_id: 'seth',
  name: 'Planet Fitness — Detroit',
  kind: 'planet_fitness',
  bar_weight_lb: 0,
  smith_bar_weight_lb: 20,
  overhead_min: 10,
  equipment: [
    { equipment: 'bodyweight', available: true },
    { equipment: 'dumbbell', available: true, min_lb: 5, max_lb: 75, increment_lb: 5 },
    { equipment: 'fixed_barbell', available: true, min_lb: 20, max_lb: 70, increment_lb: 10 },
    { equipment: 'ez_curl_bar', available: true, min_lb: 20, max_lb: 60, increment_lb: 10 },
    { equipment: 'smith_machine', available: true, min_lb: 20, max_lb: 320, increment_lb: 5 },
    { equipment: 'cable_machine', available: true, min_lb: 10, max_lb: 200, increment_lb: 10 },
    { equipment: 'functional_trainer', available: true },
    { equipment: 'selectorized_machine', available: true },
    { equipment: 'leg_press', available: true, min_lb: 20, max_lb: 400, increment_lb: 10 },
    { equipment: 'leg_extension', available: true },
    { equipment: 'leg_curl', available: true },
    { equipment: 'lat_pulldown', available: true, min_lb: 20, max_lb: 200, increment_lb: 10 },
    { equipment: 'seated_row', available: true },
    { equipment: 'chest_press_machine', available: true },
    { equipment: 'shoulder_press_machine', available: true },
    { equipment: 'assisted_pullup_machine', available: true },
    { equipment: 'bench_flat', available: true },
    { equipment: 'bench_adjustable', available: true },
    { equipment: 'treadmill', available: true },
    { equipment: 'elliptical', available: true },
    { equipment: 'arc_trainer', available: true },
    { equipment: 'stair_climber', available: true },
    { equipment: 'stationary_bike', available: true },
    { equipment: 'recumbent_bike', available: true },
    { equipment: 'rower', available: true },
    { equipment: 'yoga_mat', available: true },
    { equipment: 'medicine_ball', available: true },
    { equipment: 'stability_ball', available: true },
    // Explicitly absent — the reason `barbell_free` alternatives exist.
    { equipment: 'barbell', available: false },
    { equipment: 'power_rack', available: false },
    { equipment: 'trap_bar', available: false },
    { equipment: 'bumper_plates', available: false },
    { equipment: 'chalk', available: false },
    { equipment: 'ghd', available: false },
    { equipment: 'sled', available: false },
    { equipment: 'plyo_box', available: false },
    { equipment: 'pull_up_bar', available: false },
  ],
};

export const BODYWEIGHT_ONLY: GymLocation = {
  id: 'loc-travel',
  user_id: 'seth',
  name: 'Bodyweight only',
  kind: 'bodyweight_only',
  bar_weight_lb: 0,
  smith_bar_weight_lb: 0,
  equipment: [
    { equipment: 'bodyweight', available: true },
    { equipment: 'yoga_mat', available: true },
    { equipment: 'wall_space', available: true },
    { equipment: 'outdoor_route', available: true },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Athlete
// ─────────────────────────────────────────────────────────────────────────────

/** Seth: 34, 6'3", Detroit. Birth date chosen to make him 34 on the fixture date. */
export const SETH: Athlete = {
  user_id: 'seth',
  birth_date: '1992-03-14',
  height_in: 75,
  bodyweight_lb: 205,
  resting_hr: 54,
  standing_reach_in: 99,
};

export const DEFAULT_GOALS: GoalSettings = {
  mode: 'tone',
  vertical_jump_focus: true,
  warmup_min: 5,
  cooldown_min: 5,
  warmup_outside_budget: true,
};

/** Seeded per PRD §8.5: knees and low back, both longstanding. */
export const BASELINE_INJURIES: Injury[] = [
  {
    id: 'inj-knees',
    region: 'knees_quads',
    label: 'knees',
    onset: '2019-01-01',
    kind: 'longstanding',
    current_pain: 2,
    aggravators: ['deep barbell squat under fatigue'],
    notes: 'The reason Knees Over Toes is the active program.',
  },
  {
    id: 'inj-low-back',
    region: 'low_back',
    label: 'low back',
    onset: '2021-06-01',
    kind: 'longstanding',
    current_pain: 2,
    aggravators: ['loaded spinal flexion'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Program
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A minimal Knees Over Toes scaffold for tests. The real program lives in
 * `programs/kot/program.json` and is reconciled against Seth's spreadsheets.
 */
export const KOT: Program = {
  slug: 'kot',
  name: 'Knees Over Toes',
  description: 'Ground-up knee resilience. Two full cycles is the target.',
  ordering: 'ground_up',
  days_per_week: [2, 3],
  target_cycles: 2,
  source: 'fixture scaffold',
  blocks: [
    { id: 'backward-locomotion', name: 'Backward locomotion', order: 0 },
    { id: 'lower-legs', name: 'Lower legs', order: 1 },
    { id: 'step-ups', name: 'Step-ups', order: 2 },
    { id: 'split-squat', name: 'Split squat', order: 3 },
    { id: 'deep-squat', name: 'Deep squat', order: 4 },
  ],
  steps: [
    {
      id: 'kot-backward-walk', order: 0, block: 'backward-locomotion', name: 'Backward walking',
      standard_text: '10 minutes backward walking', exercise_slug: 'backward-walk',
      standard: { duration_min: 10 },
      substitutions: [{ equipment_missing: 'sled', use_slug: 'backward-walk', note: 'Powered-off treadmill at PF.' }],
    },
    {
      id: 'kot-tib-raise', order: 1, block: 'lower-legs', name: 'Tibialis raise',
      standard_text: '25 reps bodyweight; 25% BW × 5×5 with a tib bar',
      exercise_slug: 'tibialis-raise', standard: { reps: 25, pct_bodyweight: 0.25, sets: 5 },
    },
    {
      id: 'kot-patrick-step', order: 2, block: 'step-ups', name: 'Patrick step',
      standard_text: 'Patrick step, controlled', exercise_slug: 'patrick-step', standard: { reps: 10, sets: 3 },
    },
    {
      id: 'kot-atg-split-squat', order: 3, block: 'split-squat', name: 'ATG split squat',
      standard_text: '25% BW per hand', exercise_slug: 'atg-split-squat',
      standard: { pct_bodyweight: 0.25, per_hand: true, reps: 5, sets: 3 },
    },
    {
      id: 'kot-deep-squat', order: 4, block: 'deep-squat', name: 'Deep squat hold',
      standard_text: 'Accumulate 2 minutes', exercise_slug: 'deep-squat-hold', standard: { hold_s: 120 },
    },
  ],
};
