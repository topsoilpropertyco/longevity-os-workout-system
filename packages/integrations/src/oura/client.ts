/**
 * Oura API v2 client (RESEARCH_FOUNDATION §3).
 *
 * Auth: a Personal Access Token as a bearer. PATs do not expire (they are
 * revocable), so there is no refresh dance — single user, one secret.
 * Base: https://api.ouraring.com/v2/usercollection/
 *
 * Two parameter families, and mixing them up is the classic Oura mistake:
 *   - DAILY documents take `start_date` / `end_date` (YYYY-MM-DD).
 *   - TIME SERIES documents take `start_datetime` / `end_datetime` (ISO 8601).
 * Every list response carries `next_token`; the paged helpers follow it.
 *
 * Rate limit is reported as 5,000 requests / 5 minutes per token — irrelevant
 * for one athlete, so this client adds no limiter (Strava's does).
 *
 * Degradation: every method returns an `IntegrationResult`. A dead Oura means
 * the today card falls back to the 1–5 sliders; it never blocks and never
 * throws (CLAUDE.md invariant 2).
 */

import {
  type IntegrationResult,
  requestJson,
  succeed,
  fail,
} from '../http.js';

export const OURA_BASE = 'https://api.ouraring.com/v2/usercollection/';
/** Canned data, same shapes, no real account needed. Used by the tests. */
export const OURA_SANDBOX_BASE = 'https://api.ouraring.com/v2/sandbox/usercollection/';

/** Daily-document endpoints: `start_date` / `end_date`. */
export const OURA_DAILY_ENDPOINTS = [
  'daily_readiness',
  'daily_sleep',
  'daily_activity',
  'daily_stress',
  'daily_resilience',
  'daily_cardiovascular_age',
  'vO2_max',
  'sleep',
  'workout',
  'session',
  'tag',
  'enhanced_tag',
] as const;
export type OuraDailyEndpoint = (typeof OURA_DAILY_ENDPOINTS)[number];

/** Time-series endpoints: `start_datetime` / `end_datetime`. */
export const OURA_TIMESERIES_ENDPOINTS = ['heartrate'] as const;
export type OuraTimeseriesEndpoint = (typeof OURA_TIMESERIES_ENDPOINTS)[number];

export interface OuraClientOptions {
  /** Personal Access Token from cloud.ouraring.com/personal-access-tokens. */
  token: string;
  /** Route to /v2/sandbox/usercollection/ instead of the live collection. */
  sandbox?: boolean;
  /** Override the base entirely (tests, proxies). Wins over `sandbox`. */
  baseUrl?: string;
  /** Per-request timeout. Default 15s. */
  timeoutMs?: number;
  /** Retries on 429/5xx. Default 2. */
  retries?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

/** A single page of an Oura v2 list endpoint. */
export interface OuraPage<T> {
  data: T[];
  next_token: string | null;
}

/** Inclusive date window, ISO `YYYY-MM-DD`. */
export interface DateRange {
  start_date: string;
  end_date: string;
}

/** Inclusive instant window, ISO 8601. */
export interface DatetimeRange {
  start_datetime: string;
  end_datetime: string;
}

/**
 * Raw payload rows. These are intentionally loose — `schema.ts` holds the zod
 * contracts that validate them, and `normalize.ts` turns them into `OuraDaily`.
 * Extra fields Oura adds later pass through untouched.
 */
export type OuraRecord = Record<string, unknown>;

/** Hard ceiling on pages followed, so a pagination bug cannot loop forever. */
const MAX_PAGES = 50;

/**
 * Oura API v2 client. Construct once per request path; it holds no mutable
 * state beyond its config.
 */
export class OuraClient {
  private readonly base: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(opts: OuraClientOptions) {
    this.token = opts.token;
    this.base = normalizeBase(opts.baseUrl ?? (opts.sandbox ? OURA_SANDBOX_BASE : OURA_BASE));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.retries = opts.retries ?? 2;
    this.fetchImpl = opts.fetchImpl;
  }

  /** True when this client is pointed at the sandbox collection. */
  get isSandbox(): boolean {
    return this.base.includes('/sandbox/');
  }

  /** The base URL in use, for logging. */
  get baseUrl(): string {
    return this.base;
  }

  // ── low level ──────────────────────────────────────────────────────────────

  /** One page of any endpoint. Prefer the typed helpers below. */
  async getPage<T = OuraRecord>(
    endpoint: string,
    query: Record<string, string | number | undefined>,
  ): Promise<IntegrationResult<OuraPage<T>>> {
    const res = await requestJson<OuraPage<T>>(`${this.base}${endpoint}`, {
      headers: { authorization: `Bearer ${this.token}` },
      query,
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });
    if (!res.ok) return res;
    const page = res.value as OuraPage<T> | undefined;
    if (!page || !Array.isArray(page.data)) {
      return fail('schema', `Oura ${endpoint} returned no \`data\` array`, { detail: page });
    }
    return succeed({ data: page.data, next_token: page.next_token ?? null });
  }

  /**
   * Follow `next_token` until exhausted (or MAX_PAGES) and return every row.
   * A failure mid-pagination returns the error, not a half list — the caller
   * should not mistake a truncated window for a real one.
   */
  async getAll<T = OuraRecord>(
    endpoint: string,
    query: Record<string, string | number | undefined>,
  ): Promise<IntegrationResult<T[]>> {
    const rows: T[] = [];
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await this.getPage<T>(endpoint, { ...query, next_token: token });
      if (!res.ok) return res;
      rows.push(...res.value.data);
      if (!res.value.next_token) return succeed(rows);
      token = res.value.next_token;
    }
    return fail('unknown', `Oura ${endpoint} pagination exceeded ${MAX_PAGES} pages`);
  }

