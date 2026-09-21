import 'server-only';

import { plan as enginePlan } from './engine-bridge';
import type { PlanInput, PlanResult } from './engine-bridge';
import { requireUserId } from './auth';
import { loadPlanInput, todayIso } from './plan-input';

export type PlanBundle = { input: PlanInput; result: PlanResult; today: string };

/**
 * Re-plan on every open (CLAUDE.md invariant 4). The plan is a derived view over
 * inputs and history — never a stored truth that goes stale.
 *
 * `requireUserId()` redirects an unauthenticated visitor to /sign-in rather than
 * returning an id that matches no row. Middleware already turned them away; this
 * is the guard for anything that reaches a page some other way.
 */
export async function getPlanBundle(overrides: Partial<PlanInput> = {}): Promise<PlanBundle> {
  return planFor(await requireUserId(), overrides);
}

/**
 * The same plan for an athlete named outright, for the server-side callers that
 * have no browser session to read one from — the nightly cron, and anything the
 * bot triggers. They identify the athlete with `LONGEVITY_USER_ID`, the same
 * variable the Oura sync route already uses.
 *
 * Kept separate from `getPlanBundle` on purpose: a route handler that redirected
 * to /sign-in would answer Vercel Cron with a 307 instead of doing the work, and
 * nobody would notice until a week of snapshots was missing.
 */
export async function planFor(userId: string, overrides: Partial<PlanInput> = {}): Promise<PlanBundle> {
  const today = todayIso();
  const input = await loadPlanInput(userId, today, overrides);
  return { input, result: enginePlan(input), today };
}
