-- ═════════════════════════════════════════════════════════════════════════════
-- 0002_rls.sql — Longevity OS · row level security
-- ═════════════════════════════════════════════════════════════════════════════
-- RLS is on from the first migration even though there is exactly one user
-- (CLAUDE.md: "Single user now, user_id on every table, RLS on from the first
-- migration"). The cost of adding it later is a weekend; the cost of adding it
-- now is this file.
--
-- THREE SHAPES, and only three:
--
--   1. public.users            — a row is visible to the athlete it describes.
--                                id = auth.uid()
--
--   2. USER-SCOPED tables      — auth.uid() = user_id, for all four verbs.
--                                21 tables. Nothing subtle.
--
--   3. REFERENCE tables        — the shared library.
--        select : user_id is null (global row) OR user_id = auth.uid()
--        write  : user_id = auth.uid() only. An athlete may add private
--                 exercises and equipment; nobody edits a global row through
--                 the API. Global rows are maintained by migrations and by the
--                 ingest scripts, which run with the service key.
--                 5 tables: equipment_catalog, exercises, exercise_media,
--                 programs, program_steps.
--
-- ─── service_role ────────────────────────────────────────────────────────────
-- Supabase's `service_role` is created with BYPASSRLS, so NONE of these
-- policies apply to it. That is deliberate and load-bearing:
--   · the Mac mini worker claims and completes llm_jobs with the service key;
--   · Vercel cron routes (Oura nightly sync, Strava reconcile, weekly rollup)
--     write rows on Seth's behalf with the service key;
--   · the exercise / KOT ingest scripts insert GLOBAL reference rows
--     (user_id = null), which no policy here permits.
-- The service key therefore NEVER reaches the browser. It lives only in Vercel
-- server env and in the mini's launchd plist. The PWA uses the anon key and is
-- fully constrained by the policies below.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- We do NOT use `force row level security`: the table owner (and service_role)
-- should keep the bypass described above.
--
-- Re-running this file is safe — every policy is dropped before it is created.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  t         text;
  grantee   text := '';   -- ' to authenticated' when the Supabase role exists
  user_scoped text[] := array[
    'locations', 'location_equipment',
    'plans', 'plan_days', 'plan_blocks',
    'sessions', 'session_exercises', 'sets',
    'cardio_logs', 'strava_activities',
    'oura_daily', 'self_reports', 'body_metrics',
    'injuries', 'injury_checkins',
    'program_progress', 'goal_settings',
    'llm_jobs', 'bot_messages', 'imports', 'integration_tokens'
  ];
  reference text[] := array[
    'equipment_catalog', 'exercises', 'exercise_media', 'programs', 'program_steps'
  ];
begin
  -- Scope every policy to signed-in users when running on Supabase. On a bare
  -- Postgres (CI, a psql smoke test) the role is absent and the clause is
  -- dropped; the auth.uid() comparison still denies everyone anonymous.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grantee := ' to authenticated';
  end if;

  -- ── 1. users ───────────────────────────────────────────────────────────────
  execute 'alter table public.users enable row level security';
  execute 'drop policy if exists users_select_self on public.users';
  execute 'create policy users_select_self on public.users for select'
          || grantee || ' using (auth.uid() = id)';
  execute 'drop policy if exists users_insert_self on public.users';
  execute 'create policy users_insert_self on public.users for insert'
          || grantee || ' with check (auth.uid() = id)';
  execute 'drop policy if exists users_update_self on public.users';
  execute 'create policy users_update_self on public.users for update'
          || grantee || ' using (auth.uid() = id) with check (auth.uid() = id)';
  -- No delete policy on users on purpose: account deletion goes through
  -- auth.users and cascades down. Nothing in the app deletes an athlete.

  -- ── 2. user-scoped tables ──────────────────────────────────────────────────
  foreach t in array user_scoped loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select%s using (auth.uid() = user_id)',
      t || '_select_own', t, grantee);

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert%s with check (auth.uid() = user_id)',
      t || '_insert_own', t, grantee);

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update%s using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t, grantee);

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete%s using (auth.uid() = user_id)',
      t || '_delete_own', t, grantee);
  end loop;

  -- ── 3. reference tables ────────────────────────────────────────────────────
  foreach t in array reference loop
    execute format('alter table public.%I enable row level security', t);

    -- Read: the global library plus your own additions.
    execute format('drop policy if exists %I on public.%I', t || '_select_global_or_own', t);
    execute format(
      'create policy %I on public.%I for select%s using (user_id is null or user_id = auth.uid())',
      t || '_select_global_or_own', t, grantee);

    -- Write: your own rows only. `user_id = auth.uid()` is deliberately strict —
    -- it forbids inserting a row with user_id null, i.e. no client can create
    -- or edit a global library row. Migrations and the service key do that.
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert%s with check (user_id = auth.uid())',
      t || '_insert_own', t, grantee);

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update%s using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_update_own', t, grantee);

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete%s using (user_id = auth.uid())',
      t || '_delete_own', t, grantee);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Belt and braces on the secrets table.
--
-- RLS already limits integration_tokens to its owner, but the anon key should
-- not be able to so much as name the table. Revoke its grants outright; the
-- browser never needs Oura/Strava/Telegram credentials — the server exchanges
-- them and hands back data.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.integration_tokens from anon;
  end if;
exception when others then
  raise notice 'Could not revoke anon grants on integration_tokens: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Assertion: fail the migration if any public table slipped through without
-- RLS. Cheaper than discovering it from a leak.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if missing is not null then
    raise exception 'RLS is not enabled on: %', missing;
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- End of 0002. Later migrations that add a table MUST add it to one of the two
-- arrays above (or give it its own policies) or the assertion will fail.
-- ═════════════════════════════════════════════════════════════════════════════
