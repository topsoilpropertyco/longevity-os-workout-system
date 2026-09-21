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
  ProgramDay,
  ProgramPhase,
  ProgramProgress,
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
    // Seth confirmed he owns one. Knees Over Toes leans on it from Zero week 1
    // — the slant-board calf raise and the ATG/VMO squat are prescriptions
    // here, not substitutions, and every phase standard measured on a board
    // is reachable at home.
    { equipment: 'slant_board', available: true },
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
    // The stretching area. Wall sits, couch stretch and the standing-pigeon
    // hold all need nothing more than a flat wall, and every club has one —
    // omitting this was sending KOT wall work to a substitution it didn't need.
    { equipment: 'wall_space', available: true },
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
    // His board lives at home and he does not carry it to the club, so the
    // slant-board work substitutes here rather than silently assuming a wedge.
    { equipment: 'slant_board', available: false },
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
 * Knees Over Toes, Phase 1 ZERO — the phase Seth is actually starting on.
 *
 * Trimmed to the movements this fixture library can resolve, so the engine's
 * behaviour is pinned without dragging the full 69-step program into the tests.
 * The real thing lives in `programs/kot/program.json`, rebuilt from his own
 * April 2026 checklist by `scripts/ingest-kot.ts`.
 *
 * Two deliberate compressions, both noted so nobody reads them as fact:
 *   - The warm-up is a plain FORWARD walk in Seth's program. The only walking
 *     record in this fixture set is `backward-walk`, so that is what it points
 *     at; the real program has no backward locomotion anywhere.
 *   - The tibialis raise is one movement performed twice in the session
 *     (positions 2 and 4 of the checklist). The day template in the real file
 *     references it twice; here it collapses to `sets: 2`.
 */
const ZERO_PHASE: ProgramPhase = {
  id: 'zero',
  name: 'Zero',
  order: 1,
  weeks: 12,
  days_per_week: 3,
  weekdays: [1, 3, 5],
  session_min: [10, 20],
  load_rule: { kind: 'bodyweight_only' },
  description: '12 weeks, Monday/Wednesday/Friday, 10–20 minutes, bodyweight only. The same session every training day.',
};

/**
 * The Zero session template, reproduced with the two shapes the real
 * `programs/kot/program.json` contains and the engine has to survive:
 *
 *   - `kot-zero-tib-raise` is listed TWICE in one day. In Knee Ability Zero the
 *     tibialis raise is done at the top of the session and again a few minutes
 *     later, alternating with the calf raises. Dropping the second listing
 *     deletes half the prescribed dose.
 *   - "Knee ability" appears as a block title TWICE, because the optional body
 *     squat is tacked on at the very end, after the stretches.
 */
const ZERO_DAY = (weekday: number): ProgramDay => ({
  phase_id: 'zero',
  weekday,
  title: 'Zero — same session every day',
  focus: 'Ankles, knees, then the stretches that keep the range',
  blocks: [
    { title: 'Warm-up', step_ids: ['kot-zero-walk'] },
    { title: 'Lower legs', step_ids: ['kot-zero-tib-raise', 'kot-zero-calf-raise', 'kot-zero-tib-raise'] },
    { title: 'Knee ability', step_ids: ['kot-zero-patrick-step', 'kot-zero-split-squat'] },
    { title: 'Posterior chain', step_ids: ['kot-zero-nordic'] },
    { title: 'Mobility', step_ids: ['kot-zero-elephant-walk', 'kot-zero-couch-stretch'] },
    { title: 'Knee ability', step_ids: ['kot-zero-body-squat'] },
  ],
});

/**
 * Phase 2 DENSE — five days a week, and the phase where load enters the program
 * for the first time. Week 1 is still bodyweight; week 2 starts at 25% of
 * bodyweight and every week after adds 5%.
 */
const DENSE_PHASE: ProgramPhase = {
  id: 'dense',
  name: 'Dense',
  order: 2,
  weeks: 12,
  days_per_week: 5,
  weekdays: [1, 2, 3, 4, 5],
  session_min: [30, 45],
  load_rule: { kind: 'percent_bw_ramp', start_pct: 25, weekly_increment_pct: 5 },
  description:
    '12 weeks, Monday to Friday, 30–45 minutes. Week 1 bodyweight, week 2 at 25% bodyweight, +5% a week after that.',
};

