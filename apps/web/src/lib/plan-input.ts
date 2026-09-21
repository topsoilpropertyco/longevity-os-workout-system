import 'server-only';

import type { GymLocation, PlanInput, SessionType } from './engine-bridge';
import { DEMO_LOCATIONS, HOME_LOCATION, demoPlanInput } from './fixtures/demo';
import { readPrefs } from './prefs';
import { serverSupabase } from './supabase/server';
import { toIsoDate } from './format';

export const DEMO_USER = 'demo-seth';

export function todayIso(): string {
  return toIsoDate(new Date());
}

/**
 * Assemble everything the engine needs for one day.
 *
 * Supabase is the only network call the today card is allowed to wait on
 * (CLAUDE.md invariant 2). When it is absent — or when any single query fails —
 * the fixture athlete is used so the screen still renders.
 */
export async function loadPlanInput(
  userId: string,
  date: string,
  overrides: Partial<PlanInput> = {},
): Promise<PlanInput> {
  const prefs = await readPrefs(date);
  const base = demoPlanInput(date, {
    budget_min: prefs.budgetMin,
    location: pickLocation(DEMO_LOCATIONS, prefs.locationId),
    ...(prefs.selfReport ? { self_report: prefs.selfReport } : {}),
    ...overrides,
  });

  const supabase = await serverSupabase();
  if (!supabase) return base;

  try {
    // TODO(db): swap these ad-hoc selects for the typed query helpers in
    // `@longevity/db` once that package exports them (it owns the generated
    // Database type and the RLS-aware row mappers).
    const [locations, oura, sessions, cardio, injuries, body, goals] = await Promise.all([
      supabase.from('locations').select('*').eq('user_id', userId),
      supabase.from('oura_daily').select('*').eq('user_id', userId).lte('date', date).order('date').limit(28),
      supabase.from('sessions').select('*, session_exercises(*, sets(*))').eq('user_id', userId).lte('date', date).order('date', { ascending: false }).limit(60),
      supabase.from('cardio_logs').select('*').eq('user_id', userId).lte('date', date).order('date', { ascending: false }).limit(60),
      supabase.from('injuries').select('*').eq('user_id', userId).is('resolved_on', null),
      supabase.from('body_metrics').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(26),
      supabase.from('goal_settings').select('*').eq('user_id', userId).maybeSingle(),
    ]);

    const rows = <T,>(res: { data: T[] | null; error: unknown }): T[] =>
      res.error || !res.data ? [] : res.data;

    const dbLocations = rows(locations) as unknown as GymLocation[];

    return {
      ...base,
      ...(dbLocations.length
        ? { location: pickLocation(dbLocations, prefs.locationId), all_locations: dbLocations }
        : {}),
      ...(rows(oura).length ? { oura_history: rows(oura) as PlanInput['oura_history'] } : {}),
      ...(rows(sessions).length ? { history: rows(sessions) as unknown as PlanInput['history'] } : {}),
      ...(rows(cardio).length ? { cardio_history: rows(cardio) as unknown as PlanInput['cardio_history'] } : {}),
      ...(rows(injuries).length ? { injuries: rows(injuries) as unknown as PlanInput['injuries'] } : {}),
      ...(rows(body).length ? { body_metrics: rows(body) as unknown as PlanInput['body_metrics'] } : {}),
      ...(goals.data ? { goals: goals.data as unknown as PlanInput['goals'] } : {}),
      ...overrides,
    };
  } catch {
    // Never block the today card on a database hiccup.
    return base;
  }
}

function pickLocation(list: GymLocation[], id: string): GymLocation {
  return list.find((l) => l.id === id) ?? list[0] ?? HOME_LOCATION;
}

export function parseSessionType(value: string | undefined): SessionType | undefined {
  const allowed: SessionType[] = ['strength', 'kot', 'power', 'vo2', 'zone2', 'sprint', 'mobility', 'recovery', 'external'];
  return allowed.find((t) => t === value);
}
