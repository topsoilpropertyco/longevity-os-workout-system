-- ═════════════════════════════════════════════════════════════════════════════
-- 0009_grants.sql — Longevity OS · explicit table privileges
-- ═════════════════════════════════════════════════════════════════════════════
-- RLS POLICIES AND TABLE GRANTS ARE TWO DIFFERENT THINGS, and everything in
-- 0002 is the first kind. A policy decides WHICH ROWS a role may see. A grant
-- decides whether the role may touch the table at all. A table with perfect
-- policies and no grant returns "permission denied"; a table with a grant and
-- no policy returns every row in it.
--
-- Until now this schema supplied only the policies and leaned on Supabase's
-- "Automatically expose new tables" setting to supply the grants invisibly.
-- That setting is off for this project — deliberately, because it exposes every
-- future table the moment it is created, whether or not anyone remembered to
-- write a policy for it. Supabase's own dashboard recommends disabling it.
--
-- So the grants are written down here instead, where they can be read, audited
-- and diffed. Nothing is granted that a policy does not already constrain.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  has_roles boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  if not has_roles then
    raise notice '0009: Supabase roles absent (bare Postgres) — skipping grants';
    return;
  end if;

  -- ── schema ────────────────────────────────────────────────────────────────
  execute 'grant usage on schema public to anon, authenticated, service_role';

  -- ── the athlete's own data: all four verbs, every row filtered by RLS ──────
  -- `authenticated` is Seth signed in. The policies in 0002 restrict every one
  -- of these to `auth.uid() = user_id`, so a grant here cannot leak another
  -- user's rows even when there is more than one user.
  execute $g$
    grant select, insert, update, delete on
      public.users, public.locations, public.location_equipment,
      public.plans, public.plan_days, public.plan_blocks,
      public.sessions, public.session_exercises, public.sets,
      public.cardio_logs, public.strava_activities, public.oura_daily,
      public.self_reports, public.body_metrics,
      public.injuries, public.injury_checkins,
      public.program_progress, public.goal_settings,
      public.bot_messages, public.imports
    to authenticated
  $g$;

  -- ── shared reference data: read-only from the browser ─────────────────────
  -- The global rows (user_id is null) are maintained by migrations and by the
  -- ingest scripts, which run with the service key. Seth may add his OWN
  -- exercises and equipment, and the 0002 policies already allow exactly that,
  -- so insert/update/delete are granted and the policy does the filtering.
  execute $g$
    grant select, insert, update, delete on
      public.exercises, public.exercise_media, public.equipment_catalog,
      public.programs, public.program_steps
    to authenticated
  $g$;

  -- ── presets: read-only. Cloning one writes to `locations`, not to these. ───
  execute 'grant select on public.location_presets, public.location_preset_equipment to authenticated';

  -- ── infrastructure: visible, never writable from a browser ────────────────
  -- The settings screen shows "mini last seen 3 minutes ago"; that is all the
  -- browser needs from these. The worker writes them with the service key,
  -- which bypasses RLS and does not depend on any grant here.
  execute 'grant select on public.worker_heartbeat to authenticated';

  -- ── NOT granted to anyone in the browser, on purpose ──────────────────────
  --   integration_tokens — Oura/Strava/Telegram credentials. Server only.
  --   llm_jobs           — claiming work is the worker's job (see 0006).
  --   cron_runs          — operational log, service key only.
  -- Listing them here so their absence reads as a decision, not an oversight.

  -- ── sequences, for any serial/identity column ─────────────────────────────
  execute 'grant usage, select on all sequences in schema public to authenticated';

  -- ── anon gets nothing ─────────────────────────────────────────────────────
  -- This is a single-user application behind a magic link. Nobody signed out
  -- has any business reading any of it.
  execute 'revoke all on all tables in schema public from anon';

  raise notice '0009: grants applied';
end;
$$;

-- ── guard: a granted table with no policy would be world-readable ────────────
do $$
declare
  offenders text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then return; end if;

  select string_agg(distinct c.relname, ', ')
    into offenders
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and has_table_privilege('authenticated', c.oid, 'SELECT')
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);

  if offenders is not null then
    raise exception '0009: granted to authenticated but has no RLS policy: %', offenders;
  end if;
end;
$$;
