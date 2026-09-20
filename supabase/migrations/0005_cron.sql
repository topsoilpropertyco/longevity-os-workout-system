-- ═════════════════════════════════════════════════════════════════════════════
-- 0005_cron.sql — Longevity OS · scheduled jobs
-- ═════════════════════════════════════════════════════════════════════════════
-- Four jobs, all free:
--
--   1. oura_nightly_sync        10:05 UTC  — pull yesterday's Oura documents
--   2. strava_nightly_reconcile 10:20 UTC  — catch activities the webhook missed
--   3. weekly_rollup            Mon 09:00 UTC — snapshot last week's dose
--   4. keepalive                every 6 h  — write a row so the project stays awake
--
-- ⚠️ WHY THE KEEP-ALIVE EXISTS (RESEARCH §8): Supabase free projects PAUSE
-- after ~7 days of inactivity, and a paused project means the today card does
-- not load. Daily use normally prevents it; the keep-alive is insurance for the
-- week Seth is on holiday. It is a real write, because a read may not count.
-- The Mac mini worker also pings Supabase on its poll loop — belt and braces.
--
-- ⚠️ VERCEL HOBBY CRON IS LIMITED (≈2 jobs, once per day, imprecise timing), so
-- the schedule lives here rather than in vercel.json. Nothing in this file
-- costs money: pg_cron is on the Supabase free tier.
--
-- ─── HOW A DATABASE JOB REACHES THE APP ──────────────────────────────────────
-- The sync jobs do not talk to Oura or Strava themselves. They POST to the
-- app's own route, which holds the (encrypted) tokens and does the work. That
-- needs two settings, configured ONCE per project and never committed:
--
--   alter database postgres set app.base_url   = 'https://<project>.vercel.app';
--   alter database postgres set app.cron_secret = '<same value as CRON_SECRET>';
--
-- If either setting is missing, or the pg_net extension is not enabled, the job
-- records a skip in public.cron_runs and does nothing else. It never errors —
-- a red cron job is noise Seth would have to think about.
--
-- ─── SAFE TO RUN WITHOUT pg_cron ─────────────────────────────────────────────
-- Every scheduling statement is wrapped in a DO block that swallows its own
-- exception and raises a NOTICE. A local `supabase db reset` on a stack without
-- pg_cron, or a plain psql run, applies the functions and skips the schedule.
-- Re-running the file re-points existing jobs rather than duplicating them.
-- ═════════════════════════════════════════════════════════════════════════════

-- Even `create extension if not exists` HARD ERRORS when the control file is
-- absent (a plain Postgres, most CI images), so it too is guarded.
do $ext$
begin
  create extension if not exists pg_cron;
  raise notice 'pg_cron is available.';
exception when others then
  raise notice 'pg_cron not available here (%) — functions are still created; the schedule block below skips itself.', sqlerrm;
end $ext$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. cron_runs — the job log, and the thing the keep-alive writes to
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cron_runs (
  id       bigint generated always as identity primary key,
  job_name text not null,
  ran_at   timestamptz not null default now(),
  -- 'ok' | 'skipped' | 'error'
  status   text not null default 'ok' check (status in ('ok', 'skipped', 'error')),
  -- For weekly_rollup this holds the snapshot the Sunday bot report reads.
  detail   jsonb not null default '{}'::jsonb,
  user_id  uuid references public.users(id) on delete cascade
);

create index if not exists cron_runs_job_idx on public.cron_runs (job_name, ran_at desc);

-- RLS on, and DELIBERATELY NO POLICIES: this table is infrastructure. Only the
-- service key (BYPASSRLS) reads or writes it. The browser has no business here.
alter table public.cron_runs enable row level security;

comment on table public.cron_runs is
  'Scheduled-job log. RLS enabled with no policies: service_role only. The keep-alive job writes here to keep the free project from pausing.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Job bodies
-- ─────────────────────────────────────────────────────────────────────────────

