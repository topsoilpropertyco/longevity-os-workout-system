/**
 * Zod contracts for Oura API v2 payloads (RESEARCH_FOUNDATION §3).
 *
 * Two design rules here:
 *   1. **Unknown extra fields pass through.** Oura adds fields; that must never
 *      be a failure. Every object schema is `.passthrough()`.
 *   2. **A shape CHANGE is loud.** If `average_hrv` stops being a number, or
 *      `data` stops being an array, validation fails with a readable path so we
 *      see it in the logs — instead of silently normalizing HRV to `undefined`
 *      forever and quietly degrading the readiness band.
 *
 * Almost every leaf is `.optional().nullable()` because Oura genuinely omits or
 * nulls fields on incomplete days. `null` is coerced to `undefined` in
 * `normalize.ts`; it is never coerced to 0.
 */

import { z } from 'zod';
import type { IntegrationResult } from '../http.js';
import { succeed, fail } from '../http.js';

/** A number Oura may omit or null out. Never defaulted. */
const num = z.number().optional().nullable();
/** A string Oura may omit or null out. */
const str = z.string().optional().nullable();
/** ISO `YYYY-MM-DD`. Loud if the shape drifts to a timestamp. */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Contributor sub-objects vary by endpoint and version; keep them open. */
const contributors = z.record(z.union([z.number(), z.string(), z.null()])).optional().nullable();

/** `daily_readiness` — score 0–100 plus contributors and temperature deviation. */
export const OuraDailyReadinessSchema = z
  .object({
    id: str,
    day: isoDay,
    score: num,
    temperature_deviation: num,
    temperature_trend_deviation: num,
    contributors,
    timestamp: str,
  })
  .passthrough();
export type OuraDailyReadinessRow = z.infer<typeof OuraDailyReadinessSchema>;

/** `daily_sleep` — the SCORE document. HRV is not here; see `sleep`. */
export const OuraDailySleepSchema = z
  .object({
    id: str,
    day: isoDay,
    score: num,
    contributors,
    timestamp: str,
  })
  .passthrough();
export type OuraDailySleepRow = z.infer<typeof OuraDailySleepSchema>;

/**
 * `sleep` — detailed sleep periods. **`average_hrv` (ms) is the HRV source for
 * the whole system.** `average_heart_rate` here is the sleeping RHR we use.
 * `day` is the day the sleep is attributed to, not the bedtime date.
 */
export const OuraSleepPeriodSchema = z
  .object({
    id: str,
    day: isoDay,
    type: str,
    average_hrv: num,
    average_heart_rate: num,
    lowest_heart_rate: num,
    average_breath: num,
    total_sleep_duration: num,
    time_in_bed: num,
    efficiency: num,
    readiness_score_delta: num,
    bedtime_start: str,
    bedtime_end: str,
  })
  .passthrough();
export type OuraSleepPeriodRow = z.infer<typeof OuraSleepPeriodSchema>;

/** `daily_activity` — score, steps, MET minutes, active calories. */
export const OuraDailyActivitySchema = z
  .object({
    id: str,
    day: isoDay,
    score: num,
    steps: num,
    active_calories: num,
    total_calories: num,
    target_calories: num,
    equivalent_walking_distance: num,
    high_activity_met_minutes: num,
    medium_activity_met_minutes: num,
    low_activity_met_minutes: num,
    average_met_minutes: num,
    contributors,
  })
  .passthrough();
export type OuraDailyActivityRow = z.infer<typeof OuraDailyActivitySchema>;

/**
 * `daily_stress` — `stress_high` and `recovery_high` are SECONDS, not minutes.
 * `normalize.ts` converts to the minutes the engine's `stress_high_min` wants.
 */
export const OuraDailyStressSchema = z
  .object({
    id: str,
    day: isoDay,
    stress_high: num,
    recovery_high: num,
    day_summary: str,
  })
  .passthrough();
export type OuraDailyStressRow = z.infer<typeof OuraDailyStressSchema>;

/** `daily_resilience` — level enum plus per-axis contributors. */
export const OuraDailyResilienceSchema = z
  .object({
    id: str,
    day: isoDay,
    level: z
      .enum(['limited', 'adequate', 'solid', 'strong', 'exceptional'])
      .optional()
      .nullable(),
    contributors,
  })
  .passthrough();
export type OuraDailyResilienceRow = z.infer<typeof OuraDailyResilienceSchema>;

