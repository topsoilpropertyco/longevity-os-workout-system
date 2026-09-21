'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_MAX_AGE, PREF_COOKIE } from './prefs';
import { requireUserId, signedInUserId } from './auth';
import { serverSupabase } from './supabase/server';
import { loadPlanInput, todayIso } from './plan-input';
import { applySwap, rebalanceWeek, plan as enginePlan, describeRebalance } from './engine-bridge';
import type { GoalMode, Rpe, SessionType, Slider1to5 } from './engine-bridge';

export type ActionResult = { ok: boolean; message?: string };

/**
 * Somewhere to write, and the id to write it under.
 *
 * Returns null in the two cases where there is nothing to mirror into: no
 * Supabase configured (the demo path — cookies alone carry the preference), and
 * a session that has expired between the page render and the tap. Every write
 * below goes through here, so `user_id` is always the athlete RLS will accept
 * and never a placeholder that would be rejected as a malformed uuid.
 */
async function writable(): Promise<{ db: Db; userId: string } | null> {
  const db = await serverSupabase();
  if (!db) return null;
  const userId = await signedInUserId();
  return userId ? { db, userId } : null;
}

type Db = NonNullable<Awaited<ReturnType<typeof serverSupabase>>>;

async function setCookie(name: string, value: string) {
  const store = await cookies();
  store.set(name, value, {
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
  });
}

/** Minutes available today (15/20/30/45/60/90). Sticky. */
export async function setBudget(minutes: number): Promise<ActionResult> {
  await setCookie(PREF_COOKIE.budget, String(minutes));
  const w = await writable();
  if (w) {
    // TODO(db): `goal_settings` carries the sticky budget in the real schema.
    await w.db.from('goal_settings').upsert({ user_id: w.userId, last_budget_min: minutes }).select();
  }
  revalidatePath('/');
  revalidatePath('/week');
  return { ok: true };
}

/** Where he is training. Sticky = last used (PRD §8.1). */
export async function setLocation(locationId: string): Promise<ActionResult> {
  await setCookie(PREF_COOKIE.location, locationId);
  const w = await writable();
  if (w) {
    await w.db.from('goal_settings').upsert({ user_id: w.userId, last_location_id: locationId }).select();
  }
  revalidatePath('/');
  revalidatePath('/week');
  return { ok: true };
}

/** The three 1–5 sliders. Used whenever Oura is missing or stale. */
export async function setSelfReport(
  soreness: Slider1to5,
  energy: Slider1to5,
  stress: Slider1to5,
): Promise<ActionResult> {
  const date = todayIso();
  await setCookie(PREF_COOKIE.self, JSON.stringify({ date, soreness, energy, stress }));
  const w = await writable();
  if (w) {
    await w.db.from('self_reports').upsert({ user_id: w.userId, date, soreness, energy, stress });
  }
  revalidatePath('/');
  return { ok: true };
}

export async function setGoalMode(mode: GoalMode): Promise<ActionResult> {
  const w = await writable();
  if (w) {
    await w.db.from('goal_settings').upsert({ user_id: w.userId, mode });
  }
  revalidatePath('/');
  revalidatePath('/settings');
  return { ok: true, message: `Goal mode set to ${mode.replace('_', ' ')}. The week re-solved.` };
}

export type LoggedSetPayload = {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  reps: number;
  loadLb: number;
  rpe?: Rpe;
  completed: boolean;
};