-- Shared helper: POST to one of the app's cron routes, if that is possible.
-- Returns true when the request was queued, false when the job should be
-- considered skipped. Never raises.
create or replace function public.cron_post(p_path text, p_body jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_base   text := current_setting('app.base_url', true);
  v_secret text := current_setting('app.cron_secret', true);
begin
  if v_base is null or v_base = '' then
    return false;   -- project not configured yet
  end if;

  -- pg_net is a Supabase extension; on a bare Postgres the schema is absent.
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    return false;
  end if;

  execute format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 5000)',
    rtrim(v_base, '/') || p_path,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(v_secret, '')
    )::text,
    p_body::text
  );
  return true;
exception when others then
  raise notice 'cron_post(%) failed: %', p_path, sqlerrm;
  return false;
end;
$$;

-- ── Job 1 · nightly Oura sync trigger ────────────────────────────────────────
-- Asks the app to pull yesterday and today from the Oura API. Two days, not
-- one, because Oura back-fills a night's documents for hours after waking.
create or replace function public.cron_oura_sync()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_sent boolean;
begin
  v_sent := public.cron_post('/api/oura/sync', jsonb_build_object(
    'start_date', (current_date - 1)::text,
    'end_date',   current_date::text,
    'trigger',    'pg_cron'
  ));

  insert into public.cron_runs (job_name, status, detail)
  values ('oura_nightly_sync',
          case when v_sent then 'ok' else 'skipped' end,
          jsonb_build_object('start_date', (current_date - 1)::text,
                             'reason', case when v_sent then null
                                       else 'app.base_url or pg_net unavailable — Vercel cron covers this' end));
end;
$$;

-- ── Job 2 · nightly Strava reconcile ─────────────────────────────────────────
-- The webhook is the primary path; this catches anything it dropped. Sends the
-- ids we already hold for the window so the route only fetches what is new,
-- which keeps us far inside Strava's 200 req / 15 min limit.
create or replace function public.cron_strava_reconcile()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_sent  boolean;
  v_known jsonb;
begin
  select coalesce(jsonb_agg(distinct strava_activity_id), '[]'::jsonb)
    into v_known
  from public.strava_activities
  where local_date >= current_date - 7;

  v_sent := public.cron_post('/api/strava/reconcile', jsonb_build_object(
    'since',      (current_date - 7)::text,
    'known_ids',  v_known,
    'trigger',    'pg_cron'
  ));

  insert into public.cron_runs (job_name, status, detail)
  values ('strava_nightly_reconcile',
          case when v_sent then 'ok' else 'skipped' end,
          jsonb_build_object('since', (current_date - 7)::text,
                             'known_count', jsonb_array_length(v_known)));
end;
$$;

-- ── Job 3 · weekly rollup ────────────────────────────────────────────────────
-- Snapshots the last 7 days per athlete against the RESEARCH §6.1 dose targets.
-- The Sunday Telegram report and the dashboard's weekly card read the newest
-- row rather than recomputing. This is a CACHE, not truth — the engine still
-- recomputes everything on open (CLAUDE.md invariant 4).
create or replace function public.cron_weekly_rollup()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_from date := current_date - 7;
  r record;
begin
  for r in
    select
      u.id as user_id,
      (select count(*) from public.sessions s
        where s.user_id = u.id and s.date >= v_from and s.completed)            as sessions,
      (select coalesce(sum(st.reps * st.load_lb), 0) from public.sets st
         join public.session_exercises se on se.id = st.session_exercise_id
         join public.sessions s on s.id = se.session_id
        where st.user_id = u.id and s.date >= v_from
          and st.completed and not st.is_warmup and st.load_lb > 0)             as tonnage_lb,
      (select coalesce(sum(st.reps * e.plyo_contacts_per_rep), 0) from public.sets st
         join public.session_exercises se on se.id = st.session_exercise_id
         join public.sessions s on s.id = se.session_id
         join public.exercises e on e.id = se.exercise_id
        where st.user_id = u.id and s.date >= v_from and st.completed)          as plyo_contacts,
      (select coalesce(sum((c.zone_minutes->>'z2')::numeric), 0) from public.cardio_logs c
        where c.user_id = u.id and c.date >= v_from)                            as zone2_min,
      (select coalesce(sum(c.distance_mi), 0) from public.cardio_logs c
        where c.user_id = u.id and c.date >= v_from)                            as distance_mi,
      (select round(avg(o.steps)) from public.oura_daily o
        where o.user_id = u.id and o.date >= v_from)                            as steps_avg,
      (select round(avg(o.readiness_score), 1) from public.oura_daily o
        where o.user_id = u.id and o.date >= v_from)                            as readiness_avg
    from public.users u
  loop
    insert into public.cron_runs (job_name, status, user_id, detail)
    values ('weekly_rollup', 'ok', r.user_id, jsonb_build_object(
      'week_from',     v_from,
      'week_to',       current_date,
      'sessions',      r.sessions,
      'tonnage_lb',    r.tonnage_lb,
      'plyo_contacts', r.plyo_contacts,
      'zone2_min',     r.zone2_min,
      -- RESEARCH §6.1: 180–240 min/week is the consensus target; Seth starts
      -- far below it and ramps ≤10%/week.
      'zone2_target_min', 180,
      'distance_mi',   r.distance_mi,
      'steps_avg',     r.steps_avg,
      'readiness_avg', r.readiness_avg
    ));
  end loop;

  -- Keep the log small — the free tier is 500 MB and this table is chatter.
  delete from public.cron_runs
  where ran_at < now() - interval '120 days';
