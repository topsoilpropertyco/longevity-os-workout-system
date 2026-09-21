import 'server-only';

import { plan as enginePlan } from './engine-bridge';
import type { PlanInput, PlanResult } from './engine-bridge';
import { DEMO_USER, loadPlanInput, todayIso } from './plan-input';

export type PlanBundle = { input: PlanInput; result: PlanResult; today: string };

/**
 * Re-plan on every open (CLAUDE.md invariant 4). The plan is a derived view over
 * inputs and history — never a stored truth that goes stale.
 */
export async function getPlanBundle(overrides: Partial<PlanInput> = {}): Promise<PlanBundle> {
  const today = todayIso();
  const input = await loadPlanInput(DEMO_USER, today, overrides);
  return { input, result: enginePlan(input), today };
}