  /** Any daily-document endpoint by name, fully paged. */
  daily<T = OuraRecord>(
    endpoint: OuraDailyEndpoint,
    range: DateRange,
  ): Promise<IntegrationResult<T[]>> {
    return this.getAll<T>(endpoint, { start_date: range.start_date, end_date: range.end_date });
  }

  /** Any time-series endpoint by name, fully paged. */
  timeseries<T = OuraRecord>(
    endpoint: OuraTimeseriesEndpoint,
    range: DatetimeRange,
  ): Promise<IntegrationResult<T[]>> {
    return this.getAll<T>(endpoint, {
      start_datetime: range.start_datetime,
      end_datetime: range.end_datetime,
    });
  }

  // ── typed endpoint methods ─────────────────────────────────────────────────

  /** Readiness score plus contributors (HRV balance, RHR, body temp, …). */
  dailyReadiness(range: DateRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.daily('daily_readiness', range);
  }

  /** Sleep score plus contributors. Not the same as `sleep()`. */
  dailySleep(range: DateRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.daily('daily_sleep', range);
  }

  /**
   * Detailed sleep periods. **This is where HRV lives** (`average_hrv`), along
   * with `average_heart_rate` and `average_breath`. `daily_sleep` has none of
   * them — a long-standing source of confusion.
   */
  sleep(range: DateRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.daily('sleep', range);
  }

  /** Activity score, steps, MET minutes, active calories. */
  dailyActivity(range: DateRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.daily('daily_activity', range);
  }

  /** Daytime stress: `stress_high`/`recovery_high` in SECONDS, plus a summary. */
  dailyStress(range: DateRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.daily('daily_stress', range);
  }

  /** Resilience level: limited | adequate | solid | strong | exceptional. */
  dailyResilience(range: DateRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.daily('daily_resilience', range);
  }

  /**
   * VO2max estimates. Note the endpoint's odd casing: `vO2_max`.
   * ⚠️ Verify at build time: RESEARCH §10.3 flags the exact payload shape of
   * `vO2_max` and `daily_cardiovascular_age` as unconfirmed — hit the sandbox
   * and check the field names before trusting the dashboard tile.
   */
  vo2Max(range: DateRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.daily('vO2_max', range);
  }

  /**
   * Cardiovascular age (in years, typically a `vascular_age` field).
   * ⚠️ Verify at build time — see `vo2Max` above.
   */
  dailyCardiovascularAge(range: DateRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.daily('daily_cardiovascular_age', range);
  }

  /** Age, weight (kg), height (m), biological sex. Not a list endpoint. */
  async personalInfo(): Promise<IntegrationResult<OuraRecord>> {
    const res = await requestJson<OuraRecord>(`${this.base}personal_info`, {
      headers: { authorization: `Bearer ${this.token}` },
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });
    if (!res.ok) return res;
    if (!res.value || typeof res.value !== 'object') {
      return fail('schema', 'Oura personal_info returned a non-object');
    }
    return succeed(res.value);
  }

  /** Oura-detected or manually logged workouts. Useful for external sessions. */
  workout(range: DateRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.daily('workout', range);
  }

  /**
   * Daytime heart rate time series. 5-minute granularity — good for trends,
   * NOT workout-grade. Zone minutes come from the Strava chest-strap stream.
   */
  heartrate(range: DatetimeRange): Promise<IntegrationResult<OuraRecord[]>> {
    return this.timeseries('heartrate', range);
  }

  /**
   * Pull every daily collection for one window in parallel. A single failing
   * endpoint does not sink the others: each slot is independently `null` when
   * it failed, and `normalize.ts` simply leaves those fields `undefined`.
   */
  async fetchDailyBundle(range: DateRange): Promise<OuraDailyBundle> {
    const [readiness, dailySleep, sleep, activity, stress, resilience, vo2, cvAge] =
      await Promise.all([
        this.dailyReadiness(range),
        this.dailySleep(range),
        this.sleep(range),
        this.dailyActivity(range),
        this.dailyStress(range),
        this.dailyResilience(range),
        this.vo2Max(range),
        this.dailyCardiovascularAge(range),
      ]);
    const unwrap = (r: IntegrationResult<OuraRecord[]>): OuraRecord[] | null =>
      r.ok ? r.value : null;
    return {
      range,
      readiness: unwrap(readiness),
      dailySleep: unwrap(dailySleep),
      sleep: unwrap(sleep),
      activity: unwrap(activity),
      stress: unwrap(stress),
      resilience: unwrap(resilience),
      vo2Max: unwrap(vo2),
      cardiovascularAge: unwrap(cvAge),
      errors: [readiness, dailySleep, sleep, activity, stress, resilience, vo2, cvAge]
        .filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
        .map((r) => r.error),
    };
  }
}

/** Raw rows from every daily endpoint for one window. `null` = that call failed. */
export interface OuraDailyBundle {
  range: DateRange;
  readiness: OuraRecord[] | null;
  dailySleep: OuraRecord[] | null;
  sleep: OuraRecord[] | null;
  activity: OuraRecord[] | null;
  stress: OuraRecord[] | null;
  resilience: OuraRecord[] | null;
  vo2Max: OuraRecord[] | null;
  cardiovascularAge: OuraRecord[] | null;
  errors: { kind: string; message: string }[];
}

/** Guarantee exactly one trailing slash on the base URL. */
function normalizeBase(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

/** Convenience: the inclusive `YYYY-MM-DD` window ending today, `days` long. */
export function lastNDays(days: number, today: Date = new Date()): DateRange {
  const end = new Date(today);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start_date: isoDate(start), end_date: isoDate(end) };
}

/** `Date` → `YYYY-MM-DD`. */
export function isoDate(d: Date): string {
  const s = d.toISOString();
  return s.slice(0, 10);
}
