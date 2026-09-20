/**
 * Strava webhook subscriptions and event parsing (RESEARCH_FOUNDATION §4).
 *
 * ── THE 2-SECOND RULE ────────────────────────────────────────────────────────
 * Strava requires the callback to answer **HTTP 200 within 2 seconds**. It does
 * not care what the body says. Slower than that and Strava marks the delivery
 * failed, retries, and eventually disables the subscription.
 *
 * So the handler NEVER does work inline. The shape is always:
 *
 *   1. `parseWebhookEvent(body)` — pure, microseconds.
 *   2. Write the event to a queue table (`llm_jobs` / a strava inbox row).
 *   3. `return new Response('ok', { status: 200 })`.
 *   4. Fetch the activity, pull the streams, compute zones — LATER, from the
 *      queue drain, the nightly reconcile, or the Mac mini worker.
 *
 * Fetching `activities/{id}` inside the handler is the mistake to avoid: a cold
 * Vercel function plus a Strava round trip routinely exceeds 2s.
 *
 * The nightly reconcile (PRD §8.7) exists precisely because webhooks get
 * dropped. Webhooks are an optimisation; the reconcile is the source of truth.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type IntegrationResult, requestJson, succeed, fail } from '../http.js';

export const STRAVA_SUBSCRIPTION_URL = 'https://www.strava.com/api/v3/push_subscriptions';

export interface WebhookCredentials {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export interface StravaSubscription {
  id: number;
  callback_url?: string;
  created_at?: string;
  updated_at?: string;
  application_id?: number;
  resource_state?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription management (run once, by hand or by a setup script)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the push subscription.
 *
 * Strava immediately GETs `callbackUrl` with `hub.challenge` and will not
 * create the subscription unless that handshake succeeds — so deploy the
 * callback route BEFORE calling this. `verifyToken` is a secret you choose; it
 * comes back in the handshake and `handleSubscriptionChallenge` checks it.
 *
 * Strava allows exactly ONE subscription per application. Calling this twice
 * returns 400; call `viewSubscription` first, or `deleteSubscription`.
 */
export async function createSubscription(
  creds: WebhookCredentials,
  callbackUrl: string,
  verifyToken: string,
): Promise<IntegrationResult<StravaSubscription>> {
  const res = await requestJson<StravaSubscription>(STRAVA_SUBSCRIPTION_URL, {
    method: 'POST',
    body: {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      callback_url: callbackUrl,
      verify_token: verifyToken,
    },
    retries: 0,
    ...(creds.fetchImpl ? { fetchImpl: creds.fetchImpl } : {}),
  });
  if (!res.ok) return res;
  if (typeof res.value?.id !== 'number') {
    return fail('schema', 'Strava subscription response had no numeric id', { detail: res.value });
  }
  return succeed(res.value);
}

/** List the application's subscriptions (there is at most one). */
export async function viewSubscription(
  creds: WebhookCredentials,
): Promise<IntegrationResult<StravaSubscription[]>> {
  const res = await requestJson<StravaSubscription[]>(STRAVA_SUBSCRIPTION_URL, {
    query: { client_id: creds.clientId, client_secret: creds.clientSecret },
    retries: 1,
    ...(creds.fetchImpl ? { fetchImpl: creds.fetchImpl } : {}),
  });
  if (!res.ok) return res;
  return succeed(Array.isArray(res.value) ? res.value : []);
}

