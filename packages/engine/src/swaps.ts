/**
 * Longevity OS — Exercise Swaps
 *
 * The Same / Easier / Harder carousel. PRD §8.2.
 *
 * Ranking, in order of weight: movement-pattern match, regional overlap,
 * equipment fit at this location. A curated `preferred_alternatives` entry beats
 * anything the generic ranking can produce, because a human already thought
 * about it.
 */

import { INJURY } from './constants.js';
import { isPerformableAt, loadCapability, achievableLoad } from './equipment.js';
import { injuryBlocks, violatedExclusion, flaggedRegions } from './exclusions.js';
import { ledgerAllowance } from './ledger.js';
import { currentE1rm, loadForReps } from './progression.js';
import type {
  Exercise,
  Injury,
  Ledger,
  PrescribedExercise,
  PrescribedSet,
  Region,
  SessionLog,
  SwapCandidate,
  SwapDifficulty,
  GymLocation,
} from './types.js';
import { clamp, rankBy, round } from './util.js';
import { estimateMinutes } from './assembly.js';

/**
 * A rough difficulty ordinal so candidates can be bucketed relative to the
 * exercise being replaced. Compound beats isolation, expert beats beginner,
 * free weights beat machines, and bilateral loading beats assisted work.
 */
export function difficultyScore(ex: Exercise): number {
  let s = 0;
  s += ex.mechanic === 'compound' ? 2 : 0;
  s += ex.level === 'expert' ? 2 : ex.level === 'intermediate' ? 1 : 0;
  s += ex.load_style === 'barbell' || ex.load_style === 'smith' ? 1.5 : 0;
  s += ex.load_style === 'assisted' ? -1.5 : 0;
  s += ex.load_style === 'stack' ? -0.5 : 0;
  s += ex.eccentric_dominant ? 1 : 0;
  s += Object.values(ex.region_loads).reduce((a, b) => a + b, 0) * 0.4;
  return round(s, 3);
}

function bucket(candidate: Exercise, reference: Exercise): SwapDifficulty {
  const delta = difficultyScore(candidate) - difficultyScore(reference);
  if (delta > 0.9) return 'harder';
  if (delta < -0.9) return 'easier';
  return 'same';
}

/** Overlap between two region maps, 0–1. Cosine similarity over the shared keys. */
export function regionOverlap(a: Exercise, b: Exercise): number {
  const regions = new Set([...Object.keys(a.region_loads), ...Object.keys(b.region_loads)]) as Set<Region>;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const r of regions) {
    const wa = a.region_loads[r] ?? 0;
    const wb = b.region_loads[r] ?? 0;
    dot += wa * wb;
    na += wa * wa;
    nb += wb * wb;
  }
  if (na === 0 || nb === 0) return 0;
  return round(dot / (Math.sqrt(na) * Math.sqrt(nb)), 4);
}

export interface SwapInput {
  target: PrescribedExercise;
  sessionExercises: PrescribedExercise[];
  exercises: Exercise[];
  location: GymLocation;
  ledger: Ledger;
  injuries: Injury[];
  history: SessionLog[];
  bodyweightLb: number;
  /** Cap the returned list. The carousel shows a handful, not a catalogue. */
  limit?: number;
}

/**
 * Candidates for replacing one exercise in the current session.
 *
 * Anything that would violate a pairing exclusion against the REST of the
 * session is excluded outright — swapping must not be able to create an illegal
 * session (CLAUDE.md invariant 5).
 */