end;
$$;

-- ── Job 4 · keep-alive touch ─────────────────────────────────────────────────
-- A tiny write, every six hours. This is the whole anti-pause mechanism.
create or replace function public.cron_keepalive()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.cron_runs (job_name, status, detail)
  values ('keepalive', 'ok', jsonb_build_object('at', now()));

  -- One row is enough; do not let the insurance policy become the database.
  delete from public.cron_runs
  where job_name = 'keepalive' and ran_at < now() - interval '14 days';
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. Lock the job functions down
--
-- These are SECURITY DEFINER: they write cron_runs (which has no policies) and
-- cron_post signs a request with app.cron_secret. Nothing holding the anon or
-- authenticated key has any business calling them — only pg_cron (which runs as
-- the database superuser) and the service key do. Supabase's default privileges
-- grant EXECUTE on public functions to those roles, so revoke it explicitly.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  fns text[] := array[
    'public.cron_post(text, jsonb)',
    'public.cron_oura_sync()',
    'public.cron_strava_reconcile()',
    'public.cron_weekly_rollup()',
    'public.cron_keepalive()'
  ];
  f text;
  r text;
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
exception when others then
  raise notice 'Could not revoke execute on the cron functions: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Scheduling — every statement guarded
--
-- Times are UTC, which is what pg_cron uses. Detroit is UTC−4 in summer and
-- UTC−5 in winter, so 10:05 UTC is 06:05 EDT / 05:05 EST. Both land before the
-- 06:30 local Telegram brief in summer, and comfortably before Seth is awake in
-- winter. If the winter hour ever matters, shift these by one and note it here.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  jobs text[][] := array[
    array['oura_nightly_sync',        '5 10 * * *',  'select public.cron_oura_sync()'],
    array['strava_nightly_reconcile', '20 10 * * *', 'select public.cron_strava_reconcile()'],
    array['weekly_rollup',            '0 9 * * 1',   'select public.cron_weekly_rollup()'],
    array['keepalive',                '0 */6 * * *', 'select public.cron_keepalive()']
  ];
  j text[];
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed — skipping all schedules. Functions are still created and can be called by hand or from a Vercel cron route.';
    return;
  end if;

  foreach j slice 1 in array jobs loop
    begin
      -- Remove any previous definition so re-running this file re-points the
      -- job instead of stacking a second copy of it.
      perform cron.unschedule(j[1]);
    exception when others then
      null;  -- not scheduled yet; nothing to remove
    end;

    begin
      perform cron.schedule(j[1], j[2], j[3]);
      raise notice 'Scheduled % (%)', j[1], j[2];
    exception when others then
      raise notice 'Could not schedule %: %', j[1], sqlerrm;
    end;
  end loop;
exception when others then
  raise notice 'Cron scheduling skipped entirely: %', sqlerrm;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- To check the schedule on a hosted project:
--   select jobid, jobname, schedule, active from cron.job order by jobname;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- To see what the jobs have been doing:
--   select job_name, status, ran_at, detail from public.cron_runs
--    order by ran_at desc limit 20;
-- ═════════════════════════════════════════════════════════════════════════════
