/**
 * Longevity OS — Engine Domain Types
 *
 * The shared vocabulary for the deterministic rules engine. Everything the
 * engine consumes and produces is described here. No I/O, no framework types.
 *
 * Conventions that hold everywhere in this file:
 *   - Weight is TOTAL LOAD in pounds (`load_lb`). Dumbbell pairs sum both hands.
 *     Barbell/Smith loads include the bar (per-location bar weight). Bodyweight
 *     moves carry ADDED load only; bodyweight itself lives on the athlete.
 *   - Distance is miles. Duration is minutes unless the field says `_s`/`_sec`.
 *   - Dates are ISO `YYYY-MM-DD` in the athlete's local timezone.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

/** ISO date, `YYYY-MM-DD`, in the athlete's local timezone. */
export type IsoDate = string;
/** ISO 8601 instant, UTC. */
export type IsoInstant = string;
export type UserId = string;
export type ExerciseId = string;
export type LocationId = string;

/** 1–5 tappable self-report. 1 = worst, 5 = best. Soreness is inverted: 5 = not sore. */
export type Slider1to5 = 1 | 2 | 3 | 4 | 5;
/** Borg CR10 rating of perceived exertion. */
export type Rpe = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
/** Pain, 0 = none, 10 = worst imaginable. */
export type Pain0to10 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** The minute budgets the UI offers. The engine accepts any positive integer. */
export const TIME_BUDGETS = [15, 20, 30, 45, 60, 90] as const;
export type TimeBudget = (typeof TIME_BUDGETS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Anatomy & movement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Regions tracked by the load ledger (RESEARCH §6.3). Deliberately coarse: these
 * are the units at which "hard stimulus needs 48h" is a meaningful statement.
 */
export const REGIONS = [
  'knees_quads',
  'posterior_chain',
  'low_back',
  'shoulders',
  'elbows_forearms',
  'calves_achilles',
  'spine',
  'chest',
  'upper_back',
  'core',
  'hips_glutes',
  'neck',
] as const;
export type Region = (typeof REGIONS)[number];

/** How much a set of an exercise loads a region, 0–1. Multiplied by set load. */
export type RegionLoadMap = Partial<Record<Region, number>>;

/** Movement patterns, used for swap ranking and template slot filling. */
export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'lunge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'carry',
  'rotation',
  'anti_extension',
  'anti_rotation',
  'anti_lateral_flexion',
  'jump',
  'sprint',
  'gait',
  'isolation_upper',
  'isolation_lower',
  'mobility',
  'cardio_steady',
  'cardio_interval',
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export type Force = 'push' | 'pull' | 'static' | 'unknown';
export type Mechanic = 'compound' | 'isolation' | 'unknown';
export type Level = 'beginner' | 'intermediate' | 'expert';

// ─────────────────────────────────────────────────────────────────────────────
// Equipment & locations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical equipment slugs. Source datasets use looser vocabularies; the
 * ingest script normalizes into this set. `bodyweight` is implicitly available
 * at every location.
 */
export const EQUIPMENT = [
  'bodyweight',
  'dumbbell',
  'adjustable_dumbbell',
  'barbell',
  'ez_curl_bar',
  'fixed_barbell',
  'trap_bar',
  'smith_machine',
  'power_rack',
  'bench_flat',
  'bench_adjustable',
  'nordic_support',
  'pull_up_bar',
  'dip_station',
  'assisted_pullup_machine',
  'cable_machine',
  'functional_trainer',
  'selectorized_machine',
  'leg_press',
  'leg_extension',
  'leg_curl',
  'hip_abductor_adductor',
  'calf_machine',
  'back_extension_bench',
  'chest_press_machine',
  'shoulder_press_machine',
  'lat_pulldown',
  'seated_row',
  'pec_deck',
  'ab_crunch_machine',
  'kettlebell',
  'resistance_bands',
  'suspension_trainer',
  'medicine_ball',
  'slam_ball',
  'stability_ball',
  'bosu',
  'foam_roller',
  'yoga_mat',
  'slant_board',
  'tibialis_bar',
  'sled',
  'plyo_box',
  'jump_rope',
  'treadmill',
  'elliptical',
  'arc_trainer',
  'stair_climber',
  'stationary_bike',
  'recumbent_bike',
  'rower',
  'ski_erg',
  'assault_bike',
  'track_or_open_space',
  'outdoor_route',
  'rings',
  'ab_wheel',
  'battle_rope',
  'sledgehammer',
  'tire',
  'arm_ergometer',
  'ghd',
  'bumper_plates',
  'chalk',
  'wall_space',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export interface LocationEquipmentSpec {
  equipment: Equipment;
  available: boolean;
  /** e.g. dumbbells 5–75 lb. Absent for non-loadable equipment. */
  min_lb?: number;
  max_lb?: number;
  /** Increment between available loads, e.g. 5 for a DB rack, 2.5 for Bowflex. */
  increment_lb?: number;
  notes?: string;
}

export interface GymLocation {
  id: LocationId;
  user_id: UserId;
  name: string;
  kind: 'home' | 'planet_fitness' | 'crossfit_box' | 'bodyweight_only' | 'other';
  /** Effective bar weight for this location's straight bar. Smith ≈ 15–20 lb. */
  bar_weight_lb: number;
  /** Effective Smith-machine bar weight. PF Smith machines are counterbalanced. */
  smith_bar_weight_lb: number;
  equipment: LocationEquipmentSpec[];
  /** Travel/setup overhead the engine subtracts from the budget. */
  overhead_min?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exercises
// ─────────────────────────────────────────────────────────────────────────────

export type LoadStyle =
  /** Load entered is the total of both hands (DB pairs). */
  | 'total_dumbbell_pair'
  /** Single implement, load as entered. */
  | 'single_implement'
  /** Bar + plates; bar weight comes from the location. */
  | 'barbell'
  /** Smith bar + plates; smith bar weight comes from the location. */
  | 'smith'
  /** Machine stack; load as displayed on the stack. */
  | 'stack'
  /** Bodyweight only; `load_lb` records ADDED load (weight vest, DB, belt). */
  | 'bodyweight'
  /** Assisted movement; `load_lb` records assistance as a negative contribution. */
  | 'assisted'
  /** Band tension; approximate, tracked by band color mapping. */
  | 'band'
  /** No load concept (mobility, breathwork, carries measured by distance). */
  | 'none';

export interface Exercise {
  id: ExerciseId;
  name: string;
  /** Slug for matching across datasets and CSV imports. */
  slug: string;
  aliases: string[];
  pattern: MovementPattern;
  force: Force;
  mechanic: Mechanic;
  level: Level;
  /** Every equipment option that can perform this movement. Empty = bodyweight. */
  equipment: Equipment[];
  /** 0–1 per region, how hard one working set taxes that region. */
  region_loads: RegionLoadMap;
  load_style: LoadStyle;
  /** True when this is a viable substitute at a barbell-free gym (Planet Fitness). */
  barbell_free: boolean;
  /** True when the eccentric is the point (Nordics, slow negatives, depth jumps). */
  eccentric_dominant: boolean;
  /** Ground-contact count per rep for plyometric volume accounting. 0 for non-plyo. */
  plyo_contacts_per_rep: number;
  /** Knees Over Toes step this exercise belongs to, when applicable. */
  kot_step?: string;
  /** Short coaching cue shown on the exercise card. */
  cue?: string;
  instructions: string[];
  /** Ordered substitution candidates by exercise slug — curated, beats generic ranking. */
  preferred_alternatives?: string[];
  /** Movements that must not share a session with this one. */
  contraindicated_with?: string[];
  /** Regions this exercise actively rehabilitates rather than merely loads. */
  rehab_for?: Region[];
  media?: ExerciseMedia;
  /** Where this record came from, for the coverage report and license audit. */
  source: 'free-exercise-db' | 'gym-visual' | 'curated' | 'kot';
}

export interface ExerciseMedia {
  gif_url?: string;
  thumb_url?: string;
  image_urls?: string[];
  /** Required in-app wherever Gym Visual media is displayed. */
  attribution?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Athlete state & inputs
// ─────────────────────────────────────────────────────────────────────────────

export interface OuraDaily {
  date: IsoDate;
  readiness_score?: number;
  sleep_score?: number;
  activity_score?: number;
  hrv_ms?: number;
  resting_hr?: number;
  body_temp_deviation_c?: number;
  respiratory_rate?: number;
  steps?: number;
  active_calories?: number;
  met_minutes?: number;
  vo2max?: number;
  cardiovascular_age?: number;
  stress_high_min?: number;
  resilience?: 'limited' | 'adequate' | 'solid' | 'strong' | 'exceptional';
}

export interface SelfReport {
  date: IsoDate;
  /** 1 = wrecked, 5 = fresh. */
  soreness: Slider1to5;
  /** 1 = flat, 5 = energized. */
  energy: Slider1to5;
  /** 1 = calm, 5 = maxed out. NOTE: higher is WORSE for stress. */
  stress: Slider1to5;
}

export interface BodyMetric {
  date: IsoDate;
  weight_lb: number;
  body_fat_pct?: number;
  source: 'manual' | 'scale_photo' | 'import';
}

export interface Injury {
  id: string;
  region: Region;
  label: string;
  onset: IsoDate;
  kind: 'recent' | 'longstanding';
  current_pain: Pain0to10;
  /** Movements or patterns that provoke it. */
  aggravators: string[];
  notes?: string;
  /** Set when Seth resolves it. Injuries never disappear on their own. */
  resolved_on?: IsoDate;
}

export interface InjuryCheckin {
  injury_id: string;
  date: IsoDate;
  pain: Pain0to10;
  note?: string;
}

export const GOAL_MODES = [
  'maintain',
  'tone',
  'bulk',
  'six_pack',
  'strength',
  'power',
  'endurance',
  'rehab',
  'vo2_focus',
  'fat_loss',
] as const;
export type GoalMode = (typeof GOAL_MODES)[number];

/** The four shown as primary buttons; the rest live behind "More". */
export const PRIMARY_GOAL_MODES: GoalMode[] = ['maintain', 'tone', 'bulk', 'six_pack'];

export interface GoalSettings {
  mode: GoalMode;
  /** Athletic north star. Drives plyo/power slot priority. */
  vertical_jump_focus: boolean;
  warmup_min: number;
  cooldown_min: number;
  /** Warm-up/cooldown sit ON TOP of the stated budget when true (PRD §8.1). */
  warmup_outside_budget: boolean;
}

export interface Athlete {
  user_id: UserId;
  birth_date: IsoDate;
  height_in: number;
  /** Most recent known bodyweight; used for %BW standards and bodyweight loads. */
  bodyweight_lb: number;
  /** Measured max beats Oura beats 220−age (RESEARCH §4 open question). */
  hr_max?: number;
  hr_max_source?: 'measured_strava' | 'oura' | 'formula';
  resting_hr?: number;
  standing_reach_in?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────────────────────────

export interface SetLog {
  set_index: number;
  reps: number;
  /** TOTAL LOAD in pounds, per the convention at the top of this file. */
  load_lb: number;
  rpe?: Rpe;
  completed: boolean;
  /**
   * True when `load_lb` records ASSISTANCE rather than resistance (assisted
   * pull-up and dip machines). The database enforces `load_lb >= 0` unless this
   * flag is set, so the logging layer must derive it from
   * `exercise.load_style === 'assisted'` on write.
   */
  is_assisted?: boolean;
  /** For timed holds and carries. */
  duration_s?: number;
  distance_mi?: number;
}

export interface LoggedExercise {
  exercise_id: ExerciseId;
  sets: SetLog[];
  /** Filled when Seth swapped away from what the engine prescribed. */
  swapped_from?: ExerciseId;
  note?: string;
}

export const SESSION_TYPES = [
  'strength',
  'kot',
  'power',
  'vo2',
  'zone2',
  'sprint',
  'mobility',
  'recovery',
  'external',
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export interface SessionLog {
  id: string;
  date: IsoDate;
  type: SessionType;
  location_id?: LocationId;
  duration_min: number;
  exercises: LoggedExercise[];
  /** Present for cardio sessions. */
  cardio?: CardioLog;
  /** Seth's post-session note, or the LLM's parse of a whiteboard photo. */
  note?: string;
  completed: boolean;
}

export interface CardioLog {
  date: IsoDate;
  modality: CardioModality;
  duration_min: number;
  distance_mi?: number;
  avg_hr?: number;
  max_hr?: number;
  /** Minutes in each zone, computed from the Strava HR stream. */
  zone_minutes?: ZoneMinutes;
  rpe?: Rpe;
  source: 'strava' | 'manual' | 'import';
  strava_activity_id?: string;
}

export const CARDIO_MODALITIES = [
  'run',
  'walk',
  'ruck',
  'bike',
  'row',
  'ski_erg',
  'elliptical',
  'stair',
  'swim',
  'other',
] as const;
export type CardioModality = (typeof CARDIO_MODALITIES)[number];

export type ZoneMinutes = Record<'z1' | 'z2' | 'z3' | 'z4' | 'z5', number>;

// ─────────────────────────────────────────────────────────────────────────────
// Programs
// ─────────────────────────────────────────────────────────────────────────────

export interface ProgramStep {
  id: string;
  order: number;
  name: string;
  /** e.g. "25% BW per hand × 5 reps each side". Human-readable, shown in-app. */
  standard_text: string;
  /** Machine-checkable form of the standard, when expressible. */
  standard?: ProgramStandard;
  exercise_slug: string;
  /** What to do when the location lacks the canonical equipment. */
  substitutions?: { equipment_missing: Equipment; use_slug: string; note?: string }[];
  /** Steps that must be met before this one unlocks. */
  prerequisites?: string[];
  block: string;
  /**
   * Which `ProgramPhase` this step belongs to. Absent on single-phase programs,
   * where every step is always in play.
   */
  phase_id?: string;
  /**
   * Ordered regression → progression ladder for this movement, easiest first.
   * Free text, one rung per entry: how to make the movement harder or easier
   * without leaving the step. Shown as the "make it fit today" list in-app.
   */
  progressions?: string[];
  /** Video demonstration of this movement, from the program's own source material. */
  demo_url?: string;
  /**
   * True when `standard.reps` / `standard.hold_s` is PER SIDE rather than total.
   * `standard.per_hand` is about load; this is about volume.
   */
  per_side?: boolean;
  /** Prescribed rest between sets, in seconds. Absent means "no fixed rest". */
  rest_s?: number;
}

export interface ProgramStandard {
  /** Load expressed as a fraction of bodyweight, e.g. 0.25 for 25% BW. */
  pct_bodyweight?: number;
  /** Per hand, rather than total — common in KOT standards. */
  per_hand?: boolean;
  reps?: number;
  sets?: number;
  hold_s?: number;
  distance_mi?: number;
  duration_min?: number;
}

export interface Program {
  slug: string;
  name: string;
  description: string;
  /** Session ordering rule. KOT is strictly ground-up. */
  ordering: 'ground_up' | 'as_listed' | 'engine_choice';
  /** Days per week this program claims. */
  days_per_week: [number, number];
  blocks: { id: string; name: string; order: number; note?: string }[];
  steps: ProgramStep[];
  target_cycles: number;
  source: string;
  attribution?: string;
  /**
   * Sequential phases, in `order`. A phased program is run one phase at a time:
   * the athlete graduates out of a phase when its `weeks` elapse, or — for an
   * open-ended phase (`weeks: null`) — when every standard in it is met.
   */
  phases?: ProgramPhase[];
  /**
   * Per-weekday session templates. One entry per (phase, weekday) the program
   * trains. Days a phase does not train simply have no entry.
   */
  days?: ProgramDay[];
  /** The phase the athlete is in right now — a `ProgramPhase.id`. */
  current_phase_id?: string;
}

/**
 * How a phase turns bodyweight into prescribed load. Discriminated on `kind`.
 *
 *   - `bodyweight_only`   — no external load at all, for the whole phase.
 *   - `percent_bw_ramp`   — load ramps as a percentage of bodyweight, week over
 *                           week: week 1 is bodyweight, week 2 starts at
 *                           `start_pct`, and every week after adds
 *                           `weekly_increment_pct`. Percentages are whole
 *                           numbers (25 means 25% of bodyweight), unlike
 *                           `ProgramStandard.pct_bodyweight`, which is a
 *                           fraction.
 *   - `standards_driven`  — load is whatever it takes to reach the phase's
 *                           benchmarks; there is no calendar ramp.
 */
export type PhaseLoadRule =
  | { kind: 'bodyweight_only' }
  | { kind: 'percent_bw_ramp'; start_pct: number; weekly_increment_pct: number }
  | { kind: 'standards_driven' };

/** One sequential block of a phased program — KOT's Zero, Dense and Standards. */
export interface ProgramPhase {
  id: string;
  name: string;
  /** 1-based position in the sequence. Phases run in ascending order. */
  order: number;
  /** Planned length in weeks, or `null` for open-ended (run until standards are met). */
  weeks: number | null;
  /** Training days per week. Always equal to `weekdays.length`. */
  days_per_week: number;
  /** Weekdays this phase trains, 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  /** Expected session length as a `[min, max]` pair of minutes. */
  session_min: [number, number];
  load_rule: PhaseLoadRule;
  description: string;
}

/**
 * The session template for one weekday of one phase: the ordered blocks, each
 * naming the `ProgramStep`s to run. A step may appear on several days.
 */
export interface ProgramDay {
  phase_id: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Shown as the session title, e.g. "Dense — Monday". */
  title: string;
  /** One line on what this day trains, e.g. "Lower body". */
  focus: string;
  blocks: { title: string; step_ids: string[] }[];
  /** Video playlist for this day, when the program's source material has one. */
  demo_url?: string;
}

export interface ProgramProgress {
  program_slug: string;
  cycle: number;
  /** Step id → most recent evidence the standard was met. */
  met: Record<string, { date: IsoDate; evidence: string }>;
  current_step_ids: string[];
  /** The `ProgramPhase.id` currently being run, on a phased program. */
  phase_id?: string;
  /** 1-based week inside `phase_id`. Drives `percent_bw_ramp` load. */
  week_in_phase?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine input & output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the engine needs to produce a plan. Assembled by the caller from
 * Supabase; the engine performs no I/O and reads nothing else.
 */
export interface PlanInput {
  today: IsoDate;
  athlete: Athlete;
  goals: GoalSettings;
  /** Minutes available today. */
  budget_min: number;
  location: GymLocation;
  /** All locations, so the engine can suggest "Home instead". */
  all_locations?: GymLocation[];
  oura_today?: OuraDaily;
  /** Last 28 days of Oura, newest first or oldest first — the engine sorts. */
  oura_history: OuraDaily[];
  self_report?: SelfReport;
  recent_self_reports: SelfReport[];
  /** Last 28+ days of sessions. More history improves predictions. */
  history: SessionLog[];
  cardio_history: CardioLog[];
  injuries: Injury[];
  body_metrics: BodyMetric[];
  program?: Program;
  program_progress?: ProgramProgress;
  exercises: Exercise[];
  /** Deterministic seed so the same inputs always yield the same plan. */
  seed?: number;
  /** Set when Seth pulled a future day forward from the week carousel. */
  forced_session_type?: SessionType;
}

export type ReadinessBand = 'push' | 'as_planned' | 'reduced' | 'recovery';

export interface ReadinessAssessment {
  band: ReadinessBand;
  /** 0–100 composite. Oura readiness when present, else derived from sliders. */
  score: number;
  source: 'oura' | 'sliders' | 'blend' | 'default';
  /** Multiply prescribed load by this. 1.025 push, 1.0 planned, 0.9 reduced. */
  load_multiplier: number;
  /** Hard ceiling on prescribed RPE, or undefined for none. */
  rpe_cap?: Rpe;
  /** Extra set on primary lifts when readiness is high. */
  set_delta: number;
  hrv_vs_baseline_pct?: number;
  reasons: string[];
}

export interface LedgerEntry {
  region: Region;
  /** Sum of set-level load × region weight over the window, in pound-reps ÷ 1000. */
  load_7d: number;
  load_28d: number;
  /** 7-day ÷ (28-day ÷ 4). Gabbett's acute:chronic workload ratio. */
  acwr: number;
  hours_since_hard_hit: number | null;
  hours_since_eccentric: number | null;
  /** True when this region may take a hard stimulus today. */
  available: boolean;
  block_reason?: string;
}

export type Ledger = Record<Region, LedgerEntry>;

export interface PrescribedSet {
  set_index: number;
  reps: number;
  /** Prescribed TOTAL load, already rounded to an achievable increment. */
  load_lb: number;
  rpe_target?: Rpe;
  rest_s: number;
  /** True for warm-up sets, which don't count toward the ledger. */
  warmup?: boolean;
  /** Mirrors `SetLog.is_assisted`; set from the exercise's load style. */
  is_assisted?: boolean;
  /**
   * For timed work — holds, carries, and locomotion. When set, `reps` is 0 and
   * the runtime shows a clock rather than a rep counter.
   */
  duration_s?: number;
  /** For distance work. */
  distance_mi?: number;
  /**
   * True when this set is performed on both sides. `reps` and `duration_s` are
   * the TOTAL across both, matching the total-load convention used for
   * dumbbell pairs (PRD §8.2) — so the ledger, the tonnage and the time
   * estimate all see the real work without knowing anything about sides. The
   * runtime halves it again to show "25 each side" on the card.
   */
  per_side?: boolean;
}

export interface PredictionBand {
  /** Median ± IQR of recent e1RM, mapped to the prescribed rep count. */
  normal: [number, number];
  /** Linear trend + readiness adjustment. What he should hit today. */
  probable: number;
  /** e1RM-derived rep max. The honest ceiling. */
  max: number;
  /** 0–1. Shrinks below 3 sessions of history. */
  confidence: number;
  basis: 'history' | 'program_standard' | 'cold_start';
}

export interface PrescribedExercise {
  exercise_id: ExerciseId;
  exercise: Exercise;
  sets: PrescribedSet[];
  prediction?: PredictionBand;
  /** The one-line reason this exercise is here today. */
  why: string;
  /** Superset partner, when the engine paired them for time efficiency. */
  superset_with?: ExerciseId;
  /** KOT or other program step this fulfils. */
  program_step_id?: string;
  estimated_min: number;
}

export interface CardioPrescription {
  modality: CardioModality;
  structure: 'steady' | 'intervals' | 'walk_run' | 'sprints' | 'ruck';
  duration_min: number;
  /** Target HR window in bpm, derived from the athlete's HRmax. */
  target_bpm: [number, number];
  target_zone: 'z1' | 'z2' | 'z3' | 'z4' | 'z5';
  /** Interval shape, when structure is not steady. */
  intervals?: { work_min: number; rest_min: number; rounds: number; work_bpm: [number, number] };
  distance_mi?: number;
  why: string;
}

export interface SessionBlock {
  /** Assembly priority order (RESEARCH §6.2): power → strength → conditioning → zone2 → mobility. */
  kind: 'warmup' | 'power' | 'strength' | 'program' | 'conditioning' | 'zone2' | 'mobility' | 'cooldown';
  title: string;
  exercises: PrescribedExercise[];
  cardio?: CardioPrescription;
  estimated_min: number;
  /**
   * One line of guidance for a block that reserves minutes without prescribing
   * movements — the warm-up and cool-down bookends. Without it the block is an
   * unexplained ten minutes on the card.
   */
  note?: string;
}

export interface PrescribedSession {
  date: IsoDate;
  type: SessionType;
  title: string;
  location_id: LocationId;
  /** The single line Seth reads before deciding to show up. */
  why: string;
  blocks: SessionBlock[];
  estimated_min: number;
  readiness: ReadinessAssessment;
  /** Everything the engine chose not to do, and why. Powers the audit view. */
  notes: string[];
  /** True when an autoregulated deload is in force. */
  deload: boolean;
}

export interface WeekDay {
  date: IsoDate;
  day_index: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  session: PrescribedSession;
  /** False for days beyond today — projected under assumed-neutral readiness. */
  is_today: boolean;
}

export interface PlanResult {
  generated_at: IsoInstant;
  today: PrescribedSession;
  /** Today plus the next six days. */
  week: WeekDay[];
  ledger: Ledger;
  deload: DeloadState;
  weekly: WeeklyDose;
  /** Constraint violations the engine could not satisfy. Empty in a healthy plan. */
  warnings: string[];
  /** Deterministic hash of inputs → plan, for diffing across re-plans. */
  signature: string;
}

export interface DeloadState {
  active: boolean;
  /** Which autoregulation trigger fired (RESEARCH §6.4). */
  triggers: string[];
  started_on?: IsoDate;
  ends_on?: IsoDate;
  volume_multiplier: number;
  load_multiplier: number;
  /** Weeks since the last deload. Forced at 8–10. */
  weeks_since_last: number;
}

/** Rolling weekly dose against the evidence targets in RESEARCH §6.1. */
export interface WeeklyDose {
  zone2_min: number;
  zone2_target_min: number;
  /** ≤10%/week ramp ceiling on aerobic volume. */
  zone2_ceiling_min: number;
  vo2_sessions: number;
  strength_min: number;
  strength_target_min: [number, number];
  mobility_sessions: number;
  plyo_contacts: number;
  tonnage_lb: number;
  sessions: number;
  steps_avg?: number;
}

export type SwapDifficulty = 'easier' | 'same' | 'harder';

export interface SwapCandidate {
  exercise: Exercise;
  difficulty: SwapDifficulty;
  /** 0–1 ranking score: pattern match, region match, equipment fit. */
  score: number;
  reason: string;
  /** Prescription re-derived for the substitute. */
  sets: PrescribedSet[];
  estimated_min: number;
}