const DENSE_DAYS: ProgramDay[] = [
  {
    phase_id: 'dense', weekday: 1, title: 'Dense — Monday', focus: 'Lower body',
    blocks: [
      { title: 'Warm-up', step_ids: ['kot-dense-walk'] },
      { title: 'Knee ability', step_ids: ['kot-dense-patrick-step'] },
      { title: 'Posterior chain', step_ids: ['kot-dense-rdl'] },
      { title: 'Lower legs', step_ids: ['kot-dense-tib-raise'] },
    ],
  },
  {
    phase_id: 'dense', weekday: 2, title: 'Dense — Tuesday', focus: 'Upper + mobility',
    blocks: [
      { title: 'Warm-up', step_ids: ['kot-dense-walk'] },
      { title: 'Upper body', step_ids: ['kot-dense-row'] },
      { title: 'Mobility', step_ids: ['kot-dense-couch-stretch'] },
    ],
  },
  {
    phase_id: 'dense', weekday: 3, title: 'Dense — Wednesday', focus: 'Split squat + hip flexors',
    blocks: [
      { title: 'Warm-up', step_ids: ['kot-dense-walk'] },
      { title: 'Knee ability', step_ids: ['kot-dense-split-squat'] },
      { title: 'Mobility', step_ids: ['kot-dense-couch-stretch'] },
    ],
  },
  {
    phase_id: 'dense', weekday: 4, title: 'Dense — Thursday', focus: 'Upper + mobility',
    blocks: [
      { title: 'Warm-up', step_ids: ['kot-dense-walk'] },
      { title: 'Upper body', step_ids: ['kot-dense-row'] },
      { title: 'Mobility', step_ids: ['kot-dense-couch-stretch'] },
    ],
  },
  {
    phase_id: 'dense', weekday: 5, title: 'Dense — Friday', focus: 'Squat focus',
    blocks: [
      { title: 'Warm-up', step_ids: ['kot-dense-walk'] },
      { title: 'Knee ability', step_ids: ['kot-dense-patrick-step'] },
      { title: 'Posterior chain', step_ids: ['kot-dense-nordic'] },
    ],
  },
];

/**
 * Phase 3 STANDARDS — open-ended, four days a week, load driven by the twelve
 * benchmarks rather than by the calendar. `kot-standards-rdl` is the 100%-of-
 * bodyweight hinge: it is the single heaviest thing the program ever asks for,
 * and it is the prescription that must never reach a Zero-week-1 Monday.
 */
const STANDARDS_PHASE: ProgramPhase = {
  id: 'standards',
  name: 'Standards',
  order: 3,
  weeks: null,
  days_per_week: 4,
  weekdays: [1, 2, 4, 5],
  session_min: [45, 60],
  description: 'Open-ended. Monday, Tuesday, Thursday, Friday, 45–60 minutes. Runs until every benchmark is met.',
  load_rule: { kind: 'standards_driven' },
};

const STANDARDS_DAYS: ProgramDay[] = STANDARDS_PHASE.weekdays.map((weekday) => ({
  phase_id: 'standards',
  weekday,
  title: 'Standards — benchmark work',
  focus: 'Lower, then upper, then the stretches',
  blocks: [
    { title: 'Warm-up', step_ids: ['kot-standards-walk'] },
    { title: 'Lower legs', step_ids: ['kot-standards-tib-raise'] },
    { title: 'Knee ability', step_ids: ['kot-standards-split-squat'] },
    { title: 'Posterior chain', step_ids: ['kot-standards-rdl'] },
    { title: 'Mobility', step_ids: ['kot-standards-couch-stretch'] },
  ],
}));

const ZERO_STEP_IDS = [
  'kot-zero-walk',
  'kot-zero-tib-raise',
  'kot-zero-patrick-step',
  'kot-zero-split-squat',
  'kot-zero-nordic',
  'kot-zero-elephant-walk',
  'kot-zero-couch-stretch',
  'kot-zero-calf-raise',
  'kot-zero-body-squat',
];

