/**
 * Oura raw payloads → the engine's `OuraDaily`.
 *
 * Six endpoints describe one day. This merges them into exactly one `OuraDaily`
 * per date, keyed on Oura's `day` field.
 *
 * THE RULE THAT MATTERS: a missing field stays `undefined`. Never 0.
 * The engine reads `hrv_ms === undefined` as "no signal, use the sliders" and
 * `hrv_ms === 0` as "HRV collapsed" — one is a graceful fallback, the other
 * cancels training. Nothing in this file may invent a zero.
 *
 * HRV comes from the `sleep` endpoint (`average_hrv`), NOT from `daily_sleep`.
 */

import type { OuraDaily } from '@longevity/engine';
import {
  OuraCardiovascularAgeSchema,
  OuraDailyActivitySchema,
  OuraDailyReadinessSchema,
  OuraDailyResilienceSchema,
  OuraDailySleepSchema,
  OuraDailyStressSchema,
  OuraSleepPeriodSchema,
  OuraVo2MaxSchema,
  parseRows,
} from './schema.js';
import type { OuraDailyBundle, OuraRecord } from './client.js';

/** What `normalizeOuraBundle` hands back: the days plus anything it dropped. */
export interface NormalizedOura {
  /** One row per date Oura reported anything for, sorted oldest → newest. */
  days: OuraDaily[];
  /** Schema failures, already formatted. Log these; they mean Oura changed. */
  warnings: string[];
}