/**
 * `vO2_max`.
 * ⚠️ Verify at build time (RESEARCH §10.3): the exact field name is not
 * confirmed. We accept `vo2_max`, `vO2_max` and `value` and take the first
 * present, so a rename degrades to `undefined` rather than to nonsense.
 */
export const OuraVo2MaxSchema = z
  .object({
    id: str,
    day: isoDay,
    vo2_max: num,
    vO2_max: num,
    value: num,
    timestamp: str,
  })
  .passthrough();
export type OuraVo2MaxRow = z.infer<typeof OuraVo2MaxSchema>;

/**
 * `daily_cardiovascular_age`.
 * ⚠️ Verify at build time (RESEARCH §10.3): `vascular_age` is the expected
 * field; `cardiovascular_age` and `value` are accepted as aliases.
 */
export const OuraCardiovascularAgeSchema = z
  .object({
    id: str,
    day: isoDay,
    vascular_age: num,
    cardiovascular_age: num,
    value: num,
  })
  .passthrough();
export type OuraCardiovascularAgeRow = z.infer<typeof OuraCardiovascularAgeSchema>;

/** `personal_info` — METRIC units: weight kg, height m. Convert before use. */
export const OuraPersonalInfoSchema = z
  .object({
    id: str,
    age: num,
    weight: num,
    height: num,
    biological_sex: str,
    email: str,
  })
  .passthrough();
export type OuraPersonalInfoRow = z.infer<typeof OuraPersonalInfoSchema>;

/** `workout` — activity, intensity, calories, start/end. */
export const OuraWorkoutSchema = z
  .object({
    id: str,
    day: isoDay,
    activity: str,
    intensity: str,
    calories: num,
    distance: num,
    start_datetime: str,
    end_datetime: str,
    source: str,
  })
  .passthrough();
export type OuraWorkoutRow = z.infer<typeof OuraWorkoutSchema>;

/** `heartrate` — 5-minute daytime samples. Not workout-grade. */
export const OuraHeartrateSchema = z
  .object({
    bpm: z.number(),
    source: str,
    timestamp: z.string(),
  })
  .passthrough();
export type OuraHeartrateRow = z.infer<typeof OuraHeartrateSchema>;

/** Envelope for any v2 list endpoint. */
export const OuraPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      data: z.array(item),
      next_token: z.string().optional().nullable(),
    })
    .passthrough();

/** Endpoint name → schema, so callers can validate generically. */
export const OURA_SCHEMAS = {
  daily_readiness: OuraDailyReadinessSchema,
  daily_sleep: OuraDailySleepSchema,
  sleep: OuraSleepPeriodSchema,
  daily_activity: OuraDailyActivitySchema,
  daily_stress: OuraDailyStressSchema,
  daily_resilience: OuraDailyResilienceSchema,
  vO2_max: OuraVo2MaxSchema,
  daily_cardiovascular_age: OuraCardiovascularAgeSchema,
  personal_info: OuraPersonalInfoSchema,
  workout: OuraWorkoutSchema,
  heartrate: OuraHeartrateSchema,
} as const;

export type OuraEndpointName = keyof typeof OURA_SCHEMAS;

/**
 * Validate one row and return a typed result rather than throwing. A schema
 * failure is an `IntegrationError` of kind `schema` whose message names the
 * endpoint and the failing field path.
 */
export function parseRow<T extends z.ZodTypeAny>(
  schema: T,
  row: unknown,
  label: string,
): IntegrationResult<z.infer<T>> {
  const parsed = schema.safeParse(row);
  if (parsed.success) return succeed(parsed.data as z.infer<T>);
  return fail('schema', `Oura ${label} payload changed shape: ${formatZodError(parsed.error)}`, {
    detail: parsed.error.issues,
  });
}

/**
 * Validate a whole page of rows. Rows that fail are DROPPED and reported in
 * `skipped`, so one malformed day never blanks a 28-day history — but the
 * caller still sees that something changed and can log it loudly.
 */
export function parseRows<T extends z.ZodTypeAny>(
  schema: T,
  rows: unknown[] | null | undefined,
  label: string,
): { rows: z.infer<T>[]; skipped: string[] } {
  if (!rows) return { rows: [], skipped: [] };
  const out: z.infer<T>[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) out.push(parsed.data as z.infer<T>);
    else skipped.push(`${label}: ${formatZodError(parsed.error)}`);
  }
  return { rows: out, skipped };
}

/** Compact, readable rendering of a zod error: `path: message; …`. */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}
