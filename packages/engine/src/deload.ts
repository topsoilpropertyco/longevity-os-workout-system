/**
 * Longevity OS — Autoregulated Deload
 *
 * Fixed-calendar deloads show no advantage over continuous training
 * (Coleman 2024; Pancar 2025 — RESEARCH §6.4). Ours are triggered by the
 * athlete's own signals, with a hard calendar cap as a backstop.
 */

import { DELOAD } from './constants.js';
import type { DeloadState, OuraDaily, SelfReport, SessionLog } from './types.js';
import { addDays, daysBetween, mean, withinDays } from './util.js';

export interface DeloadInput {
  today: string;
  ouraHistory: OuraDaily[];
  selfReports: SelfReport[];
  history: SessionLog[];
  /** Date the last deload started, if any. */
  lastDeloadStart?: string;
  /** Set when a deload is already in progress, so it runs its course. */
  activeDeloadStart?: string;
}

/**
 * Evaluate every trigger. Any one firing starts a deload; the hard cap forces
 * one at 8–10 weeks even in the absence of a signal.
 */
export function evaluateDeload(input: DeloadInput): DeloadState {
  const { today, ouraHistory, selfReports, history, lastDeloadStart, activeDeloadStart } = input;
  const triggers: string[] = [];

  // A deload already under way runs to completion — stopping one early defeats
  // the point, and re-evaluating mid-deload would see improving numbers and quit.
  if (activeDeloadStart) {
    const ends = addDays(activeDeloadStart, DELOAD.duration_days);
    if (today < ends) {
      return {
        active: true,
        triggers: ['Deload in progress.'],
        started_on: activeDeloadStart,
        ends_on: ends,
        volume_multiplier: DELOAD.volume_multiplier,
        load_multiplier: DELOAD.load_multiplier,
        weeks_since_last: 0,
      };
    }
  }

  // 1. Seven-day mean readiness below 65.
  const recentReadiness = ouraHistory
    .filter((d) => withinDays(d.date, today, 7) && typeof d.readiness_score === 'number')
    .map((d) => d.readiness_score as number);
  if (recentReadiness.length >= 4) {
    const avg = mean(recentReadiness);
    if (avg < DELOAD.readiness_7d_below) {
      triggers.push(`7-day readiness averaging ${Math.round(avg)} — below ${DELOAD.readiness_7d_below}.`);
    }
  }

  // 2. HRV trend ≥10% below the 28-day baseline.
  const hrv28 = ouraHistory
    .filter((d) => withinDays(d.date, today, 28) && typeof d.hrv_ms === 'number')
    .map((d) => d.hrv_ms as number);
  const hrv7 = ouraHistory
    .filter((d) => withinDays(d.date, today, 7) && typeof d.hrv_ms === 'number')
    .map((d) => d.hrv_ms as number);
  if (hrv28.length >= 14 && hrv7.length >= 3) {
    const baseline = mean(hrv28);
    const recent = mean(hrv7);
    const deltaPct = ((recent - baseline) / baseline) * 100;
    if (deltaPct <= DELOAD.hrv_trend_below_pct) {
      triggers.push(`HRV trending ${Math.abs(Math.round(deltaPct))}% below your 28-day baseline.`);
    }
  }

  // 3. Two consecutive sessions missing prescribed reps.
  const missed = consecutiveMissedSessions(history, today);
  if (missed >= DELOAD.missed_rep_sessions) {
    triggers.push(`${missed} sessions running where the reps did not come.`);
  }

  // 4. Sliders red for three consecutive days.
  const redDays = consecutiveRedSliderDays(selfReports, today);
  if (redDays >= DELOAD.red_slider_days) {
    triggers.push(`${redDays} days of red sliders.`);
  }

  // 5. Hard calendar cap — force a light week regardless.
  //
  // An athlete who has never deloaded is not overdue by default: he is measured
  // from the day he started training. Without that, a brand-new user's very
  // first session would be prescribed as a deload, which is absurd and would
  // cost the app its credibility on day one.
  const weeksSinceLast = weeksOfUninterruptedTraining(today, lastDeloadStart, history);
  if (weeksSinceLast >= DELOAD.hard_cap_weeks) {
    triggers.push(`${weeksSinceLast} weeks since the last light week — taking one now.`);
  }

  const active = triggers.length > 0;
  return {
    active,
    triggers,
    started_on: active ? today : undefined,
    ends_on: active ? addDays(today, DELOAD.duration_days) : undefined,
    volume_multiplier: active ? DELOAD.volume_multiplier : 1,
    load_multiplier: active ? DELOAD.load_multiplier : 1,
    weeks_since_last: weeksSinceLast,
  };
}

/**
 * Weeks of continuous training since the last deload — or, when there has never
 * been one, since the earliest session on record. Returns 0 when there is no
 * history at all, because nothing has accumulated to deload from.
 */
function weeksOfUninterruptedTraining(
  today: string,
  lastDeloadStart: string | undefined,
  history: SessionLog[],
): number {
  if (lastDeloadStart) return Math.floor(daysBetween(lastDeloadStart, today) / 7);
  const dates = history.filter((s) => s.completed && s.date <= today).map((s) => s.date).sort();
  const first = dates[0];
  if (!first) return 0;
  return Math.floor(daysBetween(first, today) / 7);
}

/**
 * Sessions, newest first, where a working set fell short of its prescribed reps.
 * Counting stops at the first session that met its target.
 */
function consecutiveMissedSessions(history: SessionLog[], today: string): number {
  const recent = history
    .filter((s) => s.completed && s.date <= today && s.exercises.length > 0)
    .sort((a, b) => (a.date > b.date ? -1 : 1))
    .slice(0, 6);

  let count = 0;
  for (const session of recent) {
    // A set logged as not completed is the signal: the reps were prescribed and
    // did not happen.
    const shortfall = session.exercises.some((e) => e.sets.some((s) => !s.completed));
    if (shortfall) count++;
    else break;
  }
  return count;
}

/** Consecutive days, ending today, with any slider at or below the red threshold. */
function consecutiveRedSliderDays(reports: SelfReport[], today: string): number {
  const byDate = new Map(reports.map((r) => [r.date, r]));
  let count = 0;
  for (let i = 0; i < 10; i++) {
    const date = addDays(today, -i);
    const r = byDate.get(date);
    if (!r) break;
    const red =
      r.soreness <= DELOAD.red_slider_threshold ||
      r.energy <= DELOAD.red_slider_threshold ||
      r.stress >= 6 - DELOAD.red_slider_threshold;
    if (red) count++;
    else break;
  }
  return count;
}

/** A deload is not a rest week: it is 60% volume, 87.5% load, more Zone 2. */
export function deloadGuidance(state: DeloadState): string {
  if (!state.active) return '';
  const pctVol = Math.round((1 - state.volume_multiplier) * 100);
  const pctLoad = Math.round((1 - state.load_multiplier) * 100);
  return `Deload: ${pctVol}% less volume, ${pctLoad}% lighter, mobility and Zone 2 emphasised. ${state.triggers[0] ?? ''}`.trim();
}
