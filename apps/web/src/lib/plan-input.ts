import 'server-only';

import type { GymLocation, PlanInput, SessionType } from './engine-bridge';
import { DEMO_LOCATIONS, HOME_LOCATION, demoPlanInput } from './fixtures/demo';
import { readPrefs } from './prefs';
import { toProgram, toProgramProgress } from './program';
import { serverSupabase } from './supabase/server';
import { toIsoDate } from './format';

export function todayIso(): string {
  return toIsoDate(new Date());
}

/**
 * Assemble everything the engine needs for one day.
 *
 * Supabase is the only network call the today card is allowed to wait on
 * (CLAUDE.md invariant 2). When it is absent — or when any single query fails —
 * the fixture athlete is used so the screen still renders.
 *
 * `userId` must be the signed-in athlete's auth uuid (`requireUserId()` in
 * lib/auth.ts). RLS matches on `auth.uid()`, so anything else returns zero rows
 * and silently lands back on the fixtures — a demo wearing his name. The one id
 * that is allowed not to be a uuid is `DEMO_USER_ID`, and it only ever reaches
 * here when Supabase is unconfigured and every query below is skipped.
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

    // The program is fetched separately because it is two queries deep: the
    // active progress row names the program, and only then can its steps be
    // read. Folding it into the Promise.all above would mean fetching every
    // program's steps to find the one that matters.
    const program = await loadProgram(supabase, userId);

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
      ...program,
      ...overrides,
    };
  } catch {
    // Never block the today card on a database hiccup.
    return base;
  }
}

/**
 * The athlete's program and their position in it.
 *
 * Returns `{}` rather than throwing on anything unexpected, so a program that
 * has not been seeded, an athlete who has not been enrolled, or a query that
 * fails all land in the same place: the fixture program from `demoPlanInput`
 * stays, and the today card still renders (CLAUDE.md invariant 2).
 *
 * Preference order is deliberate. An athlete ENROLLED in a program gets that
 * one, at the phase and week their progress row records. An athlete who has not
 * been enrolled yet still gets the global program — at its own starting phase,
 * week 1 — because the alternative is showing them nothing until somebody
 * remembers to call `start_program`. Seth should never have to think.
 */
async function loadProgram(
  supabase: NonNullable<Awaited<ReturnType<typeof serverSupabase>>>,
  userId: string,
): Promise<Pick<Partial<PlanInput>, 'program' | 'program_progress'>> {
  try {
    const progress = await supabase
      .from('program_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('cycle', { ascending: false })
      .limit(1)
      .maybeSingle();

    const programQuery = supabase.from('programs').select('*').limit(1);
    const programRow = progress.data?.program_id
      ? await programQuery.eq('id', progress.data.program_id).maybeSingle()
      : await programQuery.is('user_id', null).maybeSingle();

    if (programRow.error || !programRow.data) return {};

    const steps = await supabase
      .from('program_steps')
      .select('*')
      .eq('program_id', programRow.data.id)
      .order('step_order');

    const program = toProgram(programRow.data, steps.error ? [] : (steps.data ?? []));
    if (!program) return {};

    return {
      program,
      program_progress: toProgramProgress(progress.error ? null : progress.data, program),
    };
  } catch {
    return {};
  }
}

function pickLocation(list: GymLocation[], id: string): GymLocation {
  return list.find((l) => l.id === id) ?? list[0] ?? HOME_LOCATION;
}

export function parseSessionType(value: string | undefined): SessionType | undefined {
  const allowed: SessionType[] = ['strength', 'kot', 'power', 'vo2', 'zone2', 'sprint', 'mobility', 'recovery', 'external'];
  return allowed.find((t) => t === value);
}
