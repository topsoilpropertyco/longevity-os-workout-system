/**
 * Longevity OS — source vocabulary → canonical vocabulary mapping tables
 *
 * THIS FILE IS MEANT TO BE AUDITED BY A HUMAN. Every table below is an
 * editorial judgement translating a loose public-dataset vocabulary into the
 * canonical `Equipment` / `Region` / `MovementPattern` unions in
 * `packages/engine/src/types.ts`. Where a source value has no honest canonical
 * equivalent it maps to `null` and is listed in the ingest report as UNMAPPED
 * rather than being silently forced into a neighbouring slug.
 *
 * Correcting a mapping here and re-running `npx tsx scripts/ingest-exercises.ts`
 * is the intended workflow — never hand-edit `data/exercises.json`.
 */

import type { Equipment, MovementPattern, Region } from '../../packages/engine/src/types';

// ─────────────────────────────────────────────────────────────────────────────
// Equipment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `free-exercise-db` equipment vocabulary (13 distinct values incl. null).
 * `null` here means "the source told us nothing useful" — the ingest falls back
 * to bodyweight when no equipment can be inferred from the name.
 */
export const FREE_EXERCISE_DB_EQUIPMENT: Record<string, Equipment[] | null> = {
  barbell: ['barbell'],
  dumbbell: ['dumbbell'],
  'body only': ['bodyweight'],
  cable: ['cable_machine'],
  machine: ['selectorized_machine'],
  kettlebells: ['kettlebell'],
  bands: ['resistance_bands'],
  'medicine ball': ['medicine_ball'],
  'exercise ball': ['stability_ball'],
  'foam roll': ['foam_roller'],
  'e-z curl bar': ['ez_curl_bar'],
  // "other" is a grab-bag: sleds, atlas stones, chains, boxes, ab wheels, cars.
  // Resolved per-exercise by NAME_EQUIPMENT_HINTS below; null = fall through.
  other: null,
};

/**
 * `hasaneyldrm/exercises-dataset` (Gym Visual) equipment vocabulary, 28 values.
 * Two traps worth knowing about:
 *  - `sled machine` in this dataset is the 45° LEG PRESS sled ("sled 45° leg
 *    press", "hack calf raise"), NOT a push/drag sled. It maps to `leg_press`.
 *  - `weighted` means bodyweight + an added implement (weighted crunch, weighted
 *    dip). It maps to bodyweight; the added load is `load_lb` at runtime.
 */
export const GYM_VISUAL_EQUIPMENT: Record<string, Equipment[] | null> = {
  'body weight': ['bodyweight'],
  dumbbell: ['dumbbell'],
  cable: ['cable_machine'],
  barbell: ['barbell'],
  'olympic barbell': ['barbell'],
  'ez barbell': ['ez_curl_bar'],
  'trap bar': ['trap_bar'],
  'smith machine': ['smith_machine'],
  'leverage machine': ['selectorized_machine'],
  'sled machine': ['leg_press'], // 45° leg press sled — see note above
  band: ['resistance_bands'],
  'resistance band': ['resistance_bands'],
  kettlebell: ['kettlebell'],
  weighted: ['bodyweight'], // bodyweight movement + added load
  assisted: ['assisted_pullup_machine'],
  'stability ball': ['stability_ball'],
  'bosu ball': ['bosu'],
  'medicine ball': ['medicine_ball'],
  roller: ['foam_roller'],
  rope: null, // mixed bag: battle ropes, jump rope, stretching strap — see hints
  'wheel roller': null, // ab wheel — no canonical slug yet (AUDIT: add one?)
  hammer: null, // sledgehammer — not in our equipment universe
  tire: null, // tire flip — not in our equipment universe
  'stationary bike': ['stationary_bike'],
  'elliptical machine': ['elliptical'],
  'stepmill machine': ['stair_climber'],
  'skierg machine': ['ski_erg'],
  'upper body ergometer': null, // arm bike — no canonical slug (AUDIT: add one?)
};

/**
 * Name-based equipment hints, applied when the source equipment value is absent
 * or unmapped. Ordered: the FIRST pattern that matches wins, so put specific
 * patterns above general ones.
 */
