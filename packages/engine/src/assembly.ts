/**
 * Longevity OS — Session Assembly
 *
 * Fills the minutes budget in priority order — power → strength → conditioning
 * → Zone 2 → mobility (RESEARCH §6.2) — respecting the equipment at the chosen
 * location, the pairing exclusions, the regional load ledger, and the active
 * program's own internal ordering (KOT is strictly ground-up).
 *
 * This module produces prescriptions. Nothing else in the system may.
 */

import {
  ASSEMBLY,
  GOAL_BANDS,
  INJURY,
  MCGILL_BIG_3,
  PLYO_CONTACTS,
  REGION_GROUPS,
  VERTICAL,
} from './constants.js';
import { achievableLoad, isPerformableAt, loadCapability } from './equipment.js';
import { flaggedRegions, injuryBlocks, violatedExclusion } from './exclusions.js';
import { ledgerAllowance } from './ledger.js';
import { predictionBand, doubleProgressionBump, setsAndReps, currentE1rm, loadForReps } from './progression.js';
import type {
  Exercise,
  GoalMode,
  GymLocation,
  Injury,
  Ledger,
  LoadStyle,
  PrescribedExercise,
  PrescribedSet,
  Program,
  ProgramDay,
  ProgramPhase,
  ProgramProgress,
  ProgramStep,
  ReadinessAssessment,
  Region,
  SessionBlock,
  SessionLog,
  SessionType,
} from './types.js';
import { clamp, dayOfWeek, rankBy, round } from './util.js';
import { phaseLabel } from './why.js';

/** A static hold with no stated standard: 30 seconds a side is the usual dose. */
const DEFAULT_HOLD_S = 30;

/**
 * The block ids a program uses for its own opening and closing work.
 *
 * These are `Program.blocks[].id` values, not titles. Knees Over Toes uses
 * exactly these two; a program that names its blocks anything else simply gets
 * the generic bookends, which is the right default.
 */
const PROGRAM_WARMUP_BLOCK = 'warm_up';
const PROGRAM_COOLDOWN_BLOCK = 'mobility_cooldown';


// ─────────────────────────────────────────────────────────────────────────────
// Phased programs
//
// Knees Over Toes is not one program, it is three run in sequence: Zero is
// twelve weeks of bodyweight, Dense ramps load off the calendar, Standards
// chases twelve benchmarks. Every one of the 69 steps carries the phase it
// belongs to, and every training weekday carries a session template. Without
// the gating below the whole 69-step pool is in play on day one, and the
// engine will offer a Standards benchmark — a hinge at bodyweight — on the
// first Monday of a rehab phase that is supposed to be unloaded.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The phase being run right now. The progress record is the authority — it is
 * the thing that advances — and the program's own `current_phase_id` is the
 * seed for an athlete who has no progress row yet.
 */
export function resolvePhase(
  program: Program | undefined,
  progress: ProgramProgress | undefined,
): ProgramPhase | undefined {
  if (!program?.phases?.length) return undefined;
  const id = progress?.phase_id ?? program.current_phase_id;
  if (!id) return undefined;
  return program.phases.find((p) => p.id === id);
}

/** 1-based week inside the active phase. Absent means week 1, not week zero. */
export function weekInPhase(progress: ProgramProgress | undefined): number {
  return Math.max(1, Math.round(progress?.week_in_phase ?? 1));
}

/**
 * The session template for today, or nothing if this phase does not train
 * today. `ProgramDay.weekday` and `ProgramPhase.weekdays` both follow
 * `Date.getDay()`: 0 = Sunday … 6 = Saturday.
 */
export function programDayFor(
  program: Program | undefined,
  progress: ProgramProgress | undefined,
  date: string,
): ProgramDay | undefined {
  const phase = resolvePhase(program, progress);
  if (!phase || !program?.days?.length) return undefined;
  const weekday = dayOfWeek(date);
  if (!phase.weekdays.includes(weekday)) return undefined;
  return program.days.find((d) => d.phase_id === phase.id && d.weekday === weekday);
}

/** True when the phase's calendar says today is a training day. */
export function isProgramDay(
  program: Program | undefined,
  progress: ProgramProgress | undefined,
  date: string,
): boolean | undefined {
  const phase = resolvePhase(program, progress);
  if (!phase) return undefined;
  return phase.weekdays.includes(dayOfWeek(date));
}

/**
 * What the phase's load rule PROPOSES, in total pounds, before readiness, the
 * ledger, the deload and the equipment rounding have had their say. `null`
 * means the rule has no opinion and the usual history/standard machinery
 * decides.
 *
 *   - `bodyweight_only`  → 0, and that zero is load-bearing: it has to survive
 *                          `achievableLoad`, which rounds UP to the lightest
 *                          dumbbell in the room. Zero is a rehab phase; a
 *                          10 lb floor on the split squat is not "close
 *                          enough", it is the phase not being run.
 *   - `percent_bw_ramp`  → week 1 bodyweight, week 2 `start_pct`, and
 *                          `weekly_increment_pct` per week after that.
 *                          Percentages here are WHOLE NUMBERS — 25 means 25%
 *                          — unlike `ProgramStandard.pct_bodyweight`, which is
 *                          a fraction.
 *   - `standards_driven` → null. The benchmark on the step is the target and
 *                          there is no calendar in it.
 */
