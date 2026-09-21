/**
 * Shared fetch plumbing for every integration in this package.
 *
 * CLAUDE.md invariant 2 — *every integration degrades gracefully*. Nothing in
 * here ever throws into the request path: transport failures, non-2xx statuses,
 * timeouts and malformed JSON all come back as a typed `IntegrationError`, and
 * the caller decides what to fall back to.
 *
 * Node 20+ built-in `fetch` only. No axios, no node-fetch.
 */

/** Discriminated result. Callers branch on `ok` instead of catching. */
export type IntegrationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IntegrationError };

export type IntegrationErrorKind =
  | 'network'
  | 'timeout'
  | 'auth'
  /**
   * The credential is not merely wrong, it is unrecoverable without a human.
   *
   * This is deliberately NOT `auth`. An `auth` failure might be a typo'd key or
   * a clock skew and is worth surfacing as "check your config"; a
   * `needs_reauth` means the grant itself is gone — an OAuth `invalid_grant`,
   * or a refresh token that was already spent (Oura rotates them and each one
   * works exactly once). RETRYING MAKES IT WORSE: every attempt burns another
   * token and widens the gap. The only fix is a human opening a browser and
   * re-authorising, so callers should stop, say so, and wait.
   */
  | 'needs_reauth'
  | 'rate_limited'
  | 'not_found'
  | 'server'
  | 'client'
  | 'parse'
  | 'schema'
  | 'aborted'
  | 'unknown';

/** Everything that can go wrong, flattened into one inspectable shape. */
export interface IntegrationError {
  kind: IntegrationErrorKind;
  message: string;
  /** HTTP status when the failure came from a response. */
  status?: number;
  /** Seconds the upstream asked us to wait, when it said so. */
  retryAfterSec?: number;
  /** Raw body (truncated) or the underlying error, for logs — never for users. */
  detail?: unknown;
}

/** Build an error result without constructing an Error object. */
export function fail<T = never>(
  kind: IntegrationErrorKind,
  message: string,
  extra: Omit<IntegrationError, 'kind' | 'message'> = {},
): IntegrationResult<T> {
  return { ok: false, error: { kind, message, ...extra } };
}

/** Build a success result. */
export function succeed<T>(value: T): IntegrationResult<T> {
  return { ok: true, value };
}

/** Map an HTTP status onto an error kind. */
export function kindForStatus(status: number): IntegrationErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  if (status >= 400) return 'client';
  return 'unknown';
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Pre-serialized body, or a plain object which is sent as JSON. */
  body?: unknown;
  /** Query parameters; `undefined`/`null` entries are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Milliseconds before we give up. Default 15000. */
  timeoutMs?: number;
  /** Retries on 429/5xx/network, with exponential backoff. Default 2. */
  retries?: number;
  /** Caller-supplied abort signal, composed with the timeout. */
  signal?: AbortSignal;
  /** Swap in a fetch implementation for tests. */
  fetchImpl?: typeof fetch;
}

/** Append query parameters to a URL, skipping empty values. */
export function withQuery(
  url: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  if (!query) return url;
  const entries = Object.entries(query).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (entries.length === 0) return url;
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Parse a `Retry-After` header (seconds or HTTP-date) into seconds. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber)) return Math.max(0, asNumber);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  return undefined;
}

/**
 * Perform one JSON request and never throw. Retries idempotent-ish failures
 * (429 and 5xx and transport errors) with exponential backoff plus jitter.
 */
export async function requestJson<T>(
  url: string,
  opts: RequestOptions = {},
): Promise<IntegrationResult<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    query,
    timeoutMs = 15_000,
    retries = 2,
    signal,
    fetchImpl,
  } = opts;

  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return fail('network', 'global fetch is unavailable; Node 20+ is required');
  }

  const target = withQuery(url, query);
  const isPlainObjectBody =
    body !== undefined && body !== null && typeof body === 'object' && !(body instanceof Uint8Array) &&
    typeof (body as { getBoundary?: unknown }).getBoundary !== 'function' &&
    !(typeof FormData !== 'undefined' && body instanceof FormData);

  const finalHeaders: Record<string, string> = { accept: 'application/json', ...headers };
  // `BodyInit` is not in the ES2022 lib, so the union is spelled out.
  type FetchBody = string | Uint8Array | FormData;
  let payload: FetchBody | undefined;
  if (body === undefined || body === null) {
    payload = undefined;
  } else if (typeof body === 'string' || body instanceof Uint8Array ||
    (typeof FormData !== 'undefined' && body instanceof FormData)) {
    payload = body as FetchBody;
  } else if (isPlainObjectBody) {
    payload = JSON.stringify(body);
    if (!('content-type' in finalHeaders) && !('Content-Type' in finalHeaders)) {
      finalHeaders['content-type'] = 'application/json';
    }
  }

  let lastError: IntegrationError = { kind: 'unknown', message: 'no attempt was made' };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const res = await doFetch(target, {
        method,
        headers: finalHeaders,
        body: payload as never,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        lastError = {
          kind: kindForStatus(res.status),
          message: `${method} ${target} → ${res.status}`,
          status: res.status,
          ...(retryAfter !== undefined ? { retryAfterSec: retryAfter } : {}),
          detail: text.slice(0, 1000),
        };
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < retries) {
          await sleep(backoffMs(attempt, retryAfter));
          continue;
        }
        return { ok: false, error: lastError };
      }

      if (res.status === 204) return succeed(undefined as T);
      const text = await res.text();
      if (text.trim() === '') return succeed(undefined as T);
      try {
        return succeed(JSON.parse(text) as T);
      } catch (e) {
        return fail('parse', `response from ${target} was not valid JSON`, { detail: text.slice(0, 500) });
      }
    } catch (e) {
      const aborted = signal?.aborted === true;
      lastError = {
        kind: aborted ? 'aborted' : controller.signal.aborted ? 'timeout' : 'network',
        message: aborted
          ? `request to ${target} was aborted by the caller`
          : controller.signal.aborted
            ? `request to ${target} timed out after ${timeoutMs}ms`
            : `request to ${target} failed: ${errMessage(e)}`,
        detail: e,
      };
      if (lastError.kind === 'aborted') return { ok: false, error: lastError };
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: false, error: lastError };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  return { ok: false, error: lastError };
}

/** Fetch raw bytes (Telegram file downloads). Never throws. */
export async function requestBytes(
  url: string,
  opts: RequestOptions = {},
): Promise<IntegrationResult<Uint8Array>> {
  const { timeoutMs = 30_000, headers = {}, fetchImpl, signal } = opts;
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return fail('network', 'global fetch is unavailable; Node 20+ is required');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const res = await doFetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      return fail(kindForStatus(res.status), `GET ${url} → ${res.status}`, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return succeed(new Uint8Array(buf));
  } catch (e) {
    return fail('network', `download of ${url} failed: ${errMessage(e)}`, { detail: e });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** Exponential backoff with jitter, capped at 8s, honouring Retry-After. */
export function backoffMs(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec !== undefined) return Math.min(retryAfterSec * 1000, 30_000);
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base + Math.floor(Math.random() * 250);
}

/** Best-effort message extraction from an unknown thrown value. */
export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