export const NAME_EQUIPMENT_HINTS: { pattern: RegExp; equipment: Equipment[] }[] = [
  { pattern: /\bsmith\b/, equipment: ['smith_machine'] },
  { pattern: /\b(sled|prowler)\b/, equipment: ['sled'] },
  { pattern: /\b(treadmill|jogging|running|walking, treadmill)\b/, equipment: ['treadmill'] },
  { pattern: /\belliptical\b/, equipment: ['elliptical'] },
  { pattern: /\bstair ?master|step ?mill\b/, equipment: ['stair_climber'] },
  { pattern: /\browing|rower\b/, equipment: ['rower'] },
  { pattern: /\bski ?erg\b/, equipment: ['ski_erg'] },
  { pattern: /\bassault bike|air bike\b/, equipment: ['assault_bike'] },
  { pattern: /\brecumbent\b/, equipment: ['recumbent_bike'] },
  { pattern: /\b(bicycling|stationary bike|spin bike)\b/, equipment: ['stationary_bike'] },
  { pattern: /\b(jump rope|rope jumping|skipping rope)\b/, equipment: ['jump_rope'] },
  { pattern: /\bbattl(e|ing) ropes?\b/, equipment: ['cable_machine'] },
  { pattern: /\bslant ?board\b/, equipment: ['slant_board'] },
  { pattern: /\btib(ialis)? bar\b/, equipment: ['tibialis_bar'] },
  { pattern: /\b(box jump|depth jump|step[- ]?up onto a box|plyo box)\b/, equipment: ['plyo_box'] },
  { pattern: /\b(pull[- ]?up|chin[- ]?up|hanging|muscle[- ]?up)\b/, equipment: ['pull_up_bar'] },
  { pattern: /\bdips?\b/, equipment: ['dip_station'] },
  { pattern: /\b(rings|ring )\b/, equipment: ['rings'] },
  { pattern: /\bghd|glute ham raise\b/, equipment: ['ghd'] },
  { pattern: /\bnordic\b/, equipment: ['nordic_support'] },
  { pattern: /\bsuspension|trx\b/, equipment: ['suspension_trainer'] },
  { pattern: /\blat pulldown|pulldown\b/, equipment: ['lat_pulldown'] },
  { pattern: /\bleg press\b/, equipment: ['leg_press'] },
  { pattern: /\bleg extension\b/, equipment: ['leg_extension'] },
  { pattern: /\bleg curl\b/, equipment: ['leg_curl'] },
  { pattern: /\bpec deck|pec fly machine\b/, equipment: ['pec_deck'] },
  { pattern: /\bhyperextension|back extension\b/, equipment: ['back_extension_bench'] },
  { pattern: /\bincline bench|decline bench|bench press\b/, equipment: ['bench_adjustable'] },
  { pattern: /\bfoam roll|smr\b/, equipment: ['foam_roller'] },
  { pattern: /\bstretch|pose\b/, equipment: ['yoga_mat'] },
  { pattern: /\bwall\b/, equipment: ['wall_space'] },
  { pattern: /\bsprint|dash|acceleration|bound|skip\b/, equipment: ['track_or_open_space'] },
];

/**
 * Equipment that a barbell-free gym (Planet Fitness — RESEARCH §2: no olympic
 * barbells, racks, platforms, bumper plates, GHDs) cannot supply. Anything
 * requiring one of these gets `barbell_free: false` and needs an alternative.
 * NOTE: fixed-weight straight/EZ bars ARE available at PF, so `fixed_barbell`
 * and `ez_curl_bar` are deliberately absent from this list.
 */
export const BARBELL_GATED_EQUIPMENT: Equipment[] = [
  'barbell',
  'trap_bar',
  'power_rack',
  'bumper_plates',
  'ghd',
  'sled',
  'chalk',
];

// ─────────────────────────────────────────────────────────────────────────────
// Muscles → Regions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union of BOTH source muscle vocabularies (free-exercise-db
 * primary/secondaryMuscles; Gym Visual muscle_group / target /
 * secondary_muscles) mapped onto the load-ledger `Region` union.
 *
 * A muscle may spread across regions with weights — e.g. glutes load the hips
 * fully and the posterior chain substantially. Weights are multiplied by 1.0
 * for a primary muscle and 0.4 for a secondary one, then summed and clamped to
 * 1.0 (see deriveRegionLoads in derive.ts).
 */