export function phaseLoadFor(args: {
  phase: ProgramPhase | undefined;
  weekInPhase: number;
  bodyweightLb: number;
  /**
   * The step being prescribed, when there is one. Only `load_ramp_override` is
   * read — a step may ramp at its own rate inside a phase that ramps at another.
   */
  step?: Pick<ProgramStep, 'load_ramp_override'> | undefined;
}): number | null {
  const { phase, bodyweightLb, step } = args;
  if (!phase) return null;
  const week = Math.max(1, Math.round(args.weekInPhase));

  switch (phase.load_rule.kind) {
    case 'bodyweight_only':
      return 0;
    case 'percent_bw_ramp': {
      // Week 1 is bodyweight in every ramped phase; week 2 is `start_pct`; each
      // week after adds the increment. Hence `week - 2` and not `week - 1`.
      if (week < 2) return 0;
      // Dense ramps at 5% a week "except the split squat, which adds 2.5%".
      // The exception is per STEP, so it cannot live on the phase, and at 5%
      // the split squat would reach 75% of bodyweight by week 12 instead of
      // the intended ~48% — on the movement the program is named for.
      const start = step?.load_ramp_override?.start_pct ?? phase.load_rule.start_pct;
      const perWeek =
        step?.load_ramp_override?.weekly_increment_pct ?? phase.load_rule.weekly_increment_pct;
      return round(((start + (week - 2) * perWeek) / 100) * bodyweightLb, 1);
    }
    case 'standards_driven':
      return null;
  }
}

/**
 * The steps in play: this phase's, plus any step that declares no phase at all.
 *
 * A step with no `phase_id` is always in play — that is what keeps a flat,
 * unphased program behaving exactly as it did before phases existed.
 */
export function stepsInPhase(program: Program, phase: ProgramPhase | undefined): ProgramStep[] {
  if (!phase) return program.steps;
  return program.steps.filter((s) => !s.phase_id || s.phase_id === phase.id);
}

export interface AssemblyInput {
  today: string;
  type: SessionType;
  budgetMin: number;
  targetRegions: Region[];
  location: GymLocation;
  ledger: Ledger;
  readiness: ReadinessAssessment;
  injuries: Injury[];
  goal: GoalMode;
  exercises: Exercise[];
  history: SessionLog[];
  bodyweightLb: number;
  program?: Program;
  programProgress?: ProgramProgress;
  deloadVolumeMultiplier: number;
  deloadLoadMultiplier: number;
  verticalFocus: boolean;
  plyoContactsThisWeek: number;
}

export interface AssemblyResult {
  blocks: SessionBlock[];
  notes: string[];
  estimatedMin: number;
  /**
   * True when the program's own weekday template already opens and closes the
   * session, so the generic bookends would be a second warm-up on top of the
   * first.
   *
   * Knees Over Toes Zero starts with a five-to-ten minute walk and ends with
   * four held stretches. Adding five generic minutes either side turned a
   * session the program says takes ten to twenty into one that read as
   * fifty-three — and told him to warm up for a walk.
   */
  suppliesOwnBookends: { warmup: boolean; cooldown: boolean };
}

/**
 * Minutes one prescribed exercise will take, including its rest.
 *
 * A timed set costs its duration, not its (zero) rep count — without this a ten
 * minute backward walk is budgeted at one minute of setup and the session
 * silently overruns by nine.
 */
export function estimateMinutes(sets: PrescribedSet[], loadStyle?: LoadStyle): number {
  const work = sets.reduce((a, s) => {
    if (s.duration_s !== undefined) return a + s.duration_s;
    // A distance costs the time it takes to cover it. Without this a
    // quarter-mile walk is budgeted at its (zero) rep count — a minute of setup
    // and nothing else — and the session overruns by the five minutes he spends
    // walking.
    if (s.distance_mi !== undefined) return a + s.distance_mi * ASSEMBLY.minutes_per_mile_walk * 60;
    return a + s.reps * ASSEMBLY.seconds_per_rep;
  }, 0);
  const rest = sets.slice(0, -1).reduce((a, s) => a + s.rest_s, 0);
  return round((setupSeconds(loadStyle) + work + rest) / 60, 2);
}

/**
 * How long it takes to get to the first rep. See the reasoning on
 * `ASSEMBLY.setup_s_by_load_style`: a wall tibialis raise and a loaded barbell
 * are not the same errand, and charging them the same minute is what made a
 * ten-to-twenty-minute rehab session read as fifty-three.
 */
export function setupSeconds(loadStyle?: LoadStyle): number {
  if (!loadStyle) return ASSEMBLY.setup_s_per_exercise;
  const table = ASSEMBLY.setup_s_by_load_style as Record<string, number | undefined>;
  return table[loadStyle] ?? ASSEMBLY.setup_s_per_exercise;
}

/**
 * Candidate pool: everything performable here, not blocked by an injury, and not
 * vetoed by the ledger — ranked for how well it serves today's target regions.
 */
export function candidatePool(input: AssemblyInput, patterns?: string[]): { exercise: Exercise; score: number }[] {
  const { exercises, location, ledger, injuries, targetRegions } = input;
  const out: { exercise: Exercise; score: number }[] = [];

  for (const ex of exercises) {
    if (!isPerformableAt(ex, location)) continue;

    const blocked = injuryBlocks(ex, injuries, INJURY.pain_block_threshold);
    if (blocked.blocked) continue;

    const allowance = ledgerAllowance(ex, ledger);
    if (allowance.multiplier === 0) continue;

    if (patterns && patterns.length && !patterns.includes(ex.pattern)) continue;

    // Region fit: how much of this exercise's load lands where we want it today.
    const wanted = targetRegions.length
      ? Object.entries(ex.region_loads)
          .filter(([r]) => targetRegions.includes(r as Region))
          .reduce((a, [, w]) => a + (w as number), 0)
      : 1;

    const total = Object.values(ex.region_loads).reduce((a, w) => a + w, 0) || 1;
    const fit = clamp(wanted / total, 0, 1);

    // Compounds earn their place on a short day; isolations are the luxury.
    const mechanicBonus = ex.mechanic === 'compound' ? 0.2 : 0;
    // Rehab movements for a flagged region are worth more, not less.
    const rehabBonus = ex.rehab_for?.some((r) => flaggedRegions(injuries).has(r)) ? 0.35 : 0;

    const score = round(fit * 0.6 + allowance.multiplier * 0.2 + mechanicBonus + rehabBonus, 4);
    if (score > 0.05) out.push({ exercise: ex, score });
  }

  return rankBy(out, (c) => c.score, (c) => c.exercise.slug);
}

