/**
 * Strava API v3 client (RESEARCH_FOUNDATION §4).
 *
 * OAuth 2.0 authorization-code flow. Access tokens live ~6 hours and Strava
 * ROTATES the refresh token on some refreshes — always persist whatever
 * `refreshToken()` returns, never assume the old refresh token still works.
 *
 * Rate limits: 200 requests / 15 min and 2,000 / day overall (100 / 1,000 for
 * non-upload reads). One athlete will never come close, but the token bucket
 * below makes that a guarantee rather than a hope, and it is what keeps the
 * nightly reconcile from hammering Strava after an outage.
 *
 * Degradation: every method returns an `IntegrationResult`. No Strava means
 * manual cardio entry (PRD §8.7); nothing here throws into the request path.
 */

import {
  type IntegrationResult,
  requestJson,
  succeed,
  fail,
  withQuery,
} from '../http.js';

export const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
export const STRAVA_OAUTH_AUTHORIZE = 'https://www.strava.com/oauth/authorize';
export const STRAVA_OAUTH_TOKEN = 'https://www.strava.com/oauth/token';

/** Scopes we ever ask for. `activity:read_all` is required for private runs. */
export const STRAVA_SCOPES = [
  'read',
  'read_all',
  'profile:read_all',
  'activity:read',
  'activity:read_all',
] as const;
export type StravaScope = (typeof STRAVA_SCOPES)[number];

/** Stream keys Strava will return. `heartrate` is the one that matters. */
export const STRAVA_STREAM_KEYS = [
  'time',
  'distance',
  'heartrate',
  'velocity_smooth',
  'cadence',
  'altitude',
  'latlng',
  'watts',
  'temp',
  'moving',
  'grade_smooth',
] as const;
export type StravaStreamKey = (typeof STRAVA_STREAM_KEYS)[number];

/** The keys we actually request for zone computation and pace. */
export const DEFAULT_STREAM_KEYS: StravaStreamKey[] = [
  'time',
  'distance',
  'heartrate',
  'velocity_smooth',
  'cadence',
  'altitude',
];

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  /** Unix seconds. Strava's own field name. */
  expires_at: number;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  athlete?: Record<string, unknown>;
}

export interface StravaClientOptions {
  clientId: string;
  clientSecret: string;
  /** Current tokens, if we already have them. */
  tokens?: StravaTokens;
  /**
   * Called whenever tokens change (proactive refresh or a 401 retry). Persist
   * them — the rotated refresh token is the one that will work next time.
   */
  onTokens?: (tokens: StravaTokens) => void | Promise<void>;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  /** Share one limiter across clients if you construct more than one. */
  limiter?: TokenBucketLimiter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two-window token bucket honouring Strava's 200 req / 15 min and 2,000 / day.
 *
 * Both windows must have room before a request goes out. `acquire()` waits
 * rather than failing, unless the wait would exceed `maxWaitMs` — in which case
 * the caller gets a `rate_limited` error and can fall back to manual entry.
 * In-process only; a serverless deployment gets one bucket per warm instance,
 * which is still far under the real limit for a single athlete.
 */
export class TokenBucketLimiter {
  private readonly shortWindowMs: number;
  private readonly shortLimit: number;
  private readonly dayWindowMs = 24 * 60 * 60 * 1000;
  private readonly dayLimit: number;
  private shortHits: number[] = [];
  private dayHits: number[] = [];
  /** Set when Strava itself says we are limited; nothing goes out until then. */
  private blockedUntil = 0;

  constructor(opts: { shortLimit?: number; shortWindowMs?: number; dayLimit?: number } = {}) {
    this.shortLimit = opts.shortLimit ?? 200;
    this.shortWindowMs = opts.shortWindowMs ?? 15 * 60 * 1000;
    this.dayLimit = opts.dayLimit ?? 2000;
  }

  /** How many requests remain in each window right now. */
  remaining(now = Date.now()): { short: number; day: number } {
    this.prune(now);
    return {
      short: Math.max(0, this.shortLimit - this.shortHits.length),
      day: Math.max(0, this.dayLimit - this.dayHits.length),
    };
  }

  /**
   * Wait until a slot is free and consume it. Returns `false` when the wait
   * would exceed `maxWaitMs` (default 30s) so the caller can degrade instead.
   */
  async acquire(maxWaitMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const now = Date.now();
      this.prune(now);
      const waitFor = Math.max(
        this.blockedUntil > now ? this.blockedUntil - now : 0,
        this.shortHits.length < this.shortLimit ? 0 : (this.shortHits[0] ?? now) + this.shortWindowMs - now,
        this.dayHits.length < this.dayLimit ? 0 : (this.dayHits[0] ?? now) + this.dayWindowMs - now,
      );
      if (waitFor <= 0) {
        this.shortHits.push(now);
        this.dayHits.push(now);
        return true;
      }
      if (now + waitFor > deadline) return false;
      await new Promise((r) => setTimeout(r, Math.min(waitFor, 1_000)));
    }
  }