export function swapCandidates(input: SwapInput): SwapCandidate[] {
  const { target, sessionExercises, exercises, location, ledger, injuries, history, bodyweightLb } = input;
  const reference = target.exercise;
  const limit = input.limit ?? 12;

  const others = sessionExercises.filter((e) => e.exercise_id !== target.exercise_id).map((e) => e.exercise);
  const flagged = flaggedRegions(injuries);
  const preferred = new Set(reference.preferred_alternatives ?? []);

  const scored: SwapCandidate[] = [];

  for (const ex of exercises) {
    if (ex.id === reference.id) continue;
    if (!isPerformableAt(ex, location)) continue;

    const blocked = injuryBlocks(ex, injuries, INJURY.pain_block_threshold);
    if (blocked.blocked) continue;

    const allowance = ledgerAllowance(ex, ledger);
    if (allowance.multiplier === 0) continue;

    const conflict = violatedExclusion(ex, others, { flaggedRegions: flagged });
    if (conflict) continue;

    const patternMatch = ex.pattern === reference.pattern ? 1 : 0;
    const overlap = regionOverlap(ex, reference);
    // Same pattern and high overlap is the definition of a good substitute.
    if (patternMatch === 0 && overlap < 0.45) continue;

    const equipmentFit = equipmentFitScore(ex, location);
    const curatedBonus = preferred.has(ex.slug) ? 0.5 : 0;
    const rehabBonus = ex.rehab_for?.some((r) => flagged.has(r)) ? 0.15 : 0;

    const score = round(
      patternMatch * 0.4 + overlap * 0.3 + equipmentFit * 0.15 + allowance.multiplier * 0.1 + curatedBonus + rehabBonus,
      4,
    );

    const difficulty = bucket(ex, reference);
    const sets = rePrescribe(ex, target.sets, { location, history, bodyweightLb });

    scored.push({
      exercise: ex,
      difficulty,
      score,
      reason: reasonFor(ex, reference, difficulty, patternMatch === 1, overlap, preferred.has(ex.slug)),
      sets,
      estimated_min: estimateMinutes(sets, ex.load_style),
    });
  }

  const ranked = rankBy(scored, (c) => c.score, (c) => c.exercise.slug);

  // Return a balanced carousel rather than twelve variations of "same": take the
  // best few from each bucket so Easier and Harder are always reachable.
  const perBucket = Math.max(2, Math.floor(limit / 3));
  const out: SwapCandidate[] = [];
  for (const d of ['same', 'easier', 'harder'] as SwapDifficulty[]) {
    out.push(...ranked.filter((c) => c.difficulty === d).slice(0, perBucket));
  }
  const rest = ranked.filter((c) => !out.includes(c));
  return [...rankBy(out, (c) => c.score, (c) => c.exercise.slug), ...rest].slice(0, limit);
}

function equipmentFitScore(ex: Exercise, location: GymLocation): number {
  const cap = loadCapability(ex, location);
  if (cap.equipment === null) return 0;
  // A movement whose loading is finely adjustable here is easier to prescribe well.
  if (cap.increment_lb <= 5) return 1;
  if (cap.increment_lb <= 10) return 0.7;
  return 0.4;
}

/** Re-derive the prescription for a substitute, keeping reps and rest intact. */
function rePrescribe(
  ex: Exercise,
  originalSets: PrescribedSet[],
  ctx: { location: GymLocation; history: SessionLog[]; bodyweightLb: number },
): PrescribedSet[] {
  const reps = originalSets[0]?.reps ?? 8;
  const e1rm = currentE1rm(ex.id, ctx.history);
  const cap = loadCapability(ex, ctx.location);

  // No history on the substitute: scale the original load by the difficulty gap
  // rather than pretending to know, and let the prediction band say it is a guess.
  const desired = e1rm > 0 ? loadForReps(e1rm, reps) : (originalSets[0]?.load_lb ?? 0);
  const { load_lb } = achievableLoad(desired, cap);

  return originalSets.map((s) => ({
    ...s,
    load_lb: ex.load_style === 'none' ? 0 : load_lb,
  }));
}

function reasonFor(
  ex: Exercise,
  reference: Exercise,
  difficulty: SwapDifficulty,
  samePattern: boolean,
  overlap: number,
  curated: boolean,
): string {
  if (curated) return `Hand-picked substitute for ${reference.name}.`;
  const patternWord = samePattern ? `same ${reference.pattern.replace(/_/g, ' ')} pattern` : `${Math.round(overlap * 100)}% the same muscles`;
  switch (difficulty) {
    case 'easier':
      return `Easier — ${patternWord}, less demanding to control.`;
    case 'harder':
      return `Harder — ${patternWord}, more load or more stability to manage.`;
    default:
      return `Even trade — ${patternWord}.`;
  }
}

/**
 * Apply a swap to a session, preserving block position and re-timing everything.
 * Returns a new session; the input is not mutated.
 */
export function applySwap<T extends { blocks: { exercises: PrescribedExercise[]; estimated_min: number }[]; estimated_min: number }>(
  session: T,
  fromExerciseId: string,
  candidate: SwapCandidate,
): T {
  const blocks = session.blocks.map((block) => {
    const idx = block.exercises.findIndex((e) => e.exercise_id === fromExerciseId);
    if (idx === -1) return block;

    const original = block.exercises[idx];
    const replacement: PrescribedExercise = {
      exercise_id: candidate.exercise.id,
      exercise: candidate.exercise,
      sets: candidate.sets,
      prediction: undefined,
      why: `Swapped in for ${original?.exercise.name ?? 'the original'}. ${candidate.reason}`,
      superset_with: original?.superset_with,
      program_step_id: original?.program_step_id,
      estimated_min: candidate.estimated_min,
    };

    const exercises = [...block.exercises];
    exercises[idx] = replacement;
    return {
      ...block,
      exercises,
      estimated_min: round(exercises.reduce((a, e) => a + e.estimated_min, 0), 2),
    };
  });

  return {
    ...session,
    blocks,
    estimated_min: round(blocks.reduce((a, b) => a + b.estimated_min, 0), 1),
  };
}
