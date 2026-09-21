-- ═════════════════════════════════════════════════════════════════════════════
-- 0012_auth_bootstrap.sql — Longevity OS · a profile row on first sign-in
-- ═════════════════════════════════════════════════════════════════════════════
-- `auth.users` and `public.users` ARE NOT THE SAME TABLE, and everything in this
-- schema points at the second one:
--
--   · every RLS policy in 0002 compares `auth.uid()` to a `user_id` that is a
--     foreign key into public.users;
--   · every user-scoped table declares `user_id uuid not null references
--     public.users(id)`.
--
-- So an athlete who signs in with a magic link and has no public.users row can
-- SELECT (and get nothing, correctly) but cannot INSERT a single set: the first
-- foreign key check fails. That failure would land mid-workout, in a gym, hours
-- after the sign-in that caused it. This migration closes the gap at the source:
-- an AFTER INSERT trigger on auth.users mirrors the new account into
-- public.users, before the app ever asks.
--
-- ── WHY A TRIGGER AND NOT APPLICATION CODE ───────────────────────────────────
-- Because sign-in is not the only door. An account created from the Supabase
-- dashboard, from the CLI, or by a future invite link gets a profile too. The
-- app also upserts the row on its sign-in callback (apps/web/src/lib/auth.ts,
-- `ensureProfile`) as a belt to this migration's braces — that path is what
-- saves a deploy where this file was never pasted into the SQL editor.
--
-- ── IDEMPOTENCY / TRANSACTION SAFETY ─────────────────────────────────────────
-- `create or replace function`, `drop trigger if exists` before `create
-- trigger`, and an `on conflict` insert: re-running changes nothing. The whole
-- bundle is pasted into the SQL editor as ONE transaction, so every statement
-- that could fail on a database this file cannot control — a bare Postgres with
-- no `auth` schema (CI, psql smoke tests), or a project where `postgres` is not
-- permitted to attach a trigger to auth.users — is wrapped and downgraded to a
-- notice. An exception here would roll back the entire schema.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The mirror function.
--
--    SECURITY DEFINER because it runs inside the auth server's transaction,
--    where `auth.uid()` is not yet the new user and the RLS insert policy would
--    therefore refuse the row. `set search_path = public, pg_temp` pins the
--    lookup path, which is required of any definer function.
--
--    It never raises. A trigger that throws aborts the INSERT into auth.users,
--    which means the sign-up fails and the athlete is locked out of his own app
--    with an opaque 500 — a far worse outcome than a missing profile row that
--    `ensureProfile` will create a second later. The warning is the record.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    new.email,
    -- Whatever the identity provider knew him as. Onboarding overwrites it.
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name',
                    new.raw_user_meta_data ->> 'name'), '')
  )
  on conflict (id) do update
    set email = excluded.email
  where users.email is distinct from excluded.email;

  return new;
exception when others then
  raise warning 'handle_new_auth_user(%): %', new.id, sqlerrm;
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Mirrors a new auth.users row into public.users so RLS and every user_id foreign key have something to point at.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Attach it — only where there is an auth schema to attach it to.
--
--    On a hosted Supabase project the SQL editor runs as `postgres`, which is
--    granted the trigger privilege on auth.users. If a future platform change
--    takes that away, this prints what to do instead of failing the paste.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('auth.users') is null then
    raise notice '0012: no auth schema (bare Postgres) — skipping the auth.users trigger.';
    return;
  end if;

  execute 'drop trigger if exists on_auth_user_created on auth.users';
  execute 'create trigger on_auth_user_created
             after insert on auth.users
             for each row execute function public.handle_new_auth_user()';

  raise notice '0012: on_auth_user_created is attached to auth.users.';
exception when others then
  raise warning '0012: could not attach the auth.users trigger (%). The app still creates the profile row on its sign-in callback; nothing is lost, but an account created outside the app will need a public.users row by hand.', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill.
--
--    The trigger only fires on new accounts. Anyone who signed in before this
--    file was applied — which is everyone, the first time it is run — already
--    exists in auth.users and would otherwise stay profile-less forever.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_added integer := 0;
begin
  if to_regclass('auth.users') is null then
    return;
  end if;

  execute $sql$
    insert into public.users (id, email)
    select u.id, u.email from auth.users u
    on conflict (id) do nothing
  $sql$;

  get diagnostics v_added = row_count;
  raise notice '0012: backfilled % profile row(s) from auth.users.', v_added;
exception when others then
  raise warning '0012: profile backfill skipped (%).', sqlerrm;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- After this runs, sign in once at /sign-in. The uuid of the row that appears in
-- public.users is the value `LONGEVITY_USER_ID` wants — the nightly cron and the
-- Oura sync both run without a browser session and identify the athlete with it.
--
--   select id, email from public.users;
-- ═════════════════════════════════════════════════════════════════════════════
