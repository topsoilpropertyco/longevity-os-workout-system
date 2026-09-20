/**
 * Longevity OS — Engine Constants
 *
 * Every number in this file traces to a citation in `docs/RESEARCH_FOUNDATION.md`.
 * The section reference is on the constant. Changing one of these changes what
 * Seth is told to do, so do not change one without changing the research doc —
 * and per CLAUDE.md, ask Seth before altering a weekly-template evidence default.
 */

import type { GoalMode, MovementPattern, Region, Rpe, SessionType } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Weekly dose targets — RESEARCH §6.1
// ─────────────────────────────────────────────────────────────────────────────

export const WEEKLY = {
  /** Consensus longevity target. Seth starts far below this and ramps. */
  zone2_target_min: 180,
  zone2_stretch_min: 240,
  zone2_floor_min: 150,
  /** Aerobic volume may not grow faster than this per week. Hard rule. */
  aerobic_ramp_max_pct: 0.1,
  /** One Norwegian 4×4 per week. */
  vo2_sessions: 1,
  /** J-shaped mortality curve: max benefit 60–120 min/wk, diminishing past ~140. */
  strength_min_range: [60, 120] as [number, number],
  strength_hard_cap_min: 140,
  strength_sessions: [2, 3] as [number, number],
  kot_sessions: [2, 3] as [number, number],
  power_blocks: [1, 2] as [number, number],
  mobility_sessions_min: 2,
  /** Mortality benefit plateaus here; used as the recovery-day floor. */
  steps_floor: 7000,
  steps_target: 8000,
  /** Total moderate-vigorous minutes. The planner never exceeds the ceiling. */
  mvpa_range: [150, 300] as [number, number],
  mvpa_ceiling_min: 420,
  /** Something physical every day — PRD goal 2. */
  sessions_per_week: 7,
} as const;