/** Coerce `null` to `undefined`; leave real numbers (including 0) alone. */
function n(v: number | null | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Seconds → whole minutes, or `undefined` if there were no seconds. */
function secToMin(v: number | null | undefined): number | undefined {
  const x = n(v);
  return x === undefined ? undefined : Math.round(x / 60);
}

/** Pick the first defined value. Used for Oura's unconfirmed field aliases. */
function firstDefined(...vals: (number | null | undefined)[]): number | undefined {
  for (const v of vals) {
    const x = n(v);
    if (x !== undefined) return x;
  }
  return undefined;
}

/** Assign a value onto the accumulator only when it is actually defined. */
function put<K extends keyof OuraDaily>(
  target: Partial<OuraDaily>,
  key: K,
  value: OuraDaily[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

/**
 * Merge a raw bundle from `OuraClient.fetchDailyBundle` into `OuraDaily` rows.
 * Endpoints that failed (`null` in the bundle) simply contribute nothing.
 */
export function normalizeOuraBundle(bundle: OuraDailyBundle): NormalizedOura {
  const warnings: string[] = [];
  const byDate = new Map<string, Partial<OuraDaily>>();

  const slot = (day: string): Partial<OuraDaily> => {
    let existing = byDate.get(day);
    if (!existing) {
      existing = { date: day };
      byDate.set(day, existing);
    }
    return existing;
  };

  const collect = <T>(
    rows: OuraRecord[] | null,
    schema: Parameters<typeof parseRows>[0],
    label: string,
  ): T[] => {
    const parsed = parseRows(schema, rows, label);
    warnings.push(...parsed.skipped);
    return parsed.rows as T[];
  };

  // daily_readiness → readiness_score, body_temp_deviation_c
  for (const row of collect<Record<string, number | null>>(
    bundle.readiness,
    OuraDailyReadinessSchema,
    'daily_readiness',
  )) {
    const d = slot(String(row['day']));
    put(d, 'readiness_score', n(row['score'] as number | null));
    put(d, 'body_temp_deviation_c', n(row['temperature_deviation'] as number | null));
  }

  // daily_sleep → sleep_score only
  for (const row of collect<Record<string, number | null>>(
    bundle.dailySleep,
    OuraDailySleepSchema,
    'daily_sleep',
  )) {
    const d = slot(String(row['day']));
    put(d, 'sleep_score', n(row['score'] as number | null));
  }

  // sleep → hrv_ms (average_hrv), resting_hr, respiratory_rate.
  // Multiple periods can land on one day (naps). We take the LONGEST period,
  // which is the main nightly sleep — a 20-minute nap's HRV is not the signal.
  const sleepByDay = new Map<string, Record<string, unknown>>();
  for (const row of collect<Record<string, unknown>>(
    bundle.sleep,
    OuraSleepPeriodSchema,
    'sleep',
  )) {
    const day = String(row['day']);
    const prev = sleepByDay.get(day);
    const dur = n(row['total_sleep_duration'] as number | null) ?? 0;
    const prevDur = prev ? (n(prev['total_sleep_duration'] as number | null) ?? 0) : -1;
    const isLongSleep = (row['type'] ?? 'long_sleep') !== 'nap';
    const prevIsNap = prev ? prev['type'] === 'nap' : false;
    if (!prev || (isLongSleep && prevIsNap) || dur > prevDur) sleepByDay.set(day, row);
  }
  for (const [day, row] of sleepByDay) {
    const d = slot(day);
    put(d, 'hrv_ms', n(row['average_hrv'] as number | null));
    put(d, 'resting_hr', n(row['average_heart_rate'] as number | null));
    put(d, 'respiratory_rate', n(row['average_breath'] as number | null));
  }

  // daily_activity → activity_score, steps, active_calories, met_minutes
  for (const row of collect<Record<string, number | null>>(
    bundle.activity,
    OuraDailyActivitySchema,
    'daily_activity',
  )) {
    const d = slot(String(row['day']));
    put(d, 'activity_score', n(row['score'] as number | null));
    put(d, 'steps', n(row['steps'] as number | null));
    put(d, 'active_calories', n(row['active_calories'] as number | null));
    // MET minutes: Oura reports them split by intensity. Sum what is present;
    // if none of the three exist, leave undefined rather than summing to 0.
    const high = n(row['high_activity_met_minutes'] as number | null);
    const med = n(row['medium_activity_met_minutes'] as number | null);
    const low = n(row['low_activity_met_minutes'] as number | null);
    if (high !== undefined || med !== undefined || low !== undefined) {
      put(d, 'met_minutes', (high ?? 0) + (med ?? 0) + (low ?? 0));
    }
  }

  // daily_stress → stress_high_min (payload is SECONDS)
  for (const row of collect<Record<string, number | null>>(
    bundle.stress,
    OuraDailyStressSchema,
    'daily_stress',
  )) {
    const d = slot(String(row['day']));
    put(d, 'stress_high_min', secToMin(row['stress_high'] as number | null));
  }

  // daily_resilience → resilience level
  for (const row of collect<Record<string, unknown>>(
    bundle.resilience,
    OuraDailyResilienceSchema,
    'daily_resilience',
  )) {
    const d = slot(String(row['day']));
    const level = row['level'];
    if (typeof level === 'string') put(d, 'resilience', level as OuraDaily['resilience']);
  }

  // vO2_max → vo2max  (⚠️ field name unconfirmed; aliases accepted)
  for (const row of collect<Record<string, number | null>>(
    bundle.vo2Max,
    OuraVo2MaxSchema,
    'vO2_max',
  )) {
    const d = slot(String(row['day']));
    put(d, 'vo2max', firstDefined(row['vo2_max'], row['vO2_max'], row['value']));
  }

  // daily_cardiovascular_age → cardiovascular_age  (⚠️ field name unconfirmed)
  for (const row of collect<Record<string, number | null>>(
    bundle.cardiovascularAge,
    OuraCardiovascularAgeSchema,
    'daily_cardiovascular_age',
  )) {
    const d = slot(String(row['day']));
    put(d, 'cardiovascular_age', firstDefined(row['vascular_age'], row['cardiovascular_age'], row['value']));
  }

  const days = [...byDate.values()]
    .filter((d): d is OuraDaily => typeof d.date === 'string' && d.date.length === 10)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { days, warnings };
}

/** Pull one date out of a normalized history, or `undefined` if absent. */
export function pickDay(days: OuraDaily[], date: string): OuraDaily | undefined {
  return days.find((d) => d.date === date);
}

/**
 * Mean HRV over the most recent `days` entries that actually have an `hrv_ms`.
 *
 * Returns `undefined` when there is nothing to average — the engine must not be
 * handed a baseline of 0, which would make every real HRV read look like a
 * massive positive deviation. History may be in any order; it is sorted here.
 */
export function hrvBaseline(history: OuraDaily[], days = 28): number | undefined {
  if (days <= 0) return undefined;
  const sorted = [...history].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const values = sorted
    .slice(0, days)
    .map((d) => d.hrv_ms)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Today's HRV as a signed percentage of baseline. −10 means "10% below".
 *
 * `undefined` when either side is missing or the baseline is 0, so callers can
 * tell "no HRV data" apart from "HRV is exactly on baseline" (which is 0).
 * RESEARCH §6.4 uses ≤ −10% as a deload trigger.
 */
export function hrvDeviationPct(
  today: number | undefined,
  baseline: number | undefined,
): number | undefined {
  if (today === undefined || baseline === undefined) return undefined;
  if (!Number.isFinite(today) || !Number.isFinite(baseline) || baseline === 0) return undefined;
  return ((today - baseline) / baseline) * 100;
}

/**
 * Convenience wrapper: normalize a bundle and return today's row, the history,
 * the 28-day HRV baseline and today's deviation in one call.
 */
export function summarizeOura(
  bundle: OuraDailyBundle,
  today: string,
  baselineDays = 28,
): {
  today?: OuraDaily;
  history: OuraDaily[];
  hrvBaselineMs?: number;
  hrvDeviationPct?: number;
  warnings: string[];
} {
  const { days, warnings } = normalizeOuraBundle(bundle);
  const todayRow = pickDay(days, today);
  // The baseline excludes today, so today is compared against its own history.
  const baseline = hrvBaseline(days.filter((d) => d.date !== today), baselineDays);
  const deviation = hrvDeviationPct(todayRow?.hrv_ms, baseline);
  return {
    ...(todayRow ? { today: todayRow } : {}),
    history: days,
    ...(baseline !== undefined ? { hrvBaselineMs: baseline } : {}),
    ...(deviation !== undefined ? { hrvDeviationPct: deviation } : {}),
    warnings,
  };
}

/**
 * `personal_info` → the metric-free fields the engine wants.
 * Oura reports weight in kg and height in metres; we never leak those upward.
 */
export function normalizePersonalInfo(row: OuraRecord | null | undefined): {
  age?: number;
  weight_lb?: number;
  height_in?: number;
} {
  if (!row) return {};
  const kg = n(row['weight'] as number | null);
  const m = n(row['height'] as number | null);
  return {
    ...(n(row['age'] as number | null) !== undefined ? { age: n(row['age'] as number | null) } : {}),
    ...(kg !== undefined ? { weight_lb: kg * 2.2046226218 } : {}),
    ...(m !== undefined ? { height_in: m * 39.3700787402 } : {}),
  };
}