export const KOT: Program = {
  slug: 'kot',
  name: 'Knees Over Toes',
  description: 'Seth\'s Knees Over Toes. Phase 1 Zero: bodyweight, three days a week, ground up from the ankles.',
  ordering: 'ground_up',
  days_per_week: [3, 5],
  target_cycles: 1,
  source: 'fixture — Phase 1 Zero of programs/kot/program.json',
  current_phase_id: 'zero',
  phases: [ZERO_PHASE, DENSE_PHASE, STANDARDS_PHASE],
  blocks: [
    { id: 'warm-up', name: 'Warm-up', order: 0 },
    { id: 'lower-legs', name: 'Lower legs', order: 1 },
    { id: 'knee-ability', name: 'Knee ability', order: 2 },
    { id: 'posterior-chain', name: 'Posterior chain', order: 3 },
    { id: 'upper-body', name: 'Upper body', order: 4 },
    { id: 'mobility', name: 'Mobility', order: 5 },
  ],
  days: [
    ...ZERO_PHASE.weekdays.map((weekday) => ZERO_DAY(weekday)),
    ...DENSE_DAYS,
    ...STANDARDS_DAYS,
  ],
  steps: [
    {
      id: 'kot-zero-walk', order: 0, block: 'warm-up', phase_id: 'zero', name: 'Bodyweight walk (warm-up)',
      standard_text: '5–10 minutes of easy walking. The fixture uses the top of the range.',
      exercise_slug: 'backward-walk', standard: { duration_min: 10 },
    },
    {
      id: 'kot-zero-tib-raise', order: 1, block: 'lower-legs', phase_id: 'zero', name: 'Tibialis raise',
      standard_text: '25 reps, performed twice in the session.',
      exercise_slug: 'tibialis-raise', standard: { reps: 25, sets: 2 },
      progressions: ['Closer to the wall is easier.', 'Farther from the wall is harder.', 'One leg at a time.'],
    },
    {
      id: 'kot-zero-patrick-step', order: 2, block: 'knee-ability', phase_id: 'zero', name: 'Patrick step (slant board)',
      standard_text: '25 reps per side.', exercise_slug: 'patrick-step', standard: { reps: 25 }, per_side: true,
      substitutions: [{ equipment_missing: 'slant_board', use_slug: 'patrick-step', note: 'Travelling: a stair edge instead of the board.' }],
    },
    {
      id: 'kot-zero-split-squat', order: 3, block: 'knee-ability', phase_id: 'zero', name: 'ATG split squat',
      standard_text: '5 sets of 5 per side, 30 s between sets — 25 reps a side in total.',
      exercise_slug: 'atg-split-squat', standard: { reps: 5, sets: 5 }, per_side: true, rest_s: 30,
    },
    {
      id: 'kot-zero-nordic', order: 4, block: 'posterior-chain', phase_id: 'zero', name: 'Nordic curl',
      standard_text: '5 reps, hands catching the descent.', exercise_slug: 'nordic-curl', standard: { reps: 5 },
    },
    {
      id: 'kot-zero-elephant-walk', order: 5, block: 'mobility', phase_id: 'zero', name: 'Elephant walk',
      standard_text: '25 reps.', exercise_slug: 'elephant-walk', standard: { reps: 25 },
    },
    {
      id: 'kot-zero-couch-stretch', order: 6, block: 'mobility', phase_id: 'zero', name: 'Couch stretch',
      standard_text: '60 s per side.', exercise_slug: 'couch-stretch', standard: { hold_s: 60 }, per_side: true,
    },
    {
      id: 'kot-zero-calf-raise', order: 7, block: 'lower-legs', phase_id: 'zero', name: 'Calf raise (slant board)',
      standard_text: '25 reps.', exercise_slug: 'deep-squat-hold', standard: { reps: 25 },
    },
    {
      id: 'kot-zero-body-squat', order: 8, block: 'knee-ability', phase_id: 'zero', name: 'Body squat (slant board)',
      standard_text: '5 sets of 5, 30 s between sets. Optional.',
      exercise_slug: 'goblet-squat', standard: { reps: 5, sets: 5 }, rest_s: 30,
    },

    // ── Phase 2 DENSE ────────────────────────────────────────────────────────
    {
      id: 'kot-dense-walk', order: 20, block: 'warm-up', phase_id: 'dense', name: 'Bodyweight walk (warm-up)',
      standard_text: '5 minutes of easy walking.', exercise_slug: 'backward-walk', standard: { duration_min: 5 },
    },
    {
      id: 'kot-dense-patrick-step', order: 21, block: 'knee-ability', phase_id: 'dense', name: 'Patrick step',
      standard_text: '5 sets of 10 per side.', exercise_slug: 'patrick-step',
      standard: { reps: 10, sets: 5 }, per_side: true, rest_s: 45,
    },
    {
      id: 'kot-dense-split-squat', order: 22, block: 'knee-ability', phase_id: 'dense', name: 'ATG split squat',
      standard_text: '5 sets of 5 per side, 30 s between sets.', exercise_slug: 'atg-split-squat',
      standard: { reps: 5, sets: 5 }, per_side: true, rest_s: 30,
    },
    {
      id: 'kot-dense-rdl', order: 23, block: 'posterior-chain', phase_id: 'dense', name: 'Seated good morning',
      standard_text: '3 sets of 10.', exercise_slug: 'db-rdl', standard: { reps: 10, sets: 3 },
    },
    {
      id: 'kot-dense-tib-raise', order: 24, block: 'lower-legs', phase_id: 'dense', name: 'Tibialis raise',
      standard_text: '4 sets of 20.', exercise_slug: 'tibialis-raise', standard: { reps: 20, sets: 4 },
    },
    {
      id: 'kot-dense-row', order: 25, block: 'upper-body', phase_id: 'dense', name: 'Dumbbell row',
      standard_text: '3 sets of 10.', exercise_slug: 'db-row', standard: { reps: 10, sets: 3 },
    },
    {
      id: 'kot-dense-nordic', order: 26, block: 'posterior-chain', phase_id: 'dense', name: 'Nordic curl',
      standard_text: '3 sets of 5.', exercise_slug: 'nordic-curl', standard: { reps: 5, sets: 3 },
    },
    {
      id: 'kot-dense-couch-stretch', order: 27, block: 'mobility', phase_id: 'dense', name: 'Couch stretch',
      standard_text: '60 s per side.', exercise_slug: 'couch-stretch', standard: { hold_s: 60 }, per_side: true,
    },

    // ── Phase 3 STANDARDS ────────────────────────────────────────────────────
    {
      id: 'kot-standards-walk', order: 40, block: 'warm-up', phase_id: 'standards', name: 'Bodyweight walk (warm-up)',
      standard_text: '0.25 miles.', exercise_slug: 'backward-walk', standard: { duration_min: 5 },
    },
    {
      id: 'kot-standards-tib-raise', order: 41, block: 'lower-legs', phase_id: 'standards', name: 'Tibialis raise',
      standard_text: '3 sets of 20.', exercise_slug: 'tibialis-raise', standard: { reps: 20, sets: 3 },
    },
    {
      id: 'kot-standards-split-squat', order: 42, block: 'knee-ability', phase_id: 'standards', name: 'ATG split squat',
      standard_text: 'BENCHMARK: 25% BW per hand, 5 reps per side, 5 sets.',
      exercise_slug: 'atg-split-squat',
      standard: { pct_bodyweight: 0.25, per_hand: true, reps: 5, sets: 5 }, per_side: true, rest_s: 30,
    },
    {
      id: 'kot-standards-rdl', order: 43, block: 'posterior-chain', phase_id: 'standards', name: 'ATG deadlift',
      standard_text: 'BENCHMARK: 100% BW, 10 reps, 5 sets.',
      exercise_slug: 'db-rdl', standard: { pct_bodyweight: 1, reps: 10, sets: 5 },
    },
    {
      id: 'kot-standards-couch-stretch', order: 44, block: 'mobility', phase_id: 'standards', name: 'Couch stretch',
      standard_text: '90 s per side.', exercise_slug: 'couch-stretch', standard: { hold_s: 90 }, per_side: true,
    },
  ],
};

/** Phase 2 DENSE, week 5 — the phase rule has ramped load to 40% of bodyweight. */
export const KOT_PROGRESS_DENSE_WEEK_5: ProgramProgress = {
  program_slug: 'kot',
  cycle: 1,
  phase_id: 'dense',
  week_in_phase: 5,
  met: {},
  current_step_ids: [],
};

/** Phase 3 STANDARDS — load comes from the benchmarks, not from the calendar. */
export const KOT_PROGRESS_STANDARDS: ProgramProgress = {
  program_slug: 'kot',
  cycle: 1,
  phase_id: 'standards',
  week_in_phase: 1,
  met: {},
  current_step_ids: [],
};

/** Cold start: Seth is at Phase 1 Zero, week 1, with nothing met. */
export const KOT_PROGRESS: ProgramProgress = {
  program_slug: 'kot',
  cycle: 1,
  phase_id: 'zero',
  week_in_phase: 1,
  met: {},
  current_step_ids: ZERO_STEP_IDS,
};
