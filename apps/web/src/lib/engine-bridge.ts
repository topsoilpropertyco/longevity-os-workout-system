/**
 * ENGINE BRIDGE — the only seam between this app and `@longevity/engine`.
 *
 * The engine is deterministic and owns every prescription (CLAUDE.md invariant
 * 1). The UI renders and collects; it never computes one. This module exists so
 * that the whole app imports domain types and engine calls from a single place,
 * and so that the small differences between the engine's call shapes and the
 * shapes the screens want (an exercise id rather than a candidate object, for
 * instance) are adapted once, here, instead of in every component.
 *
 * Everything below delegates. No engine logic is reimplemented.
 */

export * from '@longevity/engine';

import {
  plan as enginePlan,
  swapCandidates as engineSwaps,
  applySwap as engineApplySwap,
  rebalanceWeek as engineRebalance,
  estimateOneRepMax as engineE1rm,
  type ExerciseId,
  type IsoDate,
  type Ledger,
  type PlanInput,
  type PlanResult,
  type PrescribedExercise,
  type PrescribedSession,
  type SwapCandidate,
} from '@longevity/engine';

/** True when the real package is in place (it is — kept for call sites to assert on). */
export const ENGINE_WIRED = true;

/** The plan for a day. Recomputed on every open — never read from a cache. */
export function plan(input: PlanInput): PlanResult {
  return enginePlan(input);
}

function findExercise(session: PrescribedSession, exerciseId: ExerciseId): PrescribedExercise | undefined {
  return session.blocks.flatMap((b) => b.exercises).find((e) => e.exercise_id === exerciseId);
}

/**
 * Same / Easier / Harder alternatives for one exercise, filtered to the
 * location. The ledger is part of the engine's input; pass the one from the
 * current plan when you already have it rather than re-planning.
 */
export function swapCandidates(
  exerciseId: ExerciseId,
  session: PrescribedSession,
  input: PlanInput,
  ledger?: Ledger,
): SwapCandidate[] {
  const target = findExercise(session, exerciseId);
  if (!target) return [];
  return engineSwaps({
    target,
    sessionExercises: session.blocks.flatMap((b) => b.exercises),
    exercises: input.exercises,
    location: input.location,
    ledger: ledger ?? enginePlan(input).ledger,
    injuries: input.injuries,
    history: input.history,
    bodyweightLb: input.athlete.bodyweight_lb,
    limit: 8,
  });
}

/** Replace an exercise and let the engine re-time the session. */
export function applySwap(
  session: PrescribedSession,
  exerciseId: ExerciseId,
  replacementId: ExerciseId,
  input: PlanInput,
  ledger?: Ledger,
): PrescribedSession {
  const candidate = swapCandidates(exerciseId, session, input, ledger).find(
    (c) => c.exercise.id === replacementId,
  );
  if (!candidate) return session;
  return engineApplySwap(session, exerciseId, candidate);
}

/** "Do this today" — the engine re-solves the week under the same constraints. */
export function rebalanceWeek(_current: PlanResult, pullForwardDate: IsoDate, input: PlanInput): PlanResult {
  return engineRebalance(input, pullForwardDate);
}

/** Epley/Brzycki blend — the engine's, used for the dashboard's e1RM series. */
export function estimateOneRepMax(load: number, reps: number): number {
  return engineE1rm(load, reps);
}

/** The one-line diff shown before a week rebalance is committed. */
export function describeRebalance(before: PlanResult, after: PlanResult): string {
  const was = before.today.title;
  const now = after.today.title;
  if (was === now) return `Today stays ${now}; the rest of the week shifts to keep every region inside its window.`;
  const bumped = after.week.find((d) => d.session.title === was);
  return bumped
    ? `Today becomes ${now}; ${was} moves to ${bumped.date === after.week[1]?.date ? 'tomorrow' : bumped.date}, and the rest of the week shifts one day.`
    : `Today becomes ${now}; the rest of the week re-solves around it.`;
}