/** Delete a subscription by id. Needed before the callback URL changes. */
export async function deleteSubscription(
  creds: WebhookCredentials,
  subscriptionId: number,
): Promise<IntegrationResult<true>> {
  const res = await requestJson<unknown>(`${STRAVA_SUBSCRIPTION_URL}/${subscriptionId}`, {
    method: 'DELETE',
    query: { client_id: creds.clientId, client_secret: creds.clientSecret },
    retries: 0,
    ...(creds.fetchImpl ? { fetchImpl: creds.fetchImpl } : {}),
  });
  if (!res.ok) return res;
  return succeed(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET handshake
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionChallenge {
  'hub.mode'?: string;
  'hub.challenge'?: string;
  'hub.verify_token'?: string;
}

/**
 * Answer Strava's validation GET.
 *
 * Strava calls `GET /api/strava/webhook?hub.mode=subscribe&hub.challenge=…&
 * hub.verify_token=…` and expects exactly `{"hub.challenge":"<value>"}` with
 * status 200 and `content-type: application/json`. Anything else — including a
 * 200 with a different body — fails the subscription.
 *
 * Returns `null` when the verify token does not match, which the route should
 * answer with a 403. Pass a `URLSearchParams` or a plain query object.
 */
export function handleSubscriptionChallenge(
  query: URLSearchParams | Record<string, string | string[] | undefined>,
  expectedVerifyToken: string,
): { 'hub.challenge': string } | null {
  const get = (k: string): string | undefined => {
    if (query instanceof URLSearchParams) return query.get(k) ?? undefined;
    const v = query[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const mode = get('hub.mode');
  const challenge = get('hub.challenge');
  const token = get('hub.verify_token');
  if (mode !== 'subscribe') return null;
  if (!challenge) return null;
  if (!expectedVerifyToken || token !== expectedVerifyToken) return null;
  return { 'hub.challenge': challenge };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event parsing
// ─────────────────────────────────────────────────────────────────────────────

export type StravaAspectType = 'create' | 'update' | 'delete';
export type StravaObjectType = 'activity' | 'athlete';

/** A validated `POST` body from Strava. */
export interface StravaWebhookEvent {
  object_type: StravaObjectType;
  /** Activity id, or athlete id for athlete events. */
  object_id: number;
  aspect_type: StravaAspectType;
  /** For updates: the changed fields, e.g. `{ title, type, private }`. */
  updates: Record<string, string>;
  owner_id: number;
  subscription_id: number;
  /** Unix seconds when the event happened. */
  event_time: number;
}

/** What the route should do with this event, decided without any I/O. */
export type StravaWebhookAction =
  /** Fetch the activity + streams, normalize, upsert, rescore compliance. */
  | { kind: 'ingest_activity'; activityId: string; reason: 'create' | 'update' }
  /** Remove the cardio log and recompute the week. */
  | { kind: 'delete_activity'; activityId: string }
  /** Strava says the athlete deauthorized us. Clear tokens, fall back to manual. */
  | { kind: 'deauthorize'; athleteId: string }
  /** Nothing to do (a title-only edit, an unknown object type). */
  | { kind: 'ignore'; reason: string };

/**
 * Parse and validate a webhook POST body. Pure and fast — safe to run before
 * the 200 goes out. Returns `null` for anything that is not a Strava event, so
 * the route can still answer 200 (never make Strava retry a malformed body).
 */
export function parseWebhookEvent(body: unknown): StravaWebhookEvent | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const objectType = b['object_type'];
  const aspectType = b['aspect_type'];
  const objectId = Number(b['object_id']);
  const ownerId = Number(b['owner_id']);
  if (objectType !== 'activity' && objectType !== 'athlete') return null;
  if (aspectType !== 'create' && aspectType !== 'update' && aspectType !== 'delete') return null;
  if (!Number.isFinite(objectId)) return null;

  const rawUpdates = b['updates'];
  const updates: Record<string, string> = {};
  if (rawUpdates && typeof rawUpdates === 'object') {
    for (const [k, v] of Object.entries(rawUpdates as Record<string, unknown>)) {
      updates[k] = String(v);
    }
  }

  return {
    object_type: objectType,
    object_id: objectId,
    aspect_type: aspectType,
    updates,
    owner_id: Number.isFinite(ownerId) ? ownerId : 0,
    subscription_id: Number(b['subscription_id']) || 0,
    event_time: Number(b['event_time']) || Math.floor(Date.now() / 1000),
  };
}

/**
 * Decide what the queued job should be. Still pure: call this, enqueue the
 * result, return 200, and let the worker do the network calls.
 *
 * `updates.authorized === 'false'` on an athlete event is Strava's
 * deauthorization signal — the tokens are dead and the app must fall back to
 * manual cardio entry rather than retrying forever.
 */
export function webhookAction(event: StravaWebhookEvent): StravaWebhookAction {
  if (event.object_type === 'athlete') {
    if (event.updates['authorized'] === 'false') {
      return { kind: 'deauthorize', athleteId: String(event.object_id) };
    }
    return { kind: 'ignore', reason: 'athlete event with no authorization change' };
  }

  const activityId = String(event.object_id);
  switch (event.aspect_type) {
    case 'create':
      return { kind: 'ingest_activity', activityId, reason: 'create' };
    case 'delete':
      return { kind: 'delete_activity', activityId };
    case 'update': {
      // A title change does not alter a single zone minute. Only re-ingest when
      // something that affects the log changed — or when we cannot tell.
      const keys = Object.keys(event.updates);
      const meaningful = keys.filter((k) => k !== 'title');
      if (keys.length > 0 && meaningful.length === 0) {
        return { kind: 'ignore', reason: 'title-only edit' };
      }
      return { kind: 'ingest_activity', activityId, reason: 'update' };
    }
    default:
      return { kind: 'ignore', reason: 'unknown aspect_type' };
  }
}

/**
 * The whole synchronous half of the route, in one call.
 *
 * ```ts
 * // app/api/strava/webhook/route.ts
 * export async function GET(req: Request) {
 *   const ok = handleSubscriptionChallenge(new URL(req.url).searchParams, process.env.STRAVA_VERIFY_TOKEN!);
 *   return ok ? Response.json(ok) : new Response('forbidden', { status: 403 });
 * }
 * export async function POST(req: Request) {
 *   const action = acknowledgeAndPlan(await req.json().catch(() => null));
 *   if (action.kind !== 'ignore') await enqueueStravaJob(action);   // one INSERT
 *   return new Response('ok', { status: 200 });                     // well inside 2s
 * }
 * ```
 */
export function acknowledgeAndPlan(body: unknown): StravaWebhookAction {
  const event = parseWebhookEvent(body);
  if (!event) return { kind: 'ignore', reason: 'unparseable webhook body' };
  return webhookAction(event);
}