/**
 * Prescribe one exercise: sets, reps, load rounded to what the rack holds, and
 * the prediction band. This is the single place a load number is decided.
 */
export function prescribe(args: {
  exercise: Exercise;
  input: AssemblyInput;
  isPrimary: boolean;
  why: string;
  programStepId?: string;
  /**
   * The program step being fulfilled, when the caller already knows it.
   *
   * Looking it up by exercise slug is not good enough on a phased program:
   * `tibialis-raise` is step 2 of Zero, step 17 of Dense and step 45 of
   * Standards, and the by-slug lookup returns whichever comes first in the
   * file. That is how a Standards benchmark ends up prescribed with a Zero
   * dose, or the other way around.
   */
  step?: ProgramStep;
  repOverride?: [number, number];
  setOverride?: number;
  /**
   * Ceiling for TIMED work. Ten minutes of backward walking is the standard, but
   * on a thirty-minute day it would eat the budget and push the ATG split squat
   * — the movement the program is actually named for — out of the session. A
   * shortened walk is still the program; a missing split squat is not.
   */
  timeCapMin?: number;
}): PrescribedExercise {
  const { exercise, input, isPrimary, why, programStepId } = args;
  const { readiness, goal, history, bodyweightLb, location, deloadVolumeMultiplier, deloadLoadMultiplier } = input;

  const base = setsAndReps({ goal, readiness, isPrimary, deloadVolumeMultiplier });
  const step = args.step ?? findProgramStep(input.program, input.programProgress, exercise.slug);
  const phase = resolvePhase(input.program, input.programProgress);

  // A program step carries its own dose. Knees Over Toes says 10 minutes of
  // backward walking and 25 tibialis raises; overriding that with the goal
  // mode's 3×10 would not be running the program, it would be running something
  // else with the program's name on it.
  const std = step?.standard;
  const repRange: [number, number] =
    args.repOverride ?? (std?.reps ? [std.reps, std.reps] : base.reps);
  // A checklist line that says "25 reps" and names no set count means one set of
  // 25, not the goal mode's three of them. Multiplying a stated program dose by
  // the goal band is the same error as overriding its rep count — 75 tibialis
  // raises is not Knee Ability Zero.
  const programSetDefault = std && std.sets === undefined ? 1 : base.sets;
  const setCount =
    args.setOverride ??
    (std?.sets ? Math.max(1, Math.round(std.sets * deloadVolumeMultiplier)) : programSetDefault);
  // Prescribe at the bottom of the range: double progression climbs from there.
  // A per-side step is prescribed as the TOTAL across both sides: 25 a side is
  // 50 reps of work and 50 reps' worth of minutes, and counting it as 25
  // undercounts the ledger, the tonnage and the clock by half.
  const perSide = step?.per_side === true;
  const reps = repRange[0] * (perSide ? 2 : 1);

  // Timed and distance work has no rep count at all.
  // A plank, a dead hang and a deep squat hold are measured in seconds. "Side
  // plank, 8 reps" is not something a person can carry out.
  const isStaticHold =
    exercise.force === 'static' &&
    (exercise.pattern === 'mobility' ||
      exercise.pattern === 'anti_extension' ||
      exercise.pattern === 'anti_rotation' ||
      exercise.pattern === 'anti_lateral_flexion');

  // The program's own number beats the movement's default shape. Zero's
  // elephant walk is 25 reps on a movement the library records as
  // `force: static, pattern: mobility`, so the default 30-second hold used to
  // swallow the 25 and prescribe a stretch instead of the dose the checklist
  // prints. A standard that states a count — reps, or a distance — IS the dose
  // (ENGINE.md §8); the default only fills a silence.
  //
  // `repOverride` is the caller prescribing this movement as an engine-chosen
  // accessory rather than as the program step it happens to share a slug with
  // — the mobility block's 2 × 8, say. The program's count is not what gets
  // prescribed there, so it does not get to cancel the hold either: a deep
  // squat hold picked as a cool-down stays a hold.
  const programStatesCount =
    (std?.reps !== undefined && args.repOverride === undefined) || std?.distance_mi !== undefined;
  const statedHold =
    std?.hold_s ??
    (std?.duration_min ? std.duration_min * 60 : undefined) ??
    (isStaticHold && !programStatesCount ? DEFAULT_HOLD_S : undefined);
  // `hold_s` on a per-side step is per side: a 60-second couch stretch is two
  // minutes on the clock. `duration_min` is already a whole-session figure, so
  // it is left alone.
  const holdSeconds =
    statedHold !== undefined && perSide && std?.duration_min === undefined
      ? statedHold * 2
      : statedHold;

  // A distance standard is measured in miles, not in reps and not on a clock.
  // `ProgramStandard.distance_mi` used to be read by nothing, so Standards'
  // quarter-mile bodyweight walk came out as the goal mode's "10 reps". An
  // explicit hold or duration still wins — that is the program stating a clock
  // — and so does nothing else: `gait` defaults a movement to timed, and the
  // stated distance outranks that default the same way a rep count does.
  const statedDistanceMi = std?.distance_mi;
  const isDistance = statedDistanceMi !== undefined && holdSeconds === undefined;

  const isTimed = holdSeconds !== undefined || (exercise.pattern === 'gait' && !isDistance);
  /** Neither reps nor load: the set is measured on a clock or on the ground. */
  const isUnrepped = isTimed || isDistance;
  const rawPrediction = predictionBand({
    exerciseId: exercise.id,
    reps,
    history,
    readiness,
    bodyweightLb,
    standard: step?.standard,
  });

  const allowance = ledgerAllowance(exercise, input.ledger);
  const injuryMultiplier = injuryLoadMultiplier(exercise, input.injuries);
  const bump = doubleProgressionBump({ exerciseId: exercise.id, exercise, history, repRange });

  // The phase rule proposes; readiness, the ledger, the injury register, the
  // deload and the equipment rounding dispose. A calendar ramp is a plan for an
  // ordinary week — it does not get to push load up on a day the rest of the
  // engine has already decided to back off.
  const phaseLoad = step
    ? phaseLoadFor({ phase, weekInPhase: weekInPhase(input.programProgress), bodyweightLb, step })
    : null;
  // `bodyweight_only` says no external load ANYWHERE in the phase, so on a
  // program day it governs the whole session, not only the program's own steps.
  // Zero is twelve weeks of unloaded knee rehab; bolting a loaded goblet squat
  // onto the end to use up the remaining budget is not "filling around the
  // program" (PRD §8.4), it is quietly cancelling it. Other session types in the
  // same twelve weeks — his strength days — are untouched.
  const unloadedSession = input.type === 'kot' && phase?.load_rule.kind === 'bodyweight_only';
  const unloadedPhase = unloadedSession || phaseLoad === 0;
  const cap = loadCapability(exercise, location);
  // A wall tibialis raise cannot hold a dumbbell. Handing it the phase's ramped
  // 40% of bodyweight produces a prescription of 82 lb, which `achievableLoad`
  // then clamps to the movement's ceiling of zero and reports as "capped at
  // 0 lb — that is the heaviest here". The ramp simply does not apply to a
  // movement with nowhere to put the weight.
  const canTakeLoad = exercise.load_style !== 'none' && cap.max_lb > 0;
  // A calendar ramp IS the progression. Adding the double-progression bump on
  // top would advance the same load twice in the same week.
  const ramped = canTakeLoad && phaseLoad !== null && phaseLoad > 0;

  const desired = ramped
    ? phaseLoad * readiness.load_multiplier * allowance.multiplier * injuryMultiplier * deloadLoadMultiplier
    : (rawPrediction.probable || loadForReps(currentE1rm(exercise.id, history), reps)) * allowance.multiplier *
        injuryMultiplier * deloadLoadMultiplier +
      bump.bump;

  // `achievableLoad` rounds UP to the lightest thing in the room, which is the
  // right answer for every load except zero. A bodyweight-only phase that came
  // back with the 10 lb Bowflex floor would not be a bodyweight phase.
  const { load_lb, capped } = unloadedPhase || (phaseLoad !== null && !canTakeLoad)
    ? { load_lb: 0, capped: null as 'min' | 'max' | null }
    : achievableLoad(desired, cap);

  // The band is what the card shows above the prescribed number. On a
  // bodyweight phase it has to agree with it. Seth runs KOT twice through
  // (PRD §3), so his second pass at Zero starts with a year of loaded split
  // squats in history — and "0 lb · probable 62 lb" on the same card is the
  // engine arguing with itself.
  const prediction = unloadedPhase
    ? { normal: [0, 0] as [number, number], probable: 0, max: 0, confidence: rawPrediction.confidence, basis: rawPrediction.basis }
    : rawPrediction;

  // Timed and mobility work does not get an RPE target: "hold this stretch at
  // RPE 8" is not an instruction anyone can follow.
  const rpe =
    isUnrepped || exercise.pattern === 'mobility'
      ? undefined
      : (Math.min(base.rpe, readiness.rpe_cap ?? 10) as PrescribedSet['rpe_target']);

  const timedSetCount = isUnrepped ? (std?.sets ?? 1) : setCount;

  // Apply the time cap, with a floor: below three minutes backward walking stops
  // being the rehab dose and becomes a gesture, so we drop the movement instead
  // of pretending a 40-second version counts.
  const rawHold = Math.round((holdSeconds ?? 600) / (std?.sets ?? 1));
  const capSeconds = args.timeCapMin
    ? Math.max(180, Math.round((args.timeCapMin * 60 - ASSEMBLY.setup_s_per_exercise) / timedSetCount))
    : rawHold;
  const cappedHoldSeconds = Math.min(rawHold, capSeconds);

  // The same cap, in miles. A distance is time on the ground like any other, so
  // on a day the program does not fit it is rationed exactly as a hold is:
  // Standards' quarter-mile warm-up walk is six honest minutes, and spending
  // all six on a thirty-minute day pushes the tibialis raise — the movement the
  // phase is built on — off the bottom of the session. A shortened walk is
  // still the program; a missing tibialis raise is not. The three-minute floor
  // inside `capSeconds` carries over, so the walk never shrinks to a gesture.
  const cappedDistanceMi =
    statedDistanceMi !== undefined && args.timeCapMin
      ? Math.min(statedDistanceMi, round(capSeconds / 60 / ASSEMBLY.minutes_per_mile_walk, 2))
      : statedDistanceMi;

  // A step that states its own rest states it for a reason — the 30 seconds
  // between ATG split-squat sets is part of the protocol, not a default.
  const restS = step?.rest_s ?? (isUnrepped ? 30 : base.rest_s);

  const sets: PrescribedSet[] = Array.from({ length: timedSetCount }, (_, i) => ({
    set_index: i,
    reps: isUnrepped ? 0 : reps,
    load_lb: exercise.load_style === 'none' ? 0 : load_lb,
    rpe_target: rpe,
    rest_s: restS,
    ...(isTimed ? { duration_s: cappedHoldSeconds } : {}),
    // The distance is per SET and never doubled for a per-side step: nobody
    // walks a quarter mile on each leg.
    ...(cappedDistanceMi !== undefined ? { distance_mi: cappedDistanceMi } : {}),
    ...(perSide ? { per_side: true } : {}),
    // The database's non-negative-load CHECK is waived only for assisted work,
    // so the flag has to travel with the prescription rather than be inferred later.
    is_assisted: exercise.load_style === 'assisted',
  }));

  const reasons = [why];
  if (bump.bump > 0 && !ramped) reasons.push(bump.reason);
  if (ramped) reasons.push(`Week ${weekInPhase(input.programProgress)} of ${phase ? phaseLabel(phase.name) : 'the phase'} — the ramp puts this at ${load_lb} lb.`);
  if (capped === 'max') reasons.push(`Capped at ${load_lb} lb — that is the heaviest here.`);
  if (capped === 'min') reasons.push(`${load_lb} lb is the lightest available — add reps instead.`);
  if (injuryMultiplier < 1) reasons.push('Lightened for a flagged region.');
  if (allowance.multiplier < 1) reasons.push('Eased off: this region is still repaying the last session.');

  return {
    exercise_id: exercise.id,
    exercise,
    sets,
    prediction,
    why: sentences(reasons),
    program_step_id: programStepId ?? step?.id,
    estimated_min: estimateMinutes(sets, exercise.load_style),
  };
}

