-- ═════════════════════════════════════════════════════════════════════════════
-- 0008_oura_oauth.sql — Longevity OS · Oura moves from PAT to OAuth2
-- ═════════════════════════════════════════════════════════════════════════════
-- Oura RETIRED PERSONAL ACCESS TOKENS IN DECEMBER 2025. New ones cannot be
-- created, so the Oura integration is now an OAuth2 authorization-code flow with
-- rotating refresh tokens (`packages/integrations/src/oura/oauth.ts`).
--
-- ── NO SCHEMA CHANGE IS NEEDED ───────────────────────────────────────────────
-- `public.integration_tokens` as created in 0001_init.sql ALREADY SUFFICES:
--
--   user_id + provider + unique (user_id, provider)  → one row per connection
--   access_token  text                               → holds the encrypted blob
--   expires_at    timestamptz                        → plaintext expiry mirror
--   scope         text                               → plaintext scope mirror
--   refresh_token text                               → stays NULL, see below
--   last_error, last_sync_at, meta, updated_at       → already present
--
-- 0002_rls.sql already enables RLS on it, restricts every row to its owner, and
-- revokes the anon role outright. 0001 already attaches the `set_updated_at`
-- trigger. There is nothing to add, so this migration VERIFIES that the shape
-- the application depends on is really there and DOCUMENTS the convention the
-- code follows — which is the part that would otherwise live only in a comment
-- in a TypeScript file nobody reads before writing a query.
--
-- Safe to run more than once: assertions and comments only, no DDL that mutates.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Assert the columns the token store writes actually exist.
--    A missing column here is a silent 500 on the OAuth callback at 06:30, so
--    it fails the migration instead.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  required text[] := array[
    'user_id', 'provider', 'access_token', 'refresh_token',
    'expires_at', 'scope', 'last_error', 'updated_at'
  ];
  c text;
  missing text[] := '{}';
begin
  if to_regclass('public.integration_tokens') is null then
    raise exception
      '0008: public.integration_tokens does not exist. Run 0001_init.sql first.';
  end if;

  foreach c in array required loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'integration_tokens'
         and column_name  = c
    ) then
      missing := missing || c;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      '0008: public.integration_tokens is missing column(s): %. The Oura token store cannot write.',
      array_to_string(missing, ', ');
  end if;

  raise notice '0008: integration_tokens has every column the Oura OAuth store needs.';
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Assert `unique (user_id, provider)`.
--    `SupabaseTokenStore.save()` is an update-then-insert upsert. Without this
--    constraint a lost race would leave TWO oura rows, `load()` would read
--    whichever came back first, and half the refreshes would present a spent
--    token. The constraint is what makes the upsert correct.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'integration_tokens'
       and con.contype = 'u'
       and (
         -- `attname` is `name`, not `text`, and `name[] = text[]` has no
         -- operator — cast, or this assertion fails on a healthy database.
         select array_agg(att.attname::text order by att.attname::text)
           from unnest(con.conkey) as k(attnum)
           join pg_attribute att
             on att.attrelid = con.conrelid and att.attnum = k.attnum
       ) = array['provider', 'user_id']::text[]
  ) then
    raise exception
      '0008: public.integration_tokens is missing unique (user_id, provider). Token rotation would duplicate rows.';
  end if;

  raise notice '0008: unique (user_id, provider) present — the token upsert is safe.';
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Assert the provider vocabulary still admits 'oura'.
--    The CHECK constraint in 0001 is a literal list; if someone narrows it, the
--    Oura callback starts failing with a constraint violation nobody expects.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  def text;
begin
  select pg_get_constraintdef(con.oid) into def
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'integration_tokens'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%provider%'
   limit 1;

  if def is not null and def not ilike '%''oura''%' then
    raise exception
      '0008: the provider CHECK on integration_tokens no longer allows ''oura'': %', def;
  end if;

  raise notice '0008: provider vocabulary admits ''oura''.';
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Document the storage convention on the objects themselves.
--    `comment on` is a replace, so re-running is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

comment on table public.integration_tokens is
  'Oura / Strava / Telegram credentials. Values are ENCRYPTED BY THE APPLICATION (AES-256-GCM, key from '
  'the server environment) before insert — never plaintext, not even for the Mac mini worker. '
  'Service-role access only in practice. For provider=''oura'' the WHOLE token set is one blob in '
  'access_token; see the comment on that column.';

comment on column public.integration_tokens.access_token is
  'ENCRYPTED. For provider=''oura'' this is the entire token set — access token, rotating refresh token, '
  'absolute expiry and granted scope — as one AES-256-GCM blob: base64(iv[12] || ciphertext || tag[16]), '
  'key OURA_TOKEN_KEY (64 hex chars). One blob, not two columns, because Oura refresh tokens are SINGLE '
  'USE and rotate on every refresh: two columns can disagree after a crash mid-write, and "the refresh '
  'token saved but the access token did not" is an unrecoverable state that needs a browser re-auth.';

comment on column public.integration_tokens.refresh_token is
  'ENCRYPTED when used. NULL for provider=''oura'' — the rotating refresh token lives inside the '
  'access_token blob so the pair can never be written half-updated.';

comment on column public.integration_tokens.expires_at is
  'Plaintext MIRROR of the expiry inside the blob. Not a secret, and queryable, so the settings screen '
  'can say "expires in 43 minutes" without holding the decryption key. The blob remains the source of '
  'truth; anything that acts on the value must decrypt.';

comment on column public.integration_tokens.scope is
  'Plaintext MIRROR of the granted scopes. For Oura these are namespaced (extapi:daily, extapi:personal, '
  '…); the legacy bare names (daily, heartrate, session) are silently ungranted and read nothing.';

-- ═════════════════════════════════════════════════════════════════════════════
-- End of 0008. No DDL: integration_tokens already suffices for Oura OAuth2.
-- ═════════════════════════════════════════════════════════════════════════════