/** One logged set. Fire-and-forget from the runtime — the UI already moved on. */
export async function logSet(payload: LoggedSetPayload): Promise<ActionResult> {
  const w = await writable();
  if (!w) return { ok: true, message: 'Logged locally (no database configured).' };
  const { error } = await w.db.from('sets').upsert({
    user_id: w.userId,
    session_id: payload.sessionId,
    exercise_id: payload.exerciseId,
    set_index: payload.setIndex,
    reps: payload.reps,
    load_lb: payload.loadLb,
    rpe: payload.rpe ?? null,
    completed: payload.completed,
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export type FinishSessionPayload = {
  sessionId: string;
  date: string;
  type: SessionType;
  locationId: string;
  durationMin: number;
  tonnageLb: number;
  note?: string;
};

export async function finishSession(payload: FinishSessionPayload): Promise<ActionResult> {
  const w = await writable();
  if (w) {
    await w.db.from('sessions').upsert({
      id: payload.sessionId,
      user_id: w.userId,
      date: payload.date,
      type: payload.type,
      location_id: payload.locationId,
      duration_min: payload.durationMin,
      completed: true,
      note: payload.note ?? null,
    });
    // TODO(integrations): post the session summary to Telegram via
    // `@longevity/integrations/telegram` once its client is exported.
  }
  revalidatePath('/');
  revalidatePath('/dashboard');
  return { ok: true, message: 'Session logged. Tomorrow already reflects it.' };
}

/** Swap one exercise for another; the engine re-times the session. */
export async function swapExercise(
  sessionDate: string,
  exerciseId: string,
  replacementId: string,
): Promise<ActionResult> {
  const input = await loadPlanInput(await requireUserId(), sessionDate);
  const result = enginePlan(input);
  const updated = applySwap(result.today, exerciseId, replacementId, input);
  const w = await writable();
  if (w) {
    await w.db.from('session_exercises').upsert({
      user_id: w.userId,
      date: sessionDate,
      exercise_id: replacementId,
      swapped_from: exerciseId,
    });
  }
  revalidatePath('/');
  return { ok: true, message: `Swapped. Session is now ${updated.estimated_min} min.` };
}

/** "Do this today" from the week carousel. Returns the one-line diff first. */
export async function previewPullForward(date: string): Promise<{ diff: string }> {
  const today = todayIso();
  const input = await loadPlanInput(await requireUserId(), today);
  const before = enginePlan(input);
  const after = rebalanceWeek(before, date, input);
  return { diff: describeRebalance(before, after) };
}

export async function commitPullForward(date: string): Promise<ActionResult> {
  const today = todayIso();
  const input = await loadPlanInput(await requireUserId(), today);
  const before = enginePlan(input);
  const after = rebalanceWeek(before, date, input);
  const w = await writable();
  if (w) {
    await w.db.from('plans').upsert({
      user_id: w.userId,
      date: today,
      signature: after.signature,
      payload: after as unknown as Record<string, unknown>,
    });
  }
  revalidatePath('/');
  revalidatePath('/week');
  return { ok: true, message: `Today is now ${after.today.title}.` };
}

export async function markOnboarded(): Promise<ActionResult> {
  await setCookie(PREF_COOKIE.onboarded, '1');
  revalidatePath('/');
  return { ok: true };
}

/** Manual cardio entry — any single field is enough (PRD §8.7). */
export async function logCardioManual(form: {
  modality?: string;
  durationMin?: number;
  distanceMi?: number;
  avgHr?: number;
  rpe?: number;
  note?: string;
}): Promise<ActionResult> {
  const anything = Object.values(form).some((v) => v !== undefined && v !== '' && v !== null);
  if (!anything) return { ok: false, message: 'Nothing to log yet.' };
  const w = await writable();
  if (w) {
    await w.db.from('cardio_logs').insert({
      user_id: w.userId,
      date: todayIso(),
      modality: form.modality ?? 'other',
      duration_min: form.durationMin ?? null,
      distance_mi: form.distanceMi ?? null,
      avg_hr: form.avgHr ?? null,
      rpe: form.rpe ?? null,
      source: 'manual',
      note: form.note ?? null,
    });
  }
  revalidatePath('/');
  revalidatePath('/dashboard');
  return { ok: true, message: 'Cardio logged.' };
}

export async function resolveInjury(injuryId: string): Promise<ActionResult> {
  const w = await writable();
  if (w) {
    // No user_id filter needed: the RLS policy already restricts the update to
    // his own rows, and adding one here would only hide a policy bug.
    await w.db.from('injuries').update({ resolved_on: todayIso() }).eq('id', injuryId);
  }
  revalidatePath('/injuries');
  return { ok: true, message: 'Resolved. It stays in the register, closed.' };
}

export async function updateInjuryPain(injuryId: string, pain: number): Promise<ActionResult> {
  const w = await writable();
  if (w) {
    await w.db.from('injury_checkins').insert({
      user_id: w.userId,
      injury_id: injuryId,
      date: todayIso(),
      pain,
    });
    await w.db.from('injuries').update({ current_pain: pain }).eq('id', injuryId);
  }
  revalidatePath('/injuries');
  return { ok: true };
}

/**
 * Sign out, from the form in /settings.
 *
 * Clearing the cookies is the whole job — `signOut()` revokes the refresh token
 * on the auth server too, so a stolen phone cannot be renewed back into a
 * session. Cookie writes only stick inside a server action or a route handler,
 * which is why this is not a plain link.
 */
export async function signOut(): Promise<void> {
  const supabase = await serverSupabase();
  if (supabase) await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/sign-in');
}
