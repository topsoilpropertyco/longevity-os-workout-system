/**
 * The `llm_jobs` queue contract (CLAUDE.md invariant 3, RESEARCH §8).
 *
 * This is the ONLY thing the Vercel side and the Mac mini worker share, and it
 * is the reason the mini needs no tunnel and no inbound port:
 *
 *   Vercel  ──enqueue──▶  Supabase.llm_jobs  ◀──poll/claim/complete──  Mac mini
 *
 * Both sides only ever make OUTBOUND connections to Supabase. Nothing on the
 * internet can reach the mini.
 *
 * ── The unclaimed-job rule ───────────────────────────────────────────────────
 * A job sitting `queued` for more than `STALE_CLAIM_SECONDS` (60s, per CLAUDE.md
 * invariant 3) is assumed orphaned — the mini is asleep, offline, or died
 * mid-job — and a Vercel function picks it up with the Gemini free tier. Same
 * prompt, same output schema. `reclaimExpired` is what makes that safe.
 *
 * ── No Supabase SDK ──────────────────────────────────────────────────────────
 * This package takes an INJECTED minimal client (`JobStore`) instead of
 * depending on `@supabase/supabase-js`. That keeps the integrations package
 * pure, keeps the worker's install tiny, and makes every function here testable
 * against an in-memory fake. The adapter lives at the call site: about 30 lines
 * around `supabase.from('llm_jobs')`.
 */

import type { IntegrationResult } from '../http.js';
import { succeed, fail, errMessage } from '../http.js';

/** Table name, so both sides cannot drift. */
export const LLM_JOBS_TABLE = 'llm_jobs';

/** Seconds a claim stays valid before `reclaimExpired` may take it back. */
export const STALE_CLAIM_SECONDS = 60;

/** What the job asks the model to do. Each maps to a prompt in `prompts.ts`. */
export const LLM_JOB_KINDS = [
  /** Engine output → the one-line "why". */
  'why_line',
  /** A Telegram message the rules router could not resolve. */
  'chat',
  /** A whiteboard or scale photo → strict JSON. */
  'vision_parse',
  /** The Sunday narrative. */
  'weekly_narrative',
  /** Post-session summary copy. */
  'session_summary',
] as const;
export type LlmJobKind = (typeof LLM_JOB_KINDS)[number];

export const LLM_JOB_STATUSES = ['queued', 'claimed', 'done', 'failed', 'cancelled'] as const;
export type LlmJobStatus = (typeof LLM_JOB_STATUSES)[number];

/** One row of `llm_jobs`. Column names are snake_case to match Postgres. */
export interface LlmJob {
  id: string;
  user_id: string;
  kind: LlmJobKind;
  status: LlmJobStatus;
  /** Prompt inputs. Never a rendered prompt — the worker renders it. */
  payload: Record<string, unknown>;
  /** Model output, once complete. */
  result?: Record<string, unknown> | null;
  error?: string | null;
  /** Higher runs first. Chat is interactive (10); narratives can wait (0). */
  priority: number;
  attempts: number;
  max_attempts: number;
  /** Worker that holds the claim: the mini's hostname, or `vercel-gemini`. */
  claimed_by?: string | null;
  claimed_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  completed_at?: string | null;
  /** Which provider actually answered. Useful for the fallback-rate metric. */
  provider?: string | null;
  /** Milliseconds the model took. */
  latency_ms?: number | null;
}