function injuryLoadMultiplier(ex: Exercise, injuries: Injury[]): number {
  let m = 1;
  for (const injury of injuries) {
    if (injury.resolved_on) continue;
    const weight = ex.region_loads[injury.region] ?? 0;
    if (weight >= 0.3 && injury.current_pain >= INJURY.pain_caution_threshold) {
      if (ex.rehab_for?.includes(injury.region)) continue;
      m = Math.min(m, INJURY.caution_load_multiplier);
    }
  }
  return m;
}

/**
 * Last-resort lookup for a prescription that arrived without its step — an
 * engine-chosen accessory that happens to match a program movement. Scoped to
 * the active phase, because the same slug appears in all three of KOT's phases
 * with three different doses and the unscoped lookup silently returns Zero's.
 */
function findProgramStep(
  program: Program | undefined,
  progress: ProgramProgress | undefined,
  slug: string,
): ProgramStep | undefined {
  if (!program) return undefined;
  return stepsInPhase(program, resolvePhase(program, progress)).find((s) => s.exercise_slug === slug);
}

/**
 * Join clauses into something that reads as prose. Each reason is written as a
 * sentence but not all of them end like one, and a bare-space join produced
 * lines like "25 reps, per side 10 lb is the lightest available".
 */
function sentences(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (/[.!?…:]$/.test(p) ? p : `${p}.`))
    .join(' ');
}