/** The Norwegian 4×4, plus the two accepted substitutions. RESEARCH §6.1 */
export const VO2_PROTOCOLS = [
  { id: '4x4', label: '4 × 4 min', work_min: 4, rest_min: 3, rounds: 4, intensity: [0.85, 0.95] as [number, number] },
  { id: '8x2', label: '8 × 2 min', work_min: 2, rest_min: 2, rounds: 8, intensity: [0.88, 0.95] as [number, number] },
  { id: '30_30', label: '30/30s', work_min: 0.5, rest_min: 0.5, rounds: 20, intensity: [0.9, 1.0] as [number, number] },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Heart-rate zones — RESEARCH §4, §6.1
// ─────────────────────────────────────────────────────────────────────────────

/** Fractions of HRmax. Zone 2 is the conversational 60–70% band. */
export const HR_ZONE_BOUNDS: Record<'z1' | 'z2' | 'z3' | 'z4' | 'z5', [number, number]> = {
  z1: [0.5, 0.6],
  z2: [0.6, 0.7],
  z3: [0.7, 0.8],
  z4: [0.8, 0.9],
  z5: [0.9, 1.0],
};

/** 220 − age. The fallback of last resort; measured Strava max and Oura both win. */
export const HR_MAX_FORMULA = (ageYears: number): number => 220 - ageYears;

// ─────────────────────────────────────────────────────────────────────────────
// Readiness modulation — PRD §8.1, RESEARCH §6.4
// ─────────────────────────────────────────────────────────────────────────────

export const READINESS_BANDS = {
  /** ≥85 → push: +1 set on primaries or +2.5% load. */
  push: { min: 85, load_multiplier: 1.025, set_delta: 1, rpe_cap: undefined as Rpe | undefined },
  /** 70–84 → as planned. */
  as_planned: { min: 70, load_multiplier: 1.0, set_delta: 0, rpe_cap: undefined as Rpe | undefined },
  /** 55–69 → −10% load, RPE capped at 7. */
  reduced: { min: 55, load_multiplier: 0.9, set_delta: 0, rpe_cap: 7 as Rpe },
  /** <55, or HRV ≥10% below the 28-day baseline → recovery day. */
  recovery: { min: 0, load_multiplier: 0.0, set_delta: -1, rpe_cap: 4 as Rpe },
} as const;

/** HRV this far below the 28-day baseline forces recovery regardless of score. */
export const HRV_RECOVERY_TRIGGER_PCT = -10;

/**
 * Slider → pseudo-readiness when Oura is unavailable. Soreness and energy read
 * 1(bad)–5(good); stress is inverted because 5 means maxed out.
 * Produces a 0–100 score on the same scale as Oura readiness.
 */
export const SLIDER_WEIGHTS = { soreness: 0.4, energy: 0.4, stress: 0.2 } as const;

/** With neither Oura nor sliders, assume a normal day rather than a heroic one. */
export const DEFAULT_READINESS_SCORE = 75;

// ─────────────────────────────────────────────────────────────────────────────
// Regional load ledger — RESEARCH §6.3
// ─────────────────────────────────────────────────────────────────────────────

export const LEDGER = {
  /** Minimum hours between hard stimuli to the same region. */
  hard_hit_recovery_h: 48,
  /** Eccentric-dominant work (Nordics, depth jumps) needs longer. */
  eccentric_recovery_h: 72,
  /** Gabbett's acute:chronic workload ratio sweet spot. */
  acwr_min: 0.8,
  acwr_max: 1.3,
  /** Above this, flag an injury-risk spike and refuse to add more. */
  acwr_danger: 1.5,
  /** A set counts as a "hard hit" on a region at or above this share of its e1RM. */
  hard_hit_intensity: 0.8,
  /** …or at this RPE. */
  hard_hit_rpe: 8,
  /** Region load below this over 7 days is treated as fully recovered. */
  negligible_load: 0.5,
} as const;

/** Plyometric ground contacts per session. RESEARCH §6.3 */
export const PLYO_CONTACTS = {
  beginner: [40, 60] as [number, number],
  intermediate: [80, 100] as [number, number],
  /** Never on consecutive days, whatever the count. */
  min_days_between: 2,
} as const;

/** Running progression. RESEARCH §6.3 */
export const RUNNING = {
  weekly_volume_ramp_pct: 0.1,
  /** No two hard run days in a row. */
  min_days_between_hard: 2,
  /** Sprint work: 10–30 m, ~1 min recovery per 10 m, 6–10 reps. */
  sprint_distance_m: [10, 30] as [number, number],
  sprint_reps: [6, 10] as [number, number],
  sprint_recovery_s_per_10m: 60,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Pairing exclusions — RESEARCH §6.3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard constraints, not scores (CLAUDE.md invariant 5). A session containing a
 * forbidden pair is a bug, not a judgement call.
 */
export interface PairingExclusion {
  id: string;
  /** Human-readable reason, surfaced in the plan's notes. */
  reason: string;
  /** Matches when BOTH sides are present in the same session. */
  a: ExclusionMatcher;
  b: ExclusionMatcher;
  /** When set, the exclusion applies only if the named region is flagged/injured. */
  only_if_region_flagged?: Region;
}

export interface ExclusionMatcher {
  patterns?: MovementPattern[];
  regions?: Region[];
  eccentric_dominant?: boolean;
  /** Matches exercises whose slug contains any of these fragments. */
  slug_contains?: string[];
  min_intensity?: number;
}

export const PAIRING_EXCLUSIONS: PairingExclusion[] = [
  {
    id: 'spinal_load_plus_max_sprint',
    reason: 'Heavy spinal loading and max-effort sprinting in one session stacks axial fatigue on a hamstring-vulnerable state.',
    a: { regions: ['spine', 'low_back'], min_intensity: 0.8 },
    b: { patterns: ['sprint'] },
  },
  {
    id: 'nordics_plus_depth_jumps',
    reason: 'Nordics and depth jumps are both severely eccentric; together they overshoot what the posterior chain can repair.',
    a: { slug_contains: ['nordic'] },
    b: { slug_contains: ['depth-jump', 'depth_jump'] },
  },
  {
    id: 'double_max_grip_before_pull',
    reason: 'Two max-effort grip movements back to back leave nothing for the pull that follows.',
    a: { patterns: ['carry'], min_intensity: 0.8 },
    b: { patterns: ['vertical_pull', 'horizontal_pull'], min_intensity: 0.8 },
  },
  {
    id: 'overhead_after_high_volume_pressing',
    reason: 'Overhead pressing straight after high-volume dips or push-ups is how a flagged shoulder becomes an injured one.',
    a: { patterns: ['horizontal_push'] },
    b: { patterns: ['vertical_push'] },
    only_if_region_flagged: 'shoulders',
  },
];

/**
 * Concurrent-training interference — RESEARCH §6.2. Power work must never follow
 * aerobic work in the same session. This is the ordering rule that the assembly
 * stage enforces by construction.
 */
export const BLOCK_ORDER: Record<string, number> = {
  warmup: 0,
  power: 1,
  strength: 2,
  program: 3,
  conditioning: 4,
  zone2: 5,
  mobility: 6,
  cooldown: 7,
};

/**
 * Aerobic work of this length or more, in the same session as strength, is the
 * case where interference actually shows up. Shorter bouts are safe.
 */
export const AEROBIC_INTERFERENCE_MIN = 50;
/** Separation that makes the interference effect disappear entirely. */
export const AEROBIC_SEPARATION_H = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Progression & prediction — RESEARCH §6.4
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRESSION = {
  /** Epley and Brzycki are averaged; neither is trusted beyond 10 reps. */
  max_reps_for_e1rm: 10,
  /** Double progression: top of the rep range for all sets, twice running. */
  sessions_at_top_before_load_bump: 2,
  load_bump_upper_lb: 5,
  load_bump_lower_lb: 10,
  /** Prediction confidence is capped below this many sessions of history. */
  min_sessions_for_confidence: 3,
  /** Sessions of history at which confidence saturates. */
  full_confidence_sessions: 8,
  /** Deviation from trend that counts as a plateau, over the plateau window. */
  plateau_threshold_pct: 0.02,
  plateau_window_sessions: 4,
} as const;

/** Goal-mode prescription bands. RESEARCH §6.4 */
export interface GoalBand {
  sets: [number, number];
  reps: [number, number];
  rpe: [number, number];
  rest_s: number;
  /** Extra dedicated core blocks per week. */
  core_blocks_per_week: number;
  /** Relative emphasis the assembler gives each block kind. */
  emphasis: Partial<Record<SessionType, number>>;
  note: string;
}

export const GOAL_BANDS: Record<GoalMode, GoalBand> = {
  maintain: {
    sets: [2, 2], reps: [6, 10], rpe: [7, 7], rest_s: 90, core_blocks_per_week: 0,
    emphasis: { strength: 1, zone2: 1, mobility: 1, kot: 1 },
    note: 'Hold the line with the least time that still works.',
  },
  tone: {
    sets: [3, 3], reps: [10, 15], rpe: [8, 8], rest_s: 60, core_blocks_per_week: 1,
    emphasis: { strength: 1.2, zone2: 1, mobility: 1, kot: 1 },
    note: 'Hypertrophy-lean: more reps, shorter rest.',
  },
  bulk: {
    sets: [3, 4], reps: [6, 12], rpe: [8, 9], rest_s: 120, core_blocks_per_week: 0,
    emphasis: { strength: 1.5, zone2: 0.8, mobility: 0.8, kot: 1 },
    note: 'Hypertrophy-strength: more sets, longer rest.',
  },
  six_pack: {
    sets: [3, 3], reps: [10, 15], rpe: [8, 8], rest_s: 60, core_blocks_per_week: 3,
    emphasis: { strength: 1.1, zone2: 1.2, mobility: 1, kot: 1 },
    note: 'Visible abs are body-fat driven — the core blocks build them, the Zone 2 reveals them.',
  },
  strength: {
    sets: [3, 5], reps: [3, 5], rpe: [8, 9], rest_s: 180, core_blocks_per_week: 1,
    emphasis: { strength: 1.6, power: 1.2, zone2: 0.7, kot: 1 },
    note: 'Heavy and low-rep, with the rest to support it.',
  },
  power: {
    sets: [3, 5], reps: [1, 5], rpe: [7, 8], rest_s: 180, core_blocks_per_week: 1,
    emphasis: { power: 1.8, strength: 1.2, zone2: 0.7, kot: 1 },
    note: 'Speed over grind: every rep fast, always fresh.',
  },
  endurance: {
    sets: [2, 3], reps: [12, 20], rpe: [7, 8], rest_s: 45, core_blocks_per_week: 1,
    emphasis: { zone2: 1.6, vo2: 1.3, strength: 0.7, kot: 1 },
    note: 'Aerobic base first; strength maintains rather than builds.',
  },
  rehab: {
    sets: [2, 3], reps: [8, 15], rpe: [5, 7], rest_s: 90, core_blocks_per_week: 2,
    emphasis: { kot: 1.8, mobility: 1.6, zone2: 1, strength: 0.6, power: 0 },
    note: 'Tissue tolerance before load. Nothing above RPE 7.',
  },
  vo2_focus: {
    sets: [2, 3], reps: [8, 12], rpe: [7, 8], rest_s: 90, core_blocks_per_week: 0,
    emphasis: { vo2: 2, zone2: 1.4, strength: 0.8, kot: 1 },
    note: 'Two hard aerobic sessions a week; strength holds steady.',
  },
  fat_loss: {
    sets: [3, 3], reps: [10, 15], rpe: [8, 8], rest_s: 60, core_blocks_per_week: 2,
    emphasis: { zone2: 1.4, strength: 1.2, vo2: 1.1, kot: 1 },
    note: 'Keep the muscle, raise the daily output.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Deload — RESEARCH §6.4
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed-calendar deloads show no advantage over continuous training
 * (Coleman 2024; Pancar 2025). Ours are autoregulated: triggered, not scheduled.
 */
export const DELOAD = {
  /** 7-day mean readiness below this fires a deload. */
  readiness_7d_below: 65,
  /** HRV trend this far below the 28-day baseline fires a deload. */
  hrv_trend_below_pct: -10,
  /** Two consecutive sessions missing prescribed reps fires a deload. */
  missed_rep_sessions: 2,
  /** Sliders in the red for this many consecutive days fires a deload. */
  red_slider_days: 3,
  /** A slider at or below this counts as red. */
  red_slider_threshold: 2,
  volume_multiplier: 0.6,
  load_multiplier: 0.875,
  duration_days: 6,
  /** Force a light week at least this often even if nothing has fired. */
  hard_cap_weeks: 9,
  hard_cap_weeks_range: [8, 10] as [number, number],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Injury response — RESEARCH §6.3
// ─────────────────────────────────────────────────────────────────────────────

export const INJURY = {
  /** A rise of ≥2 points in 24 h regresses the progression one step. */
  pain_rise_regression_threshold: 2,
  /** Pain at or above this blocks loading of the region outright. */
  pain_block_threshold: 6,
  /** Pain at or above this caps intensity on the region. */
  pain_caution_threshold: 3,
  /** Load multiplier applied to a cautioned region. */
  caution_load_multiplier: 0.7,
} as const;

/** The rehab floor for the low back. Near-daily. RESEARCH §6.3 */
export const MCGILL_BIG_3 = ['mcgill-curl-up', 'side-plank', 'bird-dog'] as const;

/** ~50% reduction in hamstring injury across sports (van Dyk 2019). 1–2×/week. */
export const NORDIC_WEEKLY = [1, 2] as [number, number];

// ─────────────────────────────────────────────────────────────────────────────
// Session assembly
// ─────────────────────────────────────────────────────────────────────────────

export const ASSEMBLY = {
  /** Seconds of setup per exercise: finding it, adjusting it, getting into position. */
  setup_s_per_exercise: 60,
  /** Seconds per working rep, averaged across tempos. */
  seconds_per_rep: 3.5,
  /** Agonist/antagonist supersets are used at or below this budget. RESEARCH §6.3 */
  superset_budget_threshold_min: 30,
  /** A superset saves roughly this share of the pair's combined rest. */
  superset_time_saving: 0.4,
  /** Never plan a session that overruns the budget by more than this. */
  overrun_tolerance_min: 2,
  /** Minimum minutes that make a block worth including at all. */
  min_block_min: 3,
  default_warmup_min: 5,
  default_cooldown_min: 5,
} as const;

/** Vertical-jump north star. RESEARCH §6.5 */
export const VERTICAL = {
  /** Dunking a 10' rim with ball clearance, from a ~8'3" standing reach. */
  dunk_vertical_needed_in: [30, 33] as [number, number],
  retest_interval_days: 30,
  /** Depth jumps unlock only above this trap-bar/DB deadlift multiple of bodyweight. */
  depth_jump_strength_gate_bw: 1.5,
  /** Plyo progression, in order. Each unlocks the next. */
  progression: [
    'landing-mechanics',
    'pogo-hops',
    'ankle-hops',
    'box-jump-step-down',
    'hurdle-hop',
    'bound',
    'depth-jump',
  ] as const,
} as const;

/** Region groupings used when the engine needs to pick a complementary day. */
export const REGION_GROUPS: Record<'lower' | 'upper' | 'trunk', Region[]> = {
  lower: ['knees_quads', 'posterior_chain', 'calves_achilles', 'hips_glutes'],
  upper: ['shoulders', 'chest', 'upper_back', 'elbows_forearms', 'neck'],
  trunk: ['low_back', 'spine', 'core'],
};
