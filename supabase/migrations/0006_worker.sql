-- ═════════════════════════════════════════════════════════════════════════════
-- 0006_worker.sql — Longevity OS · the Mac mini worker's two objects
-- ═════════════════════════════════════════════════════════════════════════════
-- The worker in `worker/` and the queue contract in
-- `packages/integrations/src/llm/jobs.ts` need exactly two things that 0001–0005
-- do not provide:
--
--   1. claim_llm_job()   — an ATOMIC claim. The JS fallback in `jobs.ts` does a
--                          read-then-write, which is only safe because there is
--                          one mini. This function is safe regardless, and is
--                          what `claim()` prefers when an RPC is available.
--
--   2. worker_heartbeat  — a row the worker upserts every 6 hours. Two jobs at
--                          once: it tells the operator whether the mini is
--                          alive, and it is a WRITE, which is what keeps a free
--                          Supabase project from pausing after ~7 idle days
--                          (RESEARCH §8 — read traffic does not reliably count).
--
-- Safe to run more than once. Nothing here costs money.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. worker_heartbeat ─────────────────────────────────────────────────────

create table if not exists public.worker_heartbeat (
  -- Matches WORKER_ID in the mini's launchd plist, e.g. 'mac-mini-1'.
  worker_id   text primary key,
  last_seen   timestamptz not null default now(),
  -- Optional, for the operations view: version, host, model ids in use.
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.worker_heartbeat is
  'Liveness beacon for the Mac mini LLM worker, and the write that keeps a free Supabase project from pausing.';
comment on column public.worker_heartbeat.last_seen is
  'Upserted by the worker roughly every 6 hours. Stale by more than a day means the mini is down and every LLM job is falling through to Gemini.';

create index if not exists worker_heartbeat_last_seen_idx
  on public.worker_heartbeat (last_seen desc);

alter table public.worker_heartbeat enable row level security;

-- No user owns a heartbeat row: it belongs to the infrastructure, and the
-- worker writes it with the service key, which bypasses RLS entirely. The
-- browser gets read-only visibility so the settings screen can show
-- "mini: last seen 3 minutes ago" without exposing anything sensitive.
drop policy if exists worker_heartbeat_select on public.worker_heartbeat;
create policy worker_heartbeat_select
  on public.worker_heartbeat for select
  to authenticated
  using (true);

-- Deliberately NO insert/update/delete policy for authenticated or anon. The
-- only writer is the service key.
revoke all on public.worker_heartbeat from anon;

-- ─── 2. claim_llm_job ────────────────────────────────────────────────────────

-- `for update skip locked` is the whole point: two claimers can run at the same
-- instant and each will take a different row, or none, but never the same one.
-- That matters the moment the Vercel Gemini fallback starts racing the mini for
-- a job whose 60-second deadline has just passed.
create or replace function public.claim_llm_job(
  p_worker text,
  p_kinds  text[] default null
)
returns setof public.llm_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.llm_jobs j
     set status     = 'claimed',
         claimed_by = p_worker,
         claimed_at = now(),
         attempts   = j.attempts + 1,
         updated_at = now()
   where j.id = (
     select c.id
       from public.llm_jobs c
      where c.status = 'queued'
        and c.attempts < c.max_attempts
        and (p_kinds is null or c.kind = any (p_kinds))
      order by c.priority desc, c.created_at asc
      limit 1
      for update skip locked
   )
  returning j.*;
end;
$$;

comment on function public.claim_llm_job(text, text[]) is
  'Atomically claim the highest-priority queued LLM job. Service-key only: a browser must never be able to claim work.';

-- security definer runs as the owner, so the default grant to PUBLIC would let
-- any logged-in browser session claim jobs. Take it back.
revoke all on function public.claim_llm_job(text, text[]) from public;
revoke all on function public.claim_llm_job(text, text[]) from anon;
revoke all on function public.claim_llm_job(text, text[]) from authenticated;
grant execute on function public.claim_llm_job(text, text[]) to service_role;

-- ─── 3. reclaim_expired_llm_jobs ─────────────────────────────────────────────

-- A job claimed by a worker that then died would sit in 'claimed' forever.
-- Anything claimed longer ago than the grace period goes back on the queue,
-- unless it has already burned through its attempts.
create or replace function public.reclaim_expired_llm_jobs(
  p_grace interval default interval '5 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with reclaimed as (
    update public.llm_jobs
       -- The cast is required: a CASE over string literals is `text`, and
       -- Postgres will not implicitly coerce that into the enum column.
       set status     = (case when attempts >= max_attempts then 'failed' else 'queued' end)::public.llm_job_status,
           claimed_by = null,
           claimed_at = null,
           error      = case when attempts >= max_attempts
                             then coalesce(error, 'exhausted attempts after worker timeout')
                             else error end,
           updated_at = now()
     where status = 'claimed'
       and claimed_at < now() - p_grace
    returning 1
  )
  select count(*) into n from reclaimed;
  return n;
end;
$$;

comment on function public.reclaim_expired_llm_jobs(interval) is
  'Return jobs abandoned by a dead worker to the queue, or fail them once attempts are exhausted.';

revoke all on function public.reclaim_expired_llm_jobs(interval) from public;
revoke all on function public.reclaim_expired_llm_jobs(interval) from anon;
revoke all on function public.reclaim_expired_llm_jobs(interval) from authenticated;
grant execute on function public.reclaim_expired_llm_jobs(interval) to service_role;

-- ─── 4. schedule the reclaim, if pg_cron is here ─────────────────────────────

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('longevity-reclaim-llm-jobs')
      where exists (select 1 from cron.job where jobname = 'longevity-reclaim-llm-jobs');
    perform cron.schedule(
      'longevity-reclaim-llm-jobs',
      '*/10 * * * *',
      $cron$ select public.reclaim_expired_llm_jobs(); $cron$
    );
    raise notice '0006: scheduled longevity-reclaim-llm-jobs every 10 minutes';
  else
    raise notice '0006: pg_cron not installed — reclaim must be called by the worker or a Vercel cron route';
  end if;
exception when others then
  raise notice '0006: could not schedule reclaim (%), continuing', sqlerrm;
end;
$$;

-- ─── 5. the RLS guard from 0002 must still hold ──────────────────────────────

do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ')
    into missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;
  if missing is not null then
    raise exception '0006: tables without RLS: %', missing;
  end if;
end;
$$;