/**
 * Assemble the session.
 *
 * Blocks are built in the fixed priority order and each is allowed to consume
 * budget until it is gone. Power before strength before conditioning before
 * Zone 2 before mobility is not a preference — it is the concurrent-training
 * interference rule made structural (RESEARCH §6.2).
 */
export function assemble(input: AssemblyInput): AssemblyResult {
  const notes: string[] = [];
  /**
   * Authored movements the clock ate, across the whole session.
   *
   * A step the LOCATION cannot do already says so; a step that resolved fine
   * and then ran out of minutes said nothing at all, which is the same hole
   * with a different cause (ENGINE.md §2 stage 12: everything the engine chose
   * not to do goes in `notes`).
   *
   * Session-scoped, not per block, because `tryAdd` runs once per block of the
   * weekday template — seven of them on a Zero day — and seven separate "ran
   * out of time" lines is the noise that buries the notes that matter.
   */
  const ranOutOfTime: string[] = [];
  const ownBookends = { warmup: false, cooldown: false };
  const blocks: SessionBlock[] = [];
  const chosen: Exercise[] = [];
  const flagged = flaggedRegions(input.injuries);

  let remaining = input.budgetMin;

  const tryAdd = (
    kind: SessionBlock['kind'],
    title: string,
    items: {
      exercise: Exercise; why: string; isPrimary: boolean; stepId?: string; step?: ProgramStep;
      reps?: [number, number]; sets?: number; timeShare?: number; allowRepeat?: boolean;
    }[],
  ): void => {
    const prescribed: PrescribedExercise[] = [];
    let index = 0;
    for (const item of items) {
      index++;
      if (remaining < ASSEMBLY.min_block_min) {
        if (kind === 'program') ranOutOfTime.push(item.exercise.name);
        continue;
      }

      // The McGill Big 3 floor and the Core block both want the curl-up, and a
      // session listing the same movement twice reads as a bug to the person
      // doing it — because it is one.
      //
      // A program day's repeat is the exception, and it is not an accident: Knee
      // Ability Zero puts the tibialis raise at the top of the session and again
      // a few minutes later, alternating with the calf raises. That second
      // listing is half the prescribed dose for the movement the phase exists to
      // train, so it is kept rather than swallowed by a guard aimed at
      // accidental overlap between blocks the ENGINE chose.
      if (!item.allowRepeat && chosen.some((c) => c.id === item.exercise.id)) continue;

      const conflict = violatedExclusion(item.exercise, chosen, { flaggedRegions: flagged });
      if (conflict) {
        notes.push(`Left out ${item.exercise.name}: ${conflict.exclusion.reason}`);
        continue;
      }

      const p = prescribe({
        exercise: item.exercise,
        input,
        isPrimary: item.isPrimary,
        why: item.why,
        programStepId: item.stepId,
        ...(item.step ? { step: item.step } : {}),
        repOverride: item.reps,
        setOverride: item.sets,
        // Divide what is left between the steps still to come, so the first
        // movement in a ground-up program cannot consume the whole session.
        ...(item.timeShare ? { timeCapMin: remaining * item.timeShare } : {}),
      });

      if (p.estimated_min > remaining + ASSEMBLY.overrun_tolerance_min) {
        // Try trimming a set before giving up on the movement entirely.
        if (p.sets.length > 1) {
          const trimmed = { ...p, sets: p.sets.slice(0, -1) };
          trimmed.estimated_min = estimateMinutes(trimmed.sets, item.exercise.load_style);
          if (trimmed.estimated_min <= remaining + ASSEMBLY.overrun_tolerance_min) {
            prescribed.push(trimmed);
            chosen.push(item.exercise);
            remaining = round(remaining - trimmed.estimated_min, 2);
            continue;
          }
        }
        if (kind === 'program') ranOutOfTime.push(item.exercise.name);
        continue;
      }

      prescribed.push(p);
      chosen.push(item.exercise);
      remaining = round(remaining - p.estimated_min, 2);
    }

    if (prescribed.length > 0) {
      blocks.push({
        kind,
        title,
        exercises: prescribed,
        estimated_min: round(prescribed.reduce((a, p) => a + p.estimated_min, 0), 2),
      });
    }
  };

  // ── Program block first when the session is a program day ──────────────────
  if (input.type === 'kot' && input.program) {
    const program = input.program;
    const phase = resolvePhase(program, input.programProgress);
    const day = programDayFor(program, input.programProgress, input.today);

    const daySteps: ProgramStep[] = day
      ? day.blocks.flatMap((b) =>
          b.step_ids.map((id) => program.steps.find((st) => st.id === id)).filter((st): st is ProgramStep => Boolean(st)),
        )
      : orderedProgramSteps(program, input.programProgress, input.today);

    const resolved = daySteps
      .map((step) => ({ step, ex: resolveStepExercise(step, input) }))
      .filter((x): x is { step: ProgramStep; ex: Exercise } => x.ex !== null);

    // A step the location cannot do leaves a hole in a session the program
    // authored, and a hole nobody can see is indistinguishable from a bug. Say
    // so once per step rather than only when the whole day comes back empty.
    const unresolvable = new Set(
      daySteps.filter((step) => !resolved.some((r) => r.step.id === step.id)).map((step) => step.name),
    );
    for (const name of unresolvable) {
      notes.push(`Left out ${name}: nothing here can do it, and it has no substitution that can.`);
    }

    // Does the program's own session fit the time on offer? Zero is a 10–20
    // minute session; on a 45-minute day there is nothing to ration, and
    // rationing anyway shortens the opening walk from the prescribed five
    // minutes to three for no reason. The time cap exists for the short day —
    // it is what stops ten minutes of backward walking eating a thirty-minute
    // session — so it is applied only when the session genuinely does not fit.
    const natural = resolved.reduce(
      (a, { step, ex }) =>
        a + prescribe({ exercise: ex, input, isPrimary: true, why: '', step, programStepId: step.id }).estimated_min,
      0,
    );
    const rationTime = natural > input.budgetMin;
    const stepCount = resolved.length;
    let placed = 0;

    const itemFor = (step: ProgramStep): {
      exercise: Exercise; why: string; isPrimary: boolean; stepId: string; step: ProgramStep;
      timeShare?: number; allowRepeat: boolean;
    } | null => {
      const ex = resolveStepExercise(step, input);
      if (!ex) return null;
      placed++;
      return {
        exercise: ex,
        why: `${program.name} — ${step.standard_text}`,
        isPrimary: true,
        stepId: step.id,
        step,
        // An equal share of what is left, so the ground-up ordering does not
        // mean the ground gets everything.
        ...(rationTime ? { timeShare: 1 / Math.max(1, stepCount - placed + 1) } : {}),
        allowRepeat: true,
      };
    };

    if (day) {
      // The day template IS the session: its blocks give the order, its
      // `step_ids` give the steps. Two blocks may share a title — Zero has a
      // second "Knee Ability" at the very end for the optional body squat —
      // and merging them by title would move that movement to before the
      // stretches, which is not the session the program prescribes.
      const before = blocks.length;
      for (const block of day.blocks) {
        const steps = block.step_ids
          .map((id) => program.steps.find((st) => st.id === id))
          .filter((st): st is ProgramStep => Boolean(st));
        const items = steps.map(itemFor).filter((x): x is NonNullable<typeof x> => x !== null);
        if (items.length === 0) continue;
        const placedBefore = blocks.length;
        tryAdd('program', `${phase ? phaseLabel(phase.name) : program.name} — ${block.title}`, items);
        // Did the program itself open or close the session? Decided on the
        // BLOCK the steps belong to, not on the template's block title, because
        // the title is prose that can be renamed and the block id is the
        // program's own structure. And only when the block actually landed —
        // a warm-up that did not fit is not a warm-up he did.
        if (blocks.length > placedBefore) {
          const ids = new Set(steps.map((st) => st.block));
          if (ids.has(PROGRAM_WARMUP_BLOCK)) ownBookends.warmup = true;
          if (ids.has(PROGRAM_COOLDOWN_BLOCK)) ownBookends.cooldown = true;
        }
      }
      // Counted in blocks actually placed, not items offered: a step can resolve
      // to a movement and still not fit the minutes, and a session with no
      // program work in it needs to say so either way.
      if (blocks.length === before) {
        notes.push('No program movements are available at this location today.');
      }
    } else {
      const items = orderedProgramSteps(program, input.programProgress, input.today)
        .map(itemFor)
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (items.length === 0) {
        notes.push('No program movements are available at this location today.');
      }
      tryAdd('program', `${program.name} — ground up`, items);
    }
  }

  // ── Power: always first, always fresh, never after aerobic work ────────────
  if (input.type === 'power' || (input.verticalFocus && input.type === 'strength' && remaining >= 25)) {
    const contactsLeft = PLYO_CONTACTS.intermediate[1] - input.plyoContactsThisWeek;
    if (contactsLeft <= 0) {
      notes.push(`Plyometric contacts for the week are used up (${input.plyoContactsThisWeek}).`);
    } else {
      const pool = candidatePool(input, ['jump', 'sprint']).filter(({ exercise }) =>
        plyoUnlocked(exercise, input),
      );
      const items = pool.slice(0, 2).map(({ exercise }) => ({
        exercise,
        why: 'Power goes first, while the nervous system is fresh — after cardio it is wasted effort.',
        isPrimary: true,
        reps: [3, 5] as [number, number],
        sets: 4,
      }));
      tryAdd('power', 'Power — fresh and fast', items);
    }
  }

  // ── Strength ───────────────────────────────────────────────────────────────
  if (input.type === 'strength' || (input.type === 'kot' && remaining >= 12)) {
    const compoundPatterns = ['squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull'];
    const pool = candidatePool(input).filter(({ exercise }) => compoundPatterns.includes(exercise.pattern));
    const picked = pickDistinctPatterns(pool, remaining >= 40 ? 4 : remaining >= 25 ? 3 : 2);

    const items = picked.map(({ exercise }, i) => ({
      exercise,
      why:
        i === 0
          ? 'Your main lift today — the one worth being fresh for.'
          : 'Balances the session across patterns so nothing gets overworked.',
      isPrimary: i === 0,
    }));
    tryAdd('strength', input.type === 'kot' ? 'Upper body — pairs with the knee work' : 'Strength', items);

    // Supersets on short days: agonist/antagonist pairs are time-efficient and
    // do not impair performance (RESEARCH §6.3).
    if (input.budgetMin <= ASSEMBLY.superset_budget_threshold_min) {
      pairSupersets(blocks);
      notes.push('Paired push with pull to fit the session into the time you have.');
    }
  }

  // ── Core, when the goal mode asks for it ───────────────────────────────────
  const coreBlocks = GOAL_BANDS[input.goal].core_blocks_per_week;
  if (coreBlocks > 0 && remaining >= 6 && input.type !== 'recovery') {
    const pool = candidatePool(input, ['anti_extension', 'anti_rotation', 'anti_lateral_flexion', 'rotation']);
    const items = pool.slice(0, coreBlocks >= 3 ? 3 : 2).map(({ exercise }) => ({
      exercise,
      why:
        input.goal === 'six_pack'
          ? 'Abs are built here and revealed by the Zone 2 — both halves matter.'
          : 'Trunk work keeps the low back out of trouble.',
      isPrimary: false,
      reps: [10, 15] as [number, number],
    }));
    tryAdd('strength', 'Core', items);
  }

  // ── Low-back rehab floor: McGill Big 3, near-daily ─────────────────────────
  // The code below calls this floor "non-negotiable", and then a five-minute
  // gate negotiates it away without a word. Skipping it on a short day is the
  // right call — five minutes of trunk work is not worth cutting the knee work
  // the phase exists for — but a floor that quietly is not a floor is worse
  // than no floor, because he would never know to do it himself.
  if (flagged.has('low_back') && remaining < 5) {
    notes.push(
      'No room for the McGill Big 3 today. It is the low-back floor and it is near-daily — ' +
        'worth five minutes of your own before bed.',
    );
  }
  if (flagged.has('low_back') && remaining >= 5) {
    const big3 = MCGILL_BIG_3.map((slug) => input.exercises.find((e) => e.slug === slug)).filter(
      (e): e is Exercise => Boolean(e),
    );
    tryAdd(
      'mobility',
      'McGill Big 3',
      big3.map((exercise) => ({
        exercise,
        why: 'The low-back rehab floor. Near-daily, light, and non-negotiable.',
        isPrimary: false,
        reps: [8, 10] as [number, number],
        sets: 2,
      })),
    );
  }

  // ── Mobility / recovery ────────────────────────────────────────────────────
  if (input.type === 'mobility' || input.type === 'recovery' || remaining >= 8) {
    const pool = candidatePool(input, ['mobility']);
    const count = input.type === 'mobility' || input.type === 'recovery' ? 5 : 2;
    const items = pool.slice(0, count).map(({ exercise }) => ({
      exercise,
      why:
        input.type === 'recovery'
          ? 'Today is about repaying the debt, not adding to it.'
          : 'Ends the session where the next one starts.',
      isPrimary: false,
      reps: [8, 10] as [number, number],
      sets: 2,
    }));
    tryAdd('mobility', input.type === 'recovery' ? 'Recovery' : 'Mobility', items);
  }

  if (ranOutOfTime.length > 0) {
    const names = [...new Set(ranOutOfTime)];
    notes.push(
      names.length === 1
        ? `No room for ${names[0]} today — it is in the session your program wrote, but not in the minutes you gave it.`
        : `No room for ${listNames(names)} today — they are in the session your program wrote, but not in the minutes you gave it.`,
    );
  }

  const estimatedMin = round(blocks.reduce((a, b) => a + b.estimated_min, 0), 1);

  const cardioLedDay = input.type === 'vo2' || input.type === 'zone2' || input.type === 'sprint' || input.type === 'recovery';
  if (blocks.length === 0 && !cardioLedDay) {
    notes.push('Nothing was available at this location today — the plan fell back to a walk.');
  }
  if (remaining > 8 && !cardioLedDay) {
    notes.push(`${Math.round(remaining)} min of the budget went unused — the constraints ran out of safe options before the clock did.`);
  }

  return { blocks: sortBlocks(blocks), notes, estimatedMin, suppliesOwnBookends: ownBookends };
}

