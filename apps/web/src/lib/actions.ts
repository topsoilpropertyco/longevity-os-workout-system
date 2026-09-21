'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { COOKIE_MAX_AGE, PREF_COOKIE } from './prefs';
import { serverSupabase } from './supabase/server';
import { DEMO_USER, loadPlanInput, todayIso } from './plan-input';
import { applySwap, rebalanceWeek, plan as enginePlan, describeRebalance } from './engine-bridge';
import type { GoalMode, Rpe, SessionType, Slider1to5 } from './engine-bridge';

export type ActionResult = { ok: boolean; message?: string };

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
  const supabase = await serverSupabase();
  if (supabase) {
    // TODO(db): `goal_settings` carries the sticky budget in the real schema.
    await supabase.from('goal_settings').upsert({ user_id: DEMO_USER, last_budget_min: minutes }).select();
  }
  revalidatePath('/');
  revalidatePath('/week');
  return { ok: true };
}

/** Where he is training. Sticky = last used (PRD §8.1). */
export async function setLocation(locationId: string): Promise<ActionResult> {
  await setCookie(PREF_COOKIE.location, locationId);
  const supabase = await serverSupabase();
  if (supabase) {
    await supabase.from('goal_settings').upsert({ user_id: DEMO_USER, last_location_id: locationId }).select();
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
  const supabase = await serverSupabase();
  if (supabase) {
    await supabase.from('self_reports').upsert({ user_id: DEMO_USER, date, soreness, energy, stress });
  }
  revalidatePath('/');
  return { ok: true };
}

export async function setGoalMode(mode: GoalMode): Promise<ActionResult> {
  const supabase = await serverSupabase();
  if (supabase) {
    await supabase.from('goal_settings').upsert({ user_id: DEMO_USER, mode });
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
  const supabase = await serverSupabase();
  if (!supabase) return { ok: true, message: 'Logged locally (no database configured).' };
  const { error } = await supabase.from('sets').upsert({
    user_id: DEMO_USER,
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
  const supabase = await serverSupabase();
  if (supabase) {
    await supabase.from('sessions').upsert({
      id: payload.sessionId,
      user_id: DEMO_USER,
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
  const input = await loadPlanInput(DEMO_USER, sessionDate);
  const result = enginePlan(input);
  const updated = applySwap(result.today, exerciseId, replacementId, input);
  const supabase = await serverSupabase();
  if (supabase) {
    await supabase.from('session_exercises').upsert({
      user_id: DEMO_USER,
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
  const input = await loadPlanInput(DEMO_USER, today);
  const before = enginePlan(input);
  const after = rebalanceWeek(before, date, input);
  return { diff: describeRebalance(before, after) };
}

export async function commitPullForward(date: string): Promise<ActionResult> {
  const today = todayIso();
  const input = await loadPlanInput(DEMO_USER, today);
  const before = enginePlan(input);
  const after = rebalanceWeek(before, date, input);
  const supabase = await serverSupabase();
  if (supabase) {
    await supabase.from('plans').upsert({
      user_id: DEMO_USER,
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
  const supabase = await serverSupabase();
  if (supabase) {
    await supabase.from('cardio_logs').insert({
      user_id: DEMO_USER,
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
  const supabase = await serverSupabase();
  if (supabase) {
    await supabase.from('injuries').update({ resolved_on: todayIso() }).eq('id', injuryId);
  }
  revalidatePath('/injuries');
  return { ok: true, message: 'Resolved. It stays in the register, closed.' };
}

export async function updateInjuryPain(injuryId: string, pain: number): Promise<ActionResult> {
  const supabase = await serverSupabase();
  if (supabase) {
    await supabase.from('injury_checkins').insert({
      user_id: DEMO_USER,
      injury_id: injuryId,
      date: todayIso(),
      pain,
    });
    await supabase.from('injuries').update({ current_pain: pain }).eq('id', injuryId);
  }
  revalidatePath('/injuries');
  return { ok: true };
}