/** Fields an enqueue supplies; everything else is defaulted. */
export interface EnqueueInput {
  user_id: string;
  kind: LlmJobKind;
  payload: Record<string, unknown>;
  priority?: number;
  max_attempts?: number;
  /**
   * Caller-chosen id. Reusing one makes the enqueue idempotent, which is how a
   * re-plan on every open (invariant 4) does not enqueue five "why" jobs.
   */
  id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The injected store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The minimal Supabase-shaped surface this module needs. Implement it over
 * `@supabase/supabase-js` at the call site, or over a Map in tests.
 *
 * `rpc` is optional but strongly preferred for `claim`: see the note there.
 */
export interface JobStore {
  /** INSERT, returning the inserted row. */
  insert(table: string, row: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  /**
   * UPDATE … SET `patch` WHERE every entry of `match` holds, returning the
   * updated rows. `match` values are equality tests; `undefined` means IS NULL.
   */
  update(
    table: string,
    match: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]>;
  /** SELECT with equality filters, ordering and a limit. */
  select(
    table: string,
    query: {
      match?: Record<string, unknown>;
      /** `column < value` filters, used for the staleness cutoff. */
      lt?: Record<string, unknown>;
      order?: { column: string; ascending?: boolean }[];
      limit?: number;
    },
  ): Promise<Record<string, unknown>[]>;
  /**
   * Call a Postgres function. Supply this and define `claim_llm_job` in a
   * migration for a genuinely atomic claim.
   */
  rpc?(fn: string, args: Record<string, unknown>): Promise<unknown>;
}

/** The Postgres function name `claim` prefers when `rpc` is available. */
export const CLAIM_RPC = 'claim_llm_job';

/**
 * Reference SQL for the atomic claim. Put this in a migration. The
 * `FOR UPDATE SKIP LOCKED` is what makes two workers safe; the JS fallback in
 * `claim()` is only correct because there is a single mini.
 */
export const CLAIM_RPC_SQL = `
-- supabase/migrations/*_claim_llm_job.sql
create or replace function claim_llm_job(p_worker text, p_kinds text[] default null)
returns setof llm_jobs
language plpgsql
as $$
begin
  return query
  update llm_jobs j
     set status     = 'claimed',
         claimed_by = p_worker,
         claimed_at = now(),
         attempts   = j.attempts + 1,
         updated_at = now()
   where j.id = (
     select id from llm_jobs
      where status = 'queued'
        and (p_kinds is null or kind = any(p_kinds))
      order by priority desc, created_at asc
      limit 1
      for update skip locked
   )
  returning j.*;
end;
$$;
`;

// ─────────────────────────────────────────────────────────────────────────────
// Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a job to the queue. Returns the row so the caller can poll for it, or
 * ignore it entirely — the today card must never await an LLM job.
 */
export async function enqueue(
  store: JobStore,
  input: EnqueueInput,
  now: () => string = isoNow,
): Promise<IntegrationResult<LlmJob>> {
  try {
    const row = await store.insert(LLM_JOBS_TABLE, {
      ...(input.id ? { id: input.id } : {}),
      user_id: input.user_id,
      kind: input.kind,
      status: 'queued' satisfies LlmJobStatus,
      payload: input.payload,
      priority: input.priority ?? defaultPriority(input.kind),
      attempts: 0,
      max_attempts: input.max_attempts ?? 3,
      created_at: now(),
      updated_at: now(),
    });
    if (!row) return fail('unknown', 'llm_jobs insert returned no row');
    return succeed(asJob(row));
  } catch (e) {
    return fail('unknown', `failed to enqueue ${input.kind}: ${errMessage(e)}`, { detail: e });
  }
}

/**
 * Atomically take the next job for this worker.
 *
 * Prefers the `claim_llm_job` RPC (`FOR UPDATE SKIP LOCKED`), which is the only
 * genuinely atomic option. Without an `rpc` implementation it falls back to a
 * conditional UPDATE guarded on `status = 'queued'` — safe here because Postgres
 * evaluates the predicate under a row lock, so two claimants cannot both match.
 *
 * Returns `{ ok: true, value: null }` when the queue is empty. That is the
 * normal case every 15 seconds, not an error.
 */
export async function claim(
  store: JobStore,
  workerId: string,
  opts: { kinds?: LlmJobKind[]; now?: () => string } = {},
): Promise<IntegrationResult<LlmJob | null>> {
  const now = opts.now ?? isoNow;
  try {
    if (store.rpc) {
      const out = await store.rpc(CLAIM_RPC, {
        p_worker: workerId,
        p_kinds: opts.kinds ?? null,
      });
      const rows = Array.isArray(out) ? out : out ? [out] : [];
      const first = rows[0];
      return succeed(first ? asJob(first as Record<string, unknown>) : null);
    }

    // Fallback: find a candidate, then claim it conditionally. If another
    // worker won the race the UPDATE matches zero rows and we return null;
    // the next poll picks up whatever is left.
    const candidates = await store.select(LLM_JOBS_TABLE, {
      match: { status: 'queued' },
      order: [
        { column: 'priority', ascending: false },
        { column: 'created_at', ascending: true },
      ],
      limit: 5,
    });
    for (const candidate of candidates) {
      const job = asJob(candidate);
      if (opts.kinds && !opts.kinds.includes(job.kind)) continue;
      const updated = await store.update(
        LLM_JOBS_TABLE,
        { id: job.id, status: 'queued' },
        {
          status: 'claimed' satisfies LlmJobStatus,
          claimed_by: workerId,
          claimed_at: now(),
          attempts: job.attempts + 1,
          updated_at: now(),
        },
      );
      const row = updated[0];
      if (row) return succeed(asJob(row));
    }
    return succeed(null);
  } catch (e) {
    return fail('unknown', `failed to claim a job for ${workerId}: ${errMessage(e)}`, { detail: e });
  }
}

/**
 * Mark a job done and store the result. Guarded on `claimed_by` so a worker
 * that lost its claim to `reclaimExpired` cannot overwrite the fallback's
 * answer with a stale one.
 */
export async function complete(
  store: JobStore,
  jobId: string,
  workerId: string,
  result: Record<string, unknown>,
  meta: { provider?: string; latencyMs?: number; now?: () => string } = {},
): Promise<IntegrationResult<LlmJob | null>> {
  const now = meta.now ?? isoNow;
  try {
    const rows = await store.update(
      LLM_JOBS_TABLE,
      { id: jobId, claimed_by: workerId },
      {
        status: 'done' satisfies LlmJobStatus,
        result,
        error: null,
        completed_at: now(),
        updated_at: now(),
        ...(meta.provider ? { provider: meta.provider } : {}),
        ...(meta.latencyMs !== undefined ? { latency_ms: Math.round(meta.latencyMs) } : {}),
      },
    );
    const row = rows[0];
    return succeed(row ? asJob(row) : null);
  } catch (e) {
    return fail('unknown', `failed to complete job ${jobId}: ${errMessage(e)}`, { detail: e });
  }
}

/**
 * Record a failure. Re-queues the job while attempts remain, so a transient LM
 * Studio hiccup retries; past `max_attempts` it is parked as `failed` and the
 * caller falls back to `fallback-copy.ts` (invariant 2 — the card never blocks).
 */
export async function failJob(
  store: JobStore,
  jobId: string,
  workerId: string,
  error: string,
  opts: { requeue?: boolean; now?: () => string } = {},
): Promise<IntegrationResult<LlmJob | null>> {
  const now = opts.now ?? isoNow;
  try {
    const existing = await store.select(LLM_JOBS_TABLE, { match: { id: jobId }, limit: 1 });
    const current = existing[0] ? asJob(existing[0]) : null;
    const attempts = current?.attempts ?? 1;
    const maxAttempts = current?.max_attempts ?? 3;
    const shouldRequeue = (opts.requeue ?? true) && attempts < maxAttempts;

    const rows = await store.update(
      LLM_JOBS_TABLE,
      { id: jobId, claimed_by: workerId },
      shouldRequeue
        ? {
            status: 'queued' satisfies LlmJobStatus,
            claimed_by: null,
            claimed_at: null,
            error: error.slice(0, 2000),
            updated_at: now(),
          }
        : {
            status: 'failed' satisfies LlmJobStatus,
            error: error.slice(0, 2000),
            completed_at: now(),
            updated_at: now(),
          },
    );
    const row = rows[0];
    return succeed(row ? asJob(row) : null);
  } catch (e) {
    return fail('unknown', `failed to record failure for job ${jobId}: ${errMessage(e)}`, { detail: e });
  }
}

/** Alias, because `fail` is taken by the http helper. */
export { failJob as fail };

/**
 * Return jobs whose claim went stale back to `queued`.
 *
 * This is CLAUDE.md invariant 3 in code: a job claimed more than
 * `STALE_CLAIM_SECONDS` ago belongs to a mini that went to sleep mid-job, and
 * Vercel's Gemini fallback must be allowed to take it. Run it from the Vercel
 * fallback route (or pg_cron) — never only from the mini, which is exactly the
 * component that might be down.
 *
 * Jobs already at `max_attempts` are parked as `failed` instead of looping.
 */
export async function reclaimExpired(
  store: JobStore,
  opts: { staleSeconds?: number; now?: () => Date } = {},
): Promise<IntegrationResult<{ reclaimed: number; parked: number }>> {
  const staleSeconds = opts.staleSeconds ?? STALE_CLAIM_SECONDS;
  const nowDate = (opts.now ?? (() => new Date()))();
  const cutoff = new Date(nowDate.getTime() - staleSeconds * 1000).toISOString();
  const nowIso = nowDate.toISOString();

  try {
    const stale = await store.select(LLM_JOBS_TABLE, {
      match: { status: 'claimed' },
      lt: { claimed_at: cutoff },
      limit: 100,
    });

    let reclaimed = 0;
    let parked = 0;
    for (const raw of stale) {
      const job = asJob(raw);
      const exhausted = job.attempts >= job.max_attempts;
      const rows = await store.update(
        LLM_JOBS_TABLE,
        { id: job.id, status: 'claimed' },
        exhausted
          ? {
              status: 'failed' satisfies LlmJobStatus,
              error: `claim by ${job.claimed_by ?? 'unknown'} expired after ${job.attempts} attempts`,
              completed_at: nowIso,
              updated_at: nowIso,
            }
          : {
              status: 'queued' satisfies LlmJobStatus,
              claimed_by: null,
              claimed_at: null,
              error: `claim by ${job.claimed_by ?? 'unknown'} expired after ${staleSeconds}s`,
              updated_at: nowIso,
            },
      );
      if (rows.length > 0) {
        if (exhausted) parked += 1;
        else reclaimed += 1;
      }
    }
    return succeed({ reclaimed, parked });
  } catch (e) {
    return fail('unknown', `reclaimExpired failed: ${errMessage(e)}`, { detail: e });
  }
}

/** Fetch one job by id, e.g. to poll for a result from the web app. */
export async function getJob(
  store: JobStore,
  jobId: string,
): Promise<IntegrationResult<LlmJob | null>> {
  try {
    const rows = await store.select(LLM_JOBS_TABLE, { match: { id: jobId }, limit: 1 });
    const row = rows[0];
    return succeed(row ? asJob(row) : null);
  } catch (e) {
    return fail('unknown', `failed to read job ${jobId}: ${errMessage(e)}`, { detail: e });
  }
}

/**
 * Jobs that have been queued longer than `STALE_CLAIM_SECONDS` and nobody has
 * claimed. This is the Vercel Gemini fallback's work list.
 */
export async function findUnclaimed(
  store: JobStore,
  opts: { olderThanSeconds?: number; limit?: number; now?: () => Date } = {},
): Promise<IntegrationResult<LlmJob[]>> {
  const seconds = opts.olderThanSeconds ?? STALE_CLAIM_SECONDS;
  const nowDate = (opts.now ?? (() => new Date()))();
  const cutoff = new Date(nowDate.getTime() - seconds * 1000).toISOString();
  try {
    const rows = await store.select(LLM_JOBS_TABLE, {
      match: { status: 'queued' },
      lt: { created_at: cutoff },
      order: [
        { column: 'priority', ascending: false },
        { column: 'created_at', ascending: true },
      ],
      limit: opts.limit ?? 10,
    });
    return succeed(rows.map(asJob));
  } catch (e) {
    return fail('unknown', `findUnclaimed failed: ${errMessage(e)}`, { detail: e });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Interactive work first; background prose last. */
export function defaultPriority(kind: LlmJobKind): number {
  switch (kind) {
    case 'chat':
      return 10;
    case 'vision_parse':
      return 8;
    case 'why_line':
      return 5;
    case 'session_summary':
      return 3;
    case 'weekly_narrative':
      return 0;
    default:
      return 1;
  }
}

/** Coerce a raw row into an `LlmJob`, filling the defaults Postgres applies. */
export function asJob(row: Record<string, unknown>): LlmJob {
  return {
    id: String(row['id'] ?? ''),
    user_id: String(row['user_id'] ?? ''),
    kind: (row['kind'] as LlmJobKind) ?? 'chat',
    status: (row['status'] as LlmJobStatus) ?? 'queued',
    payload: (row['payload'] as Record<string, unknown>) ?? {},
    result: (row['result'] as Record<string, unknown> | null) ?? null,
    error: (row['error'] as string | null) ?? null,
    priority: Number(row['priority'] ?? 0),
    attempts: Number(row['attempts'] ?? 0),
    max_attempts: Number(row['max_attempts'] ?? 3),
    claimed_by: (row['claimed_by'] as string | null) ?? null,
    claimed_at: (row['claimed_at'] as string | null) ?? null,
    created_at: String(row['created_at'] ?? ''),
    updated_at: (row['updated_at'] as string | null) ?? null,
    completed_at: (row['completed_at'] as string | null) ?? null,
    provider: (row['provider'] as string | null) ?? null,
    latency_ms: (row['latency_ms'] as number | null) ?? null,
  };
}

/** Current time as an ISO instant. Injectable everywhere for tests. */
export function isoNow(): string {
  return new Date().toISOString();
}
