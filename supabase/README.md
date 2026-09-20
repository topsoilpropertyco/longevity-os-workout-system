# Supabase — Longevity OS Workout System

The database. Postgres + RLS + pg_cron on the Supabase **free tier**, which is
where the whole system's $0/month budget starts. Five migrations, in order,
idempotent, and each one commented so it can be read on a phone.

---

## The migrations, in order

| # | File | What it does |
|---|------|--------------|
| 1 | `migrations/0001_init.sql` | `pgcrypto`, 14 enum types mirroring `packages/engine/src/types.ts`, **27 tables**, indexes, CHECK constraints, `updated_at` triggers. |
| 2 | `migrations/0002_rls.sql` | Row level security on every table, in three policy shapes. Fails loudly if a table slipped through. |
| 3 | `migrations/0003_seed_equipment.sql` | The global `equipment_catalog` — all 60 slugs from the `EQUIPMENT` const, with the notes that matter (Smith bar ≈15–20 lb, PF dumbbells 5–75). |
| 4 | `migrations/0004_seed_presets.sql` | `location_presets` + `location_preset_equipment` + `apply_location_preset()`. Four presets: Home, Planet Fitness — standard, CrossFit box — typical, Bodyweight only (travel). |
| 5 | `migrations/0005_cron.sql` | `cron_runs` + four pg_cron jobs: nightly Oura sync, nightly Strava reconcile, weekly rollup, keep-alive. Every statement guarded so the file is safe without pg_cron. |

Run them **in filename order**. `supabase db reset` and `supabase db push` both
do that for you. They are written so re-running any of them is harmless:
`if not exists` everywhere, enum creation swallows `duplicate_object`, seeds
`on conflict … do update`, and every policy is dropped before it is created.

---

## Locally

You need Docker and the Supabase CLI (`npx supabase` is fine — no global
install, no cost).

```bash
# once, if supabase/config.toml does not exist yet
npx supabase init

# start the local stack (Postgres, Auth, Storage, Studio)
npx supabase start

# apply every migration to a clean database — the usual inner-loop command
npx supabase db reset

# Studio at http://localhost:54323, Postgres at postgresql://postgres:postgres@localhost:54322/postgres
npx supabase status
```

`db reset` drops the local database, replays `migrations/*.sql` in order, and
then runs `supabase/seed.sql` if one exists. **Do not put Seth's data in a
`seed.sql`** — the seeds here are global reference data and live in migrations
so the hosted project gets them too.

To apply a single file by hand:

```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
```

pg_cron is not part of the local stack by default. `0005_cron.sql` notices this,
prints a NOTICE, creates its functions anyway, and skips the schedule. Call the
jobs by hand to test them:

```sql
select public.cron_keepalive();
select public.cron_weekly_rollup();
select job_name, status, detail from public.cron_runs order by ran_at desc limit 10;
```

---

## Against the hosted project

```bash
npx supabase login
npx supabase link --project-ref <project-ref>

npx supabase db push          # applies pending migrations
npx supabase migration list   # shows local vs remote
```

Then, **once per project**, in the SQL editor:

```sql
-- pg_cron, if the dashboard has not already enabled it (Database → Extensions)
create extension if not exists pg_cron;
create extension if not exists pg_net;   -- lets the cron jobs call the app

-- where the cron jobs POST, and the shared secret the route checks.
-- These are database settings, never committed to git.
alter database postgres set app.base_url    = 'https://<your-app>.vercel.app';
alter database postgres set app.cron_secret = '<same value as CRON_SECRET in Vercel>';
```

Re-run `0005_cron.sql` afterwards so the four jobs actually get scheduled. Check
them with:

```sql
select jobid, jobname, schedule, active from cron.job order by jobname;
select * from cron.job_run_details order by start_time desc limit 20;
```

If `app.base_url` or pg_net is missing, the sync jobs record a `skipped` row in
`public.cron_runs` and do nothing. They never error — a red cron job is one more
thing Seth would have to think about.

---

## After the schema changes

Regenerate the typed contract and commit it:

```bash
npx supabase gen types typescript --local > packages/db/src/types.ts
# or, against the hosted project:
npx supabase gen types typescript --project-id <project-ref> > packages/db/src/types.ts
```

`packages/db/src/types.ts` is hand-written until the project is linked, and it
matches these migrations column for column. **A migration and that file change
in the same commit**, always.

---

## How to read the schema

**Everything is pounds and miles.** `load_lb numeric(7,2)` is TOTAL load —
dumbbell pairs sum both hands, barbell and Smith loads include the bar (from the
location), bodyweight moves record ADDED load only, and assisted machines record
assistance as a *negative* `load_lb` (which is why `sets.is_assisted` exists —
it is the only thing that lets a negative past the CHECK). Distances are
`distance_mi numeric(8,3)`. No kilogram or kilometre column exists anywhere.

**`user_id` is on every table.** User-scoped tables have it `not null`. The
seven shared reference tables — `equipment_catalog`, `exercises`,
`exercise_media`, `programs`, `program_steps`, `location_presets`,
`location_preset_equipment` — have it **nullable**: `null` means a global
library row, non-null means Seth's private addition.

**Plans are audit rows, not truth.** `plans` / `plan_days` / `plan_blocks`
persist what the engine said so we can diff today's answer against yesterday's.
The engine recomputes on every open (CLAUDE.md invariant 4). Any code path that
loads a plan row to decide what Seth does today is a bug.

**`llm_jobs` is the Mac mini's inbox.** The worker polls, claims a row, calls
LM Studio, writes the result. A job still `queued` past `deadline_at`
(created_at + 60 s) is taken over by the Vercel Gemini fallback, which sets
`status = 'fallback'`. The partial index `llm_jobs_queued_idx` is what keeps
that poll cheap enough to run forever.

**`integration_tokens` holds ciphertext.** Oura, Strava and Telegram
credentials are encrypted by the application layer *before* the insert, with a
key from the server environment. Postgres never sees a plaintext token, the anon
role has no grants on the table at all, and the browser never reads it.

---

## RLS in one paragraph

Three shapes, and only three. `public.users`: `auth.uid() = id`. The 21
user-scoped tables: `auth.uid() = user_id` for select, insert, update and
delete. The reference tables: read `user_id is null or user_id = auth.uid()`,
write `user_id = auth.uid()` — which means no client can create or edit a
global row. `cron_runs` has RLS on and **no policies at all**: it is
infrastructure, reachable only by the service key.

`service_role` is created with `BYPASSRLS`, so none of this applies to it. That
is deliberate: the Mac mini worker, the Vercel cron routes, and the exercise/KOT
ingest scripts all need to write rows no policy permits. **The service key never
reaches the browser** — it lives in Vercel server env and the mini's launchd
plist. The PWA uses the anon key and is fully constrained by the policies.

---

## Seeding Seth's locations

Location presets are *definitions*; they are not attached to anyone until
applied. Onboarding does that once, with the service key, after his user row
exists:

```sql
select public.apply_location_preset(:uid, 'home');
select public.apply_location_preset(:uid, 'planet_fitness_standard',
                                    'Planet Fitness — Rochester Hills');
select public.apply_location_preset(:uid, 'bodyweight_only');
```

Clone `planet_fitness_standard` **once per club** with the club's name — PF
inventory varies by franchise, and the Smith bar weight in the preset (20 lb) is
a default, not a measurement. Re-applying a preset preserves whatever Seth has
edited; pass a fourth argument `true` for a "reset to preset".

---

## Free-tier notes

- **500 MB Postgres.** Strava streams are stored downsampled (`streams_summary`),
  not raw. `cron_runs` prunes itself. Media lives in Storage and on public CDNs,
  never in a column.
- **Projects pause after ~7 days idle.** The `keepalive` job writes a row every
  six hours, and the Mac mini's poll loop touches the database anyway. Between
  them, a holiday cannot put the project to sleep.
- **pg_cron is free here; Vercel Hobby cron is not enough** (≈2 jobs/day,
  imprecise). That is why the schedule lives in `0005_cron.sql`.
- Nothing in these files requires a paid tier, extension, or add-on.