export const MUSCLE_REGION_WEIGHTS: Record<string, Partial<Record<Region, number>>> = {
  // ── lower body
  quadriceps: { knees_quads: 1 },
  quads: { knees_quads: 1 },
  hamstrings: { posterior_chain: 1, knees_quads: 0.2 },
  glutes: { hips_glutes: 1, posterior_chain: 0.6 },
  gluteus: { hips_glutes: 1, posterior_chain: 0.6 },
  abductors: { hips_glutes: 0.8 },
  adductors: { hips_glutes: 0.8 },
  'inner thighs': { hips_glutes: 0.8 },
  groin: { hips_glutes: 0.8 },
  'hip flexors': { hips_glutes: 0.7, core: 0.3 },
  calves: { calves_achilles: 1 },
  soleus: { calves_achilles: 1 },
  ankles: { calves_achilles: 0.6 },
  'ankle stabilizers': { calves_achilles: 0.6 },
  feet: { calves_achilles: 0.4 },
  shins: { calves_achilles: 0.8 }, // tibialis anterior — the KOT lower-leg driver

  // ── trunk
  abdominals: { core: 1 },
  abs: { core: 1 },
  'lower abs': { core: 1 },
  core: { core: 1 },
  obliques: { core: 0.9, spine: 0.3 },
  'lower back': { low_back: 1, spine: 0.5 },
  spine: { spine: 1, low_back: 0.5 },
  'serratus anterior': { chest: 0.5, upper_back: 0.3 },

  // ── upper body
  chest: { chest: 1 },
  pectorals: { chest: 1 },
  'upper chest': { chest: 1, shoulders: 0.3 },
  shoulders: { shoulders: 1 },
  delts: { shoulders: 1 },
  deltoids: { shoulders: 1 },
  'rear deltoids': { shoulders: 0.8, upper_back: 0.4 },
  'rotator cuff': { shoulders: 0.7 },
  lats: { upper_back: 1 },
  'latissimus dorsi': { upper_back: 1 },
  'middle back': { upper_back: 1 },
  'upper back': { upper_back: 1 },
  back: { upper_back: 0.8, low_back: 0.4 },
  rhomboids: { upper_back: 0.9 },
  traps: { upper_back: 0.8, neck: 0.3 },
  trapezius: { upper_back: 0.8, neck: 0.3 },
  'levator scapulae': { neck: 0.8, upper_back: 0.3 },
  neck: { neck: 1 },
  sternocleidomastoid: { neck: 1 },
  biceps: { elbows_forearms: 1 },
  brachialis: { elbows_forearms: 1 },
  triceps: { elbows_forearms: 0.9, shoulders: 0.2 },
  forearms: { elbows_forearms: 0.8 },
  'wrist flexors': { elbows_forearms: 0.7 },
  'wrist extensors': { elbows_forearms: 0.7 },
  wrists: { elbows_forearms: 0.6 },
  hands: { elbows_forearms: 0.5 },
  'grip muscles': { elbows_forearms: 0.7 },

  // ── no regional load
  'cardiovascular system': {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Movement patterns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Name → MovementPattern rules, evaluated TOP TO BOTTOM against the normalized
 * exercise name; first match wins. Everything that falls through is classified
 * by mechanic + dominant region (see derivePattern in derive.ts).
 */
export const PATTERN_RULES: { pattern: RegExp; movement: MovementPattern }[] = [
  // cardio first — "run", "row", "bike" would otherwise be caught by other rules
  { pattern: /\b(interval|4x4|hiit|tabata|sprint interval|30\/30)\b/, movement: 'cardio_interval' },
  {
    pattern:
      /\b(bicycling|stationary bike|recumbent|elliptical|stair ?master|step ?mill|rowing|ski ?erg|jogging|zone 2|zone2|walk[- ]run|treadmill run|trail running)\b/,
    movement: 'cardio_steady',
  },
  { pattern: /\b(sprint|acceleration|flying 30|dash|prowler sprint)\b/, movement: 'sprint' },
  {
    pattern: /\b(depth jump|box jump|broad jump|jump squat|squat jump|hurdle hop|pogo|ankle hop|bound|box skip|jumping|leap|plyo|hop|jump rope|rope jumping)\b/,
    movement: 'jump',
  },
  {
    pattern: /\b(stretch|mobility|smr|foam roll|pose|yoga|couch stretch|elephant walk|deep squat hold|ankle circle|arm circle|breathing)\b/,
    movement: 'mobility',
  },
  { pattern: /\b(carry|farmer|suitcase carry|waiter walk|drag|sled push|sled pull)\b/, movement: 'carry' },
  { pattern: /\b(backward walk|backward walking|backward treadmill|backward sled|reverse walk|march|carioca|gait|walking lunge in place)\b/, movement: 'gait' },
  { pattern: /\b(side plank|side bend|lateral flexion|suitcase hold)\b/, movement: 'anti_lateral_flexion' },
  { pattern: /\b(pallof|anti[- ]rotation|bird dog|dead ?bug)\b/, movement: 'anti_rotation' },
  { pattern: /\b(plank|hollow|rollout|roller out|ab wheel|l[- ]sit|body saw|curl[- ]up)\b/, movement: 'anti_extension' },
  { pattern: /\b(russian twist|woodchop|chop|twist|rotation|windmill)\b/, movement: 'rotation' },
  { pattern: /\b(split squat|lunge|step[- ]?up|patrick step|poliquin step|bulgarian|cossack|curtsy)\b/, movement: 'lunge' },
  { pattern: /\b(squat|leg press|wall sit|hack|sissy|pistol)\b/, movement: 'squat' },
  {
    pattern: /\b(deadlift|rdl|romanian|good ?morning|hinge|swing|clean|snatch|hyperextension|back extension|jefferson curl|kettlebell swing|nordic|glute ham|hip thrust|bridge|ql extension|pull[- ]?through)\b/,
    movement: 'hinge',
  },
  { pattern: /\b(pull[- ]?up|chin[- ]?up|pulldown|pullover|muscle[- ]?up|lat pull)\b/, movement: 'vertical_pull' },
  { pattern: /\b(row|face pull|rear delt fly|reverse fly|shrug)\b/, movement: 'horizontal_pull' },
  {
    pattern: /\b(overhead press|shoulder press|military press|push press|jerk|thruster|handstand|arnold press|upright press)\b/,
    movement: 'vertical_push',
  },
  { pattern: /\b(bench press|chest press|push[- ]?up|dip|fly|flye|pec deck|floor press)\b/, movement: 'horizontal_push' },
  { pattern: /\b(slam|throw|toss|wall ball)\b/, movement: 'rotation' },
];

/** Regions that make an unclassified movement "lower body" for isolation_* fallback. */
export const LOWER_BODY_REGIONS: Region[] = [
  'knees_quads',
  'posterior_chain',
  'calves_achilles',
  'hips_glutes',
];

/**
 * Names whose eccentric IS the stimulus (RESEARCH §6.3 — these require ≥72 h
 * before the same region is hit hard again).
 */
export const ECCENTRIC_DOMINANT_PATTERNS: RegExp[] = [
  /\bnordic\b/,
  /\breverse nordic\b/,
  /\bdepth jump\b/,
  /\bdrop jump\b/,
  /\beccentric\b/,
  /\bnegative\b/,
  /\bglute ham raise\b/,
  /\bsissy squat\b/,
  /\bjefferson curl\b/,
  /\bslant board squat\b/,
];

/**
 * Ground contacts per rep for plyometric volume accounting (RESEARCH §6.3:
 * 40–60 contacts/session beginner, 80–100 intermediate). Evaluated in order.
 */
export const PLYO_CONTACT_RULES: { pattern: RegExp; contacts: number }[] = [
  { pattern: /\bdepth jump\b/, contacts: 2 }, // drop landing + rebound landing
  { pattern: /\b(alternate|multiple response|consecutive)\b.*\b(jump|hop|bound)\b/, contacts: 2 },
  { pattern: /\b(bound|skater|alternate leg)\b/, contacts: 2 },
  { pattern: /\b(pogo|ankle hop|hurdle hop|box skip|jump rope|rope jumping|tuck jump|jumping jack)\b/, contacts: 1 },
  { pattern: /\b(box jump|broad jump|squat jump|jump squat|split jump|jump lunge|burpee|leap|jumping)\b/, contacts: 1 },
];
