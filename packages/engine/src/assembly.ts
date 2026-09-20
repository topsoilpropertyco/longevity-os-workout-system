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
  PrescribedExercise,
  PrescribedSet,
  Program,
  ProgramProgress,
  ProgramStep,
  ReadinessAssessment,
  Region,
  SessionBlock,
  SessionLog,
  SessionType,
} from './types.js';
import { clamp, rankBy, round } from './util.js';

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
}

/** Minutes one prescribed exercise will take, including its rest. */
export function estimateMinutes(sets: PrescribedSet[]): number {
  const work = sets.reduce((a, s) => a + s.reps * ASSEMBLY.seconds_per_rep, 0);
  const rest = sets.slice(0, -1).reduce((a, s) => a + s.rest_s, 0);
  return round((ASSEMBLY.setup_s_per_exercise + work + rest) / 60, 2);
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
  repOverride?: [number, number];
  setOverride?: number;
}): PrescribedExercise {
  const { exercise, input, isPrimary, why, programStepId } = args;
  const { readiness, goal, history, bodyweightLb, location, deloadVolumeMultiplier, deloadLoadMultiplier } = input;

  const base = setsAndReps({ goal, readiness, isPrimary, deloadVolumeMultiplier });
  const repRange = args.repOverride ?? base.reps;
  const setCount = args.setOverride ?? base.sets;
  // Prescribe at the bottom of the range: double progression climbs from there.
  const reps = repRange[0];

  const step = findProgramStep(input.program, exercise.slug);
  const prediction = predictionBand({
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

  const desired =
    (prediction.probable || loadForReps(currentE1rm(exercise.id, history), reps)) * allowance.multiplier *
      injuryMultiplier * deloadLoadMultiplier +
    bump.bump;

  const cap = loadCapability(exercise, location);
  const { load_lb, capped } = achievableLoad(desired, cap);

  const rpe = Math.min(base.rpe, readiness.rpe_cap ?? 10) as PrescribedSet['rpe_target'];
  const sets: PrescribedSet[] = Array.from({ length: setCount }, (_, i) => ({
    set_index: i,
    reps,
    load_lb: exercise.load_style === 'none' ? 0 : load_lb,
    rpe_target: rpe,
    rest_s: base.rest_s,
    // The database's non-negative-load CHECK is waived only for assisted work,
    // so the flag has to travel with the prescription rather than be inferred later.
    is_assisted: exercise.load_style === 'assisted',
  }));

  const reasons = [why];
  if (bump.bump > 0) reasons.push(bump.reason);
  if (capped === 'max') reasons.push(`Capped at ${load_lb} lb — that is the heaviest here.`);
  if (capped === 'min') reasons.push(`${load_lb} lb is the lightest available — add reps instead.`);
  if (injuryMultiplier < 1) reasons.push('Lightened for a flagged region.');
  if (allowance.multiplier < 1) reasons.push('Eased off: this region is still repaying the last session.');

  return {
    exercise_id: exercise.id,
    exercise,
    sets,
    prediction,
    why: reasons.join(' '),
    program_step_id: programStepId ?? step?.id,
    estimated_min: estimateMinutes(sets),
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

function findProgramStep(program: Program | undefined, slug: string): ProgramStep | undefined {
  return program?.steps.find((s) => s.exercise_slug === slug);
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
  const blocks: SessionBlock[] = [];
  const chosen: Exercise[] = [];
  const flagged = flaggedRegions(input.injuries);

  let remaining = input.budgetMin;

  const tryAdd = (
    kind: SessionBlock['kind'],
    title: string,
    items: { exercise: Exercise; why: string; isPrimary: boolean; stepId?: string; reps?: [number, number]; sets?: number }[],
  ): void => {
    const prescribed: PrescribedExercise[] = [];
    for (const item of items) {
      if (remaining < ASSEMBLY.min_block_min) break;

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
        repOverride: item.reps,
        setOverride: item.sets,
      });

      if (p.estimated_min > remaining + ASSEMBLY.overrun_tolerance_min) {
        // Try trimming a set before giving up on the movement entirely.
        if (p.sets.length > 1) {
          const trimmed = { ...p, sets: p.sets.slice(0, -1) };
          trimmed.estimated_min = estimateMinutes(trimmed.sets);
          if (trimmed.estimated_min <= remaining + ASSEMBLY.overrun_tolerance_min) {
            prescribed.push(trimmed);
            chosen.push(item.exercise);
            remaining = round(remaining - trimmed.estimated_min, 2);
            continue;
          }
        }
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
    const steps = orderedProgramSteps(input.program, input.programProgress);
    const items = steps
      .map((step) => {
        const ex = resolveStepExercise(step, input);
        return ex ? { step, ex } : null;
      })
      .filter((x): x is { step: ProgramStep; ex: Exercise } => x !== null)
      .map(({ step, ex }) => ({
        exercise: ex,
        why: `${input.program?.name ?? 'Program'} — ${step.standard_text}`,
        isPrimary: true,
        stepId: step.id,
      }));

    if (items.length === 0) {
      notes.push('No program movements are available at this location today.');
    }
    tryAdd('program', `${input.program.name} — ground up`, items);
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

  const estimatedMin = round(blocks.reduce((a, b) => a + b.estimated_min, 0), 1);

  if (blocks.length === 0) {
    notes.push('Nothing was available at this location today — the plan fell back to a walk.');
  }
  if (remaining > 8 && input.type !== 'recovery') {
    notes.push(`${Math.round(remaining)} min of the budget went unused — the constraints ran out of safe options before the clock did.`);
  }

  return { blocks: sortBlocks(blocks), notes, estimatedMin };
}

/** KOT's ground-up ordering, and program-progress gating on prerequisites. */
function orderedProgramSteps(program: Program, progress?: ProgramProgress): ProgramStep[] {
  const blockOrder = new Map(program.blocks.map((b) => [b.id, b.order]));
  const met = new Set(Object.keys(progress?.met ?? {}));

  const unlocked = program.steps.filter((s) => {
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

/** Bookend blocks, added outside the working budget when settings say so. */
export function warmupBlock(minutes: number, targetRegions: Region[]): SessionBlock {
  const focus = targetRegions.length
    ? `Focus: ${targetRegions.map((r) => r.replace(/_/g, ' ')).join(', ')}.`
    : 'General.';
  return {
    kind: 'warmup',
    title: 'Warm-up',
    exercises: [],
    estimated_min: minutes,
    cardio: undefined,
  };
}

export function cooldownBlock(minutes: number): SessionBlock {
  return { kind: 'cooldown', title: 'Cool-down', exercises: [], estimated_min: minutes };
}

export { REGION_GROUPS };