  /** Called on a 429 so we stop sending until the window resets. */
  noteRateLimited(retryAfterSec?: number): void {
    const wait = (retryAfterSec ?? 60) * 1000;
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + wait);
  }

  /**
   * Feed Strava's `X-RateLimit-Usage` / `X-RateLimit-Limit` headers back in so
   * the bucket tracks the server's view, not just our own count.
   */
  syncFromHeaders(usage: string | null, limit: string | null): void {
    if (!usage) return;
    const [shortUsed, dayUsed] = usage.split(',').map((s) => Number(s.trim()));
    const now = Date.now();
    if (Number.isFinite(shortUsed) && (shortUsed as number) > this.shortHits.length) {
      this.shortHits = new Array(Math.min(shortUsed as number, this.shortLimit)).fill(now);
    }
    if (Number.isFinite(dayUsed) && (dayUsed as number) > this.dayHits.length) {
      this.dayHits = new Array(Math.min(dayUsed as number, this.dayLimit)).fill(now);
    }
    void limit;
  }

  private prune(now: number): void {
    this.shortHits = this.shortHits.filter((t) => now - t < this.shortWindowMs);
    this.dayHits = this.dayHits.filter((t) => now - t < this.dayWindowMs);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityListParams {
  /** Unix seconds; activities after this time. */
  after?: number;
  /** Unix seconds; activities before this time. */
  before?: number;
  page?: number;
  /** Strava caps this at 200. */
  per_page?: number;
}

/** Raw Strava payloads stay loose; `normalize.ts` owns the mapping. */
export type StravaActivity = Record<string, unknown>;
export type StravaLap = Record<string, unknown>;

/** One stream as Strava returns it in the key-by-type form. */
export interface StravaStream {
  type?: string;
  data: (number | null)[] | number[][];
  series_type?: string;
  original_size?: number;
  resolution?: string;
}

/** `activities/{id}/streams?key_by_type=true` shape. */
export type StravaStreamSet = Partial<Record<StravaStreamKey, StravaStream>>;

export class StravaClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly onTokens: ((t: StravaTokens) => void | Promise<void>) | undefined;
  readonly limiter: TokenBucketLimiter;
  private tokens: StravaTokens | undefined;

  constructor(opts: StravaClientOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.tokens = opts.tokens;
    this.onTokens = opts.onTokens;
    this.base = (opts.baseUrl ?? STRAVA_API_BASE).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.retries = opts.retries ?? 2;
    this.fetchImpl = opts.fetchImpl;
    this.limiter = opts.limiter ?? new TokenBucketLimiter();
  }

  /** The tokens currently held, for persistence. */
  get currentTokens(): StravaTokens | undefined {
    return this.tokens;
  }

  // ── OAuth ────────────────────────────────────────────────────────────────

  /**
   * Build the consent URL Seth opens once. `approval_prompt=auto` so he is not
   * re-prompted forever; `state` should be a CSRF nonce you verify on callback.
   */
  buildAuthUrl(
    scopes: readonly StravaScope[] = ['read', 'activity:read_all'],
    opts: { redirectUri: string; state?: string; approvalPrompt?: 'auto' | 'force' } = {
      redirectUri: '',
    },
  ): string {
    return withQuery(STRAVA_OAUTH_AUTHORIZE, {
      client_id: this.clientId,
      redirect_uri: opts.redirectUri,
      response_type: 'code',
      approval_prompt: opts.approvalPrompt ?? 'auto',
      scope: scopes.join(','),
      state: opts.state,
    });
  }

  /** Swap the `code` from the redirect for the first token pair. */
  async exchangeCode(code: string): Promise<IntegrationResult<StravaTokens>> {
    const res = await requestJson<StravaTokens>(STRAVA_OAUTH_TOKEN, {
      method: 'POST',
      body: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
      },
      timeoutMs: this.timeoutMs,
      retries: 1,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });
    if (!res.ok) return res;
    return this.adoptTokens(res.value);
  }

  /**
   * Refresh the access token. Strava may return a NEW refresh token; whatever
   * comes back is what gets persisted through `onTokens`.
   */
  async refreshToken(refreshToken?: string): Promise<IntegrationResult<StravaTokens>> {
    const rt = refreshToken ?? this.tokens?.refresh_token;
    if (!rt) return fail('auth', 'no Strava refresh token available');
    const res = await requestJson<StravaTokens>(STRAVA_OAUTH_TOKEN, {
      method: 'POST',
      body: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: rt,
        grant_type: 'refresh_token',
      },
      timeoutMs: this.timeoutMs,
      retries: 1,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });
    if (!res.ok) return res;
    return this.adoptTokens({ ...res.value, refresh_token: res.value.refresh_token || rt });
  }

  /** True when the access token is gone or expires within 5 minutes. */
  needsRefresh(nowSec = Math.floor(Date.now() / 1000)): boolean {
    if (!this.tokens?.access_token) return true;
    return (this.tokens.expires_at ?? 0) - nowSec < 300;
  }

  /** Store tokens and notify the persistence hook. */
  private async adoptTokens(t: StravaTokens): Promise<IntegrationResult<StravaTokens>> {
    if (!t?.access_token) return fail('auth', 'Strava token response had no access_token', { detail: t });
    this.tokens = t;
    try {
      await this.onTokens?.(t);
    } catch {
      // Persistence is the caller's problem; a failed save must not break the
      // in-flight request. The token is still usable for this process.
    }
    return succeed(t);
  }

  // ── requests ─────────────────────────────────────────────────────────────

  /**
   * Authenticated GET with proactive refresh, rate limiting and one 401 retry.
   */
  private async authedGet<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    isRetry = false,
  ): Promise<IntegrationResult<T>> {
    if (this.needsRefresh()) {
      const refreshed = await this.refreshToken();
      if (!refreshed.ok) return refreshed;
    }
    const token = this.tokens?.access_token;
    if (!token) return fail('auth', 'Strava client has no access token');

    const gotSlot = await this.limiter.acquire();
    if (!gotSlot) {
      return fail('rate_limited', 'Strava rate-limit budget exhausted; falling back to manual entry');
    }

    const res = await requestJson<T>(`${this.base}/${path.replace(/^\//, '')}`, {
      headers: { authorization: `Bearer ${token}` },
      ...(query ? { query } : {}),
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });

    if (!res.ok) {
      if (res.error.kind === 'rate_limited') {
        this.limiter.noteRateLimited(res.error.retryAfterSec);
      }
      // A 401 after a proactive refresh means the token was revoked mid-flight.
      // Try exactly one forced refresh, then give up.
      if (res.error.kind === 'auth' && res.error.status === 401 && !isRetry) {
        const refreshed = await this.refreshToken();
        if (refreshed.ok) return this.authedGet<T>(path, query, true);
      }
    }
    return res;
  }

  // ── endpoints ────────────────────────────────────────────────────────────

  /** The authenticated athlete. Handy for `athlete.id` and the profile. */
  getAthlete(): Promise<IntegrationResult<Record<string, unknown>>> {
    return this.authedGet<Record<string, unknown>>('athlete');
  }

  /**
   * `athlete/activities` — the summary list. Use `after` (unix seconds) for the
   * nightly reconcile; Strava caps `per_page` at 200.
   */
  listActivities(params: ActivityListParams = {}): Promise<IntegrationResult<StravaActivity[]>> {
    return this.authedGet<StravaActivity[]>('athlete/activities', {
      after: params.after,
      before: params.before,
      page: params.page ?? 1,
      per_page: Math.min(params.per_page ?? 30, 200),
    });
  }

  /**
   * Page through `athlete/activities` until exhausted. Bounded at 20 pages so a
   * bad cursor cannot burn the rate-limit budget.
   */
  async listAllActivities(
    params: ActivityListParams = {},
    maxPages = 20,
  ): Promise<IntegrationResult<StravaActivity[]>> {
    const out: StravaActivity[] = [];
    const perPage = Math.min(params.per_page ?? 100, 200);
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await this.listActivities({ ...params, page, per_page: perPage });
      if (!res.ok) return out.length > 0 ? succeed(out) : res;
      out.push(...res.value);
      if (res.value.length < perPage) break;
    }
    return succeed(out);
  }

  /**
   * `activities/{id}` — the detailed activity: distance (m), moving_time (s),
   * average_heartrate, max_heartrate, average_speed (m/s), sport_type.
   */
  getActivity(
    id: string | number,
    includeAllEfforts = false,
  ): Promise<IntegrationResult<StravaActivity>> {
    return this.authedGet<StravaActivity>(`activities/${id}`, {
      include_all_efforts: includeAllEfforts,
    });
  }

  /**
   * `activities/{id}/streams` keyed by type. The heart-rate stream plus the
   * time stream is what `zones.ts` integrates into Zone minutes.
   */
  getActivityStreams(
    id: string | number,
    keys: readonly StravaStreamKey[] = DEFAULT_STREAM_KEYS,
  ): Promise<IntegrationResult<StravaStreamSet>> {
    return this.authedGet<StravaStreamSet>(`activities/${id}/streams`, {
      keys: keys.join(','),
      key_by_type: true,
    });
  }

  /** `activities/{id}/laps` — per-lap splits, used for interval compliance. */
  getActivityLaps(id: string | number): Promise<IntegrationResult<StravaLap[]>> {
    return this.authedGet<StravaLap[]>(`activities/${id}/laps`);
  }

  /**
   * ⛔ There is deliberately no `getActivityZones()` here.
   *
   * `GET /activities/{id}/zones` requires a **paid Strava subscription**
   * (RESEARCH §4) and this project has a hard $0/month ceiling (CLAUDE.md).
   * We compute zone minutes ourselves from the heart-rate stream in
   * `strava/zones.ts` — same numbers, no dependency, no bill. Do not add it.
   */
}