/**
 * "A", "A and B", "A, B and C" — a list a person reads, not an array rendered.
 * The notes are the one place the engine speaks in sentences, so a stray comma
 * before "and" is the sort of thing that makes a line read as machine output
 * and stop being believed.
 */
function listNames(names: string[]): string {
  const seen = [...new Set(names)];
  if (seen.length <= 1) return seen[0] ?? '';
  return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`;
}

/**
 * KOT's ground-up ordering, gated by phase, prerequisites and progress.
 *
 * This is the fallback path: it is what a program with no weekday templates
 * gets, and what a templated program gets on a day its template does not
 * cover. The phase filter comes FIRST and is not overridable, because the
 * `current_step_ids` fallback below ("if nothing is current, use everything")
 * is exactly how a stale or empty progress row used to open the whole 69-step
 * pool on a Zero Monday.
 */
export function orderedProgramSteps(
  program: Program,
  progress?: ProgramProgress,
  date?: string,
): ProgramStep[] {
  const blockOrder = new Map(program.blocks.map((b) => [b.id, b.order]));
  const met = new Set(Object.keys(progress?.met ?? {}));
  const phase = resolvePhase(program, progress);

  // A day template, when one exists for today, is the authority on both which
  // steps run and in what order.
  if (date) {
    const day = programDayFor(program, progress, date);
    if (day) return stepsForDay(program, day);
  }

  const inPhase = stepsInPhase(program, phase);

  const unlocked = inPhase.filter((s) => {
    if (!s.prerequisites || s.prerequisites.length === 0) return true;
    return s.prerequisites.every((p) => met.has(p));
  });

  const current = progress?.current_step_ids?.length
    ? unlocked.filter((s) => progress.current_step_ids.includes(s.id))
    : unlocked;

  const pool = current.length > 0 ? current : unlocked;

  return [...pool].sort((a, b) => {
    const ba = blockOrder.get(a.block) ?? 99;
    const bb = blockOrder.get(b.block) ?? 99;
    if (ba !== bb) return ba - bb;
    return a.order - b.order;
  });
}

/** Every step a day template names, in the template's order, repeats included. */
function stepsForDay(program: Program, day: ProgramDay): ProgramStep[] {
  const byId = new Map(program.steps.map((s) => [s.id, s]));
  return day.blocks.flatMap((b) =>
    b.step_ids.map((id) => byId.get(id)).filter((s): s is ProgramStep => Boolean(s)),
  );
}

/** The exercise for a program step here, following its substitution rules. */
function resolveStepExercise(step: ProgramStep, input: AssemblyInput): Exercise | null {
  const bySlug = new Map(input.exercises.map((e) => [e.slug, e]));
  const primary = bySlug.get(step.exercise_slug);
  if (primary && isPerformableAt(primary, input.location)) return primary;

  for (const sub of step.substitutions ?? []) {
    const alt = bySlug.get(sub.use_slug);
    if (alt && isPerformableAt(alt, input.location)) return alt;
  }
  return null;
}

/** Depth jumps and the like are gated on a strength base. RESEARCH §6.5 */
function plyoUnlocked(ex: Exercise, input: AssemblyInput): boolean {
  if (!ex.slug.includes('depth-jump')) return true;
  const deadliftLike = input.exercises.filter(
    (e) => e.pattern === 'hinge' && e.mechanic === 'compound',
  );
  const best = Math.max(0, ...deadliftLike.map((e) => currentE1rm(e.id, input.history)));
  return best >= input.bodyweightLb * VERTICAL.depth_jump_strength_gate_bw;
}

/** One exercise per movement pattern, so a session is not four kinds of press. */
function pickDistinctPatterns(
  pool: { exercise: Exercise; score: number }[],
  count: number,
): { exercise: Exercise; score: number }[] {
  const seen = new Set<string>();
  const out: { exercise: Exercise; score: number }[] = [];
  for (const c of pool) {
    if (seen.has(c.exercise.pattern)) continue;
    seen.add(c.exercise.pattern);
    out.push(c);
    if (out.length >= count) break;
  }
  return out;
}

/** Tag push/pull pairs within a block so the runtime can alternate them. */
function pairSupersets(blocks: SessionBlock[]): void {
  for (const block of blocks) {
    if (block.kind !== 'strength') continue;
    const pushes = block.exercises.filter((e) => e.exercise.force === 'push' && !e.superset_with);
    const pulls = block.exercises.filter((e) => e.exercise.force === 'pull' && !e.superset_with);
    const pairs = Math.min(pushes.length, pulls.length);
    for (let i = 0; i < pairs; i++) {
      const a = pushes[i];
      const b = pulls[i];
      if (!a || !b) continue;
      a.superset_with = b.exercise_id;
      b.superset_with = a.exercise_id;
      const saving = (a.estimated_min + b.estimated_min) * ASSEMBLY.superset_time_saving * 0.5;
      a.estimated_min = round(a.estimated_min - saving / 2, 2);
      b.estimated_min = round(b.estimated_min - saving / 2, 2);
    }
    block.estimated_min = round(block.exercises.reduce((s, e) => s + e.estimated_min, 0), 2);
  }
}

/** Enforce the priority order structurally, whatever order blocks were built in. */
function sortBlocks(blocks: SessionBlock[]): SessionBlock[] {
  const order: Record<SessionBlock['kind'], number> = {
    warmup: 0, power: 1, program: 2, strength: 3, conditioning: 4, zone2: 5, mobility: 6, cooldown: 7,
  };
  return [...blocks].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}

/**
 * Bookend blocks, added outside the working budget when settings say so.
 *
 * These deliberately prescribe nothing. The engine owns every prescription
 * (CLAUDE.md invariant 1) and a warm-up is the one part of a session where the
 * honest answer is "move the bits you are about to use" — a prescribed list
 * would have to pass the ledger, the injury register and the exclusions to say
 * something Seth already knows how to do, and a five-minute block of vetted
 * movements is five minutes he spends reading instead of moving.
 *
 * What the block DOES carry is the focus, so the card is five minutes with a
 * subject rather than five blank ones. The focus string used to be computed
 * here and dropped on the floor, which is how the bookends became an
 * unexplained ten minutes.
 */
export function warmupBlock(minutes: number, targetRegions: Region[]): SessionBlock {
  const focus = targetRegions.length
    ? `Ease into today's work: ${targetRegions.map((r) => r.replace(/_/g, ' ')).join(', ')}.`
    : 'Easy general movement — raise the temperature before anything gets loaded.';
  return {
    kind: 'warmup',
    title: 'Warm-up',
    exercises: [],
    estimated_min: minutes,
    note: focus,
    cardio: undefined,
  };
}

export function cooldownBlock(minutes: number, targetRegions: Region[] = []): SessionBlock {
  const focus = targetRegions.length
    ? `Walk it off and stretch what you just worked: ${targetRegions.map((r) => r.replace(/_/g, ' ')).join(', ')}.`
    : 'Walk it off and let the heart rate come down.';
  return { kind: 'cooldown', title: 'Cool-down', exercises: [], estimated_min: minutes, note: focus };
}

export { REGION_GROUPS };
