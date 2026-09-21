-- ═════════════════════════════════════════════════════════════════════════════
-- Longevity OS — complete schema, in one file
-- ═════════════════════════════════════════════════════════════════════════════
-- Every migration in supabase/migrations/, concatenated in order, so the whole
-- schema can be created by pasting once into the Supabase SQL Editor.
--
-- GENERATED — do not edit. Regenerate with:  npm run sql:bundle
-- The individual files remain the source of truth.
--
-- Safe to run more than once: every statement is idempotent, and this bundle is
-- verified by applying it TWICE in a row against a real Postgres 16.
--
-- After it finishes you should see, at the bottom of the results pane, a notice
-- for each section and no errors. Expect notices about pg_cron not being
-- installed — that is normal and harmless on a fresh project.
-- ═════════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════════

-- == 0001_init.sql ==

-- ═════════════════════════════════════════════════════════════════════════════
-- 0001_init.sql — Longevity OS Workout System · base schema
-- ═════════════════════════════════════════════════════════════════════════════
-- Read this on a phone. Every section is short and says why it exists.
--
-- CONVENTIONS THAT HOLD EVERYWHERE (mirrors packages/engine/src/types.ts):
--   · Weight  = TOTAL LOAD in POUNDS, column `load_lb numeric(7,2)`.
--               Dumbbell pairs sum both hands. Barbell/Smith include the bar
--               (bar weight comes from the location). Bodyweight moves store
--               ADDED load only. Never kg.
--   · Distance = MILES, column `distance_mi numeric(8,3)`. Never km.
--   · Duration = minutes, unless the column ends in `_s` (seconds).
--   · Dates    = `date` in the athlete's local timezone (users.timezone).
--   · Instants = `timestamptz`, UTC.
--   · Every user-scoped table carries `user_id uuid not null` → public.users,
--     `on delete cascade`. Shared reference tables (equipment_catalog,
--     exercises, exercise_media, programs, program_steps) carry a NULLABLE
--     user_id: null = global library row, non-null = Seth's private addition.
--
-- ENUMS are the SQL mirror of the TypeScript unions in
-- packages/engine/src/types.ts. That file is the source of truth — if a value
-- is added there, add it here in a new migration with `alter type ... add value`.
--
-- Idempotency: every object is created with `if not exists`, and enum creation
-- is wrapped in a duplicate_object-swallowing DO block, so this file can be
-- re-run against a database that already has it.
-- ═════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enum types — one per TypeScript union
-- ─────────────────────────────────────────────────────────────────────────────

-- Regions tracked by the load ledger (types.ts REGIONS · RESEARCH §6.3).
do $$ begin
  create type public.region as enum (
    'knees_quads', 'posterior_chain', 'low_back', 'shoulders',
    'elbows_forearms', 'calves_achilles', 'spine', 'chest',
    'upper_back', 'core', 'hips_glutes', 'neck'
  );
exception when duplicate_object then null; end $$;

-- Movement patterns, used for swap ranking and template slot filling.
do $$ begin
  create type public.movement_pattern as enum (
    'squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push',
    'horizontal_pull', 'vertical_pull', 'carry', 'rotation',
    'anti_extension', 'anti_rotation', 'anti_lateral_flexion',
    'jump', 'sprint', 'gait', 'isolation_upper', 'isolation_lower',
    'mobility', 'cardio_steady', 'cardio_interval'
  );
exception when duplicate_object then null; end $$;

-- Canonical equipment slugs. Ingest normalizes looser dataset vocabularies
-- into this set. `bodyweight` is implicitly available at every location.
do $$ begin
  create type public.equipment_slug as enum (
    'bodyweight', 'dumbbell', 'adjustable_dumbbell', 'barbell', 'ez_curl_bar',
    'fixed_barbell', 'trap_bar', 'smith_machine', 'power_rack', 'bench_flat',
    'bench_adjustable', 'nordic_support', 'pull_up_bar', 'dip_station',
    'assisted_pullup_machine', 'cable_machine', 'functional_trainer',
    'selectorized_machine', 'leg_press', 'leg_extension', 'leg_curl',
    'hip_abductor_adductor', 'calf_machine', 'back_extension_bench',
    'chest_press_machine', 'shoulder_press_machine', 'lat_pulldown',
    'seated_row', 'pec_deck', 'ab_crunch_machine', 'kettlebell',
    'resistance_bands', 'suspension_trainer', 'medicine_ball', 'slam_ball',
    'stability_ball', 'bosu', 'foam_roller', 'yoga_mat', 'slant_board',
    'tibialis_bar', 'sled', 'plyo_box', 'jump_rope', 'treadmill', 'elliptical',
    'arc_trainer', 'stair_climber', 'stationary_bike', 'recumbent_bike',
    'rower', 'ski_erg', 'assault_bike', 'track_or_open_space', 'outdoor_route',
    'rings', 'ab_wheel', 'battle_rope', 'sledgehammer', 'tire', 'arm_ergometer',
    'ghd', 'bumper_plates', 'chalk', 'wall_space'
  );
exception when duplicate_object then null; end $$;

-- How a logged `load_lb` should be interpreted for this exercise.
do $$ begin
  create type public.load_style as enum (
    'total_dumbbell_pair',  -- both hands summed
    'single_implement',     -- load as entered
    'barbell',              -- bar + plates; bar weight from the location
    'smith',                -- Smith bar + plates; smith bar weight from location
    'stack',                -- machine stack, as displayed
    'bodyweight',           -- load_lb = ADDED load (vest, DB, belt)
    'assisted',             -- load_lb = assistance, a NEGATIVE contribution
    'band',                 -- approximate band tension
    'none'                  -- no load concept (mobility, breathwork, carries)
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.session_type as enum (
    'strength', 'kot', 'power', 'vo2', 'zone2',
    'sprint', 'mobility', 'recovery', 'external'
  );
exception when duplicate_object then null; end $$;

-- Four primaries (maintain/tone/bulk/six_pack) plus the "More" list.
do $$ begin
  create type public.goal_mode as enum (
    'maintain', 'tone', 'bulk', 'six_pack', 'strength',
    'power', 'endurance', 'rehab', 'vo2_focus', 'fat_loss'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cardio_modality as enum (
    'run', 'walk', 'ruck', 'bike', 'row',
    'ski_erg', 'elliptical', 'stair', 'swim', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.location_kind as enum (
    'home', 'planet_fitness', 'crossfit_box', 'bodyweight_only', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.force_kind as enum ('push', 'pull', 'static', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mechanic_kind as enum ('compound', 'isolation', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.level_kind as enum ('beginner', 'intermediate', 'expert');
exception when duplicate_object then null; end $$;

-- Tag shown on each card in the swap carousel.
do $$ begin
  create type public.swap_difficulty as enum ('easier', 'same', 'harder');
exception when duplicate_object then null; end $$;

-- Lifecycle of a job handed to the Mac mini worker (CLAUDE.md invariant 3).
do $$ begin
  create type public.llm_job_status as enum (
    'queued', 'claimed', 'succeeded', 'failed', 'fallback'
  );
exception when duplicate_object then null; end $$;

-- Provenance of an exercise record or a media asset (types.ts Exercise.source).
do $$ begin
  create type public.media_source as enum (
    'free-exercise-db', 'gym-visual', 'curated', 'kot'
  );
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Shared helper — updated_at trigger function
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Row-level BEFORE UPDATE trigger: stamps updated_at. Attached at the bottom of this file to every table that has the column.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Identity
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per athlete. `id` is the SAME uuid as auth.users.id, so every RLS
-- policy can simply compare auth.uid() to a user_id column. Single user today
-- (Seth); the column exists on everything so profiles are a non-event later.
create table if not exists public.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  display_name       text,
  birth_date         date,
  height_in          numeric(5,2) check (height_in is null or height_in > 0),
  -- Most recent known bodyweight; %BW program standards and bodyweight loads
  -- read this. Historical values live in body_metrics.
  bodyweight_lb      numeric(6,2) check (bodyweight_lb is null or bodyweight_lb > 0),
  -- HRmax precedence: measured (Strava max over 90 d) > Oura > 220 − age.
  hr_max             integer check (hr_max is null or hr_max between 90 and 230),
  hr_max_source      text check (hr_max_source is null or hr_max_source in ('measured_strava', 'oura', 'formula')),
  resting_hr         integer check (resting_hr is null or resting_hr between 20 and 150),
  standing_reach_in  numeric(5,2) check (standing_reach_in is null or standing_reach_in > 0),
  -- All `date` columns are interpreted in this zone.
  timezone           text not null default 'America/Detroit',
  telegram_chat_id   text,
  onboarded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.users is
  'Athlete profile. id mirrors auth.users.id so RLS is a plain auth.uid() comparison.';

-- Tie public.users to Supabase auth when the auth schema is present. Guarded so
-- this migration still runs on a bare Postgres (CI, psql smoke tests).
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users')
     and not exists (select 1 from pg_constraint where conname = 'users_id_fkey')
  then
    alter table public.users
      add constraint users_id_fkey foreign key (id)
      references auth.users (id) on delete cascade;
  end if;
exception when others then
  raise notice 'Skipping auth.users FK: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Reference data — equipment, exercises, media, programs
--    user_id IS NULLABLE on these five tables.
--      null      → global library row, readable by everyone
--      non-null  → a private addition owned by that athlete
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.equipment_catalog (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete cascade,  -- NULL = global
  slug          public.equipment_slug not null,
  display_name  text not null,
  category      text not null check (category in
                  ('free_weight', 'machine', 'cardio', 'accessory', 'bodyweight', 'rack_bench')),
  -- Where the real world disagrees with the label: "Smith bar counterbalanced,
  -- ~15–20 lb effective", "PF dumbbells typically 5–75 lb".
  notes         text,
  image_url     text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Two partial unique indexes instead of one composite: a slug may appear once
-- globally and once per athlete (so Seth can override a global note).
create unique index if not exists equipment_catalog_global_slug_idx
  on public.equipment_catalog (slug) where user_id is null;
create unique index if not exists equipment_catalog_user_slug_idx
  on public.equipment_catalog (user_id, slug) where user_id is not null;

comment on table public.equipment_catalog is
  'The checklist vocabulary for locations. Seeded globally by 0003_seed_equipment.sql.';

-- The exercise library. Spine = yuhonas/free-exercise-db (public domain),
-- enriched with curated KOT entries. Media lives in exercise_media.
create table if not exists public.exercises (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references public.users(id) on delete cascade,  -- NULL = global
  slug                  text not null unique,
  name                  text not null,
  aliases               text[] not null default '{}',
  pattern               public.movement_pattern not null,
  force                 public.force_kind not null default 'unknown',
  mechanic              public.mechanic_kind not null default 'unknown',
  level                 public.level_kind not null default 'intermediate',
  -- Every equipment option that can perform this movement. Empty = bodyweight.
  equipment             public.equipment_slug[] not null default '{}',
  -- {"knees_quads": 0.8, "core": 0.3} — 0–1 per region, how hard ONE working
  -- set taxes that region. Multiplied by set load to feed the ledger.
  region_loads          jsonb not null default '{}'::jsonb,
  load_style            public.load_style not null default 'none',
  -- True when this is a viable substitute at a barbell-free gym (Planet
  -- Fitness has no barbells, racks, bumpers or chalk — RESEARCH §2).
  barbell_free          boolean not null default false,
  -- True when the eccentric is the point (Nordics, slow negatives, depth
  -- jumps). The ledger demands ≥72 h before re-loading that region.
  eccentric_dominant    boolean not null default false,
  -- Ground contacts per rep, for plyometric volume accounting. 0 for non-plyo.
  plyo_contacts_per_rep numeric(5,2) not null default 0 check (plyo_contacts_per_rep >= 0),
  -- Knees Over Toes step this belongs to, when applicable (e.g. 'zero.tib_raise').
  kot_step              text,
  cue                   text,
  instructions          text[] not null default '{}',
  -- Curated substitution order, by exercise SLUG. Beats generic ranking.
  preferred_alternatives text[] not null default '{}',
  -- Slugs that must not share a session with this one (RESEARCH §6.3 pairing
  -- exclusions). A session that violates this is a bug, not a low score.
  contraindicated_with  text[] not null default '{}',
  -- Regions this exercise actively REHABILITATES rather than merely loads.
  rehab_for             public.region[] not null default '{}',
  source                public.media_source not null default 'curated',
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.exercises.region_loads is
  'jsonb map region -> 0..1. Keys must be members of the region enum; validated in the ingest script, not by a constraint, so ingestion never half-fails.';

create index if not exists exercises_pattern_idx        on public.exercises (pattern);
create index if not exists exercises_kot_step_idx       on public.exercises (kot_step) where kot_step is not null;
create index if not exists exercises_barbell_free_idx   on public.exercises (barbell_free) where barbell_free;
create index if not exists exercises_equipment_gin_idx  on public.exercises using gin (equipment);
create index if not exists exercises_aliases_gin_idx    on public.exercises using gin (aliases);
create index if not exists exercises_region_loads_idx   on public.exercises using gin (region_loads);
create index if not exists exercises_owner_idx          on public.exercises (user_id) where user_id is not null;

-- GIFs and stills. Gym Visual media REQUIRES the attribution string to stay
-- visible in-app wherever it is displayed (settings → credits).
create table if not exists public.exercise_media (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users(id) on delete cascade,  -- NULL = global
  exercise_id  uuid not null references public.exercises(id) on delete cascade,
  gif_url      text,
  thumb_url    text,
  image_urls   text[] not null default '{}',
  -- e.g. '© Gym visual — https://gymvisual.com/'
  attribution  text,
  source       public.media_source not null default 'gym-visual',
  width_px     integer check (width_px is null or width_px > 0),
  height_px    integer check (height_px is null or height_px > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (exercise_id, source)
);

create index if not exists exercise_media_exercise_idx on public.exercise_media (exercise_id);

-- A program is an ordered set of steps with standards. KOT is the active one.
create table if not exists public.programs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.users(id) on delete cascade,  -- NULL = global
  slug             text not null unique,
  name             text not null,
  description      text,
  -- Session ordering rule. KOT is strictly ground-up (RESEARCH §7).
  ordering         text not null default 'as_listed'
                     check (ordering in ('ground_up', 'as_listed', 'engine_choice')),
  days_per_week_min integer not null default 2 check (days_per_week_min between 0 and 7),
  days_per_week_max integer not null default 3 check (days_per_week_max between 0 and 7),
  -- [{"id":"zero","name":"Zero","order":0,"note":"..."}]
  blocks           jsonb not null default '[]'::jsonb,
  target_cycles    integer not null default 1 check (target_cycles > 0),
  source           text,
  attribution      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (days_per_week_max >= days_per_week_min)
);

create table if not exists public.program_steps (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.users(id) on delete cascade,  -- NULL = global
  program_id     uuid not null references public.programs(id) on delete cascade,
  -- Stable string key used by program_progress.met and by plan payloads.
  step_key       text not null,
  step_order     integer not null check (step_order >= 0),
  name           text not null,
  -- Human-readable standard, shown in-app: "25% BW per hand × 5 reps each side".
  standard_text  text,
  -- Machine-checkable form: {"pct_bodyweight":0.25,"per_hand":true,"reps":5}
  standard       jsonb,
  exercise_slug  text,
  -- [{"equipment_missing":"sled","use_slug":"backward_treadmill_walk","note":"..."}]
  substitutions  jsonb not null default '[]'::jsonb,
  -- step_keys that must be met before this one unlocks.
  prerequisites  text[] not null default '{}',
  block          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (program_id, step_key),
  unique (program_id, step_order)
);

create index if not exists program_steps_program_idx on public.program_steps (program_id, step_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Locations & per-location equipment
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.locations (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  name                 text not null,
  kind                 public.location_kind not null default 'other',
  -- Effective weight of this location's straight bar, in pounds.
  bar_weight_lb        numeric(7,2) not null default 45 check (bar_weight_lb >= 0),
  -- Effective Smith-machine bar weight. Planet Fitness Smith machines are
  -- COUNTERBALANCED — roughly 15–20 lb, not 45 (RESEARCH §2). 20 is the
  -- default; Seth edits per club after he weighs it.
  smith_bar_weight_lb  numeric(7,2) not null default 20 check (smith_bar_weight_lb >= 0),
  -- Travel / setup overhead the engine subtracts from the time budget.
  overhead_min         integer not null default 0 check (overhead_min >= 0),
  -- The sticky default; the app pre-selects the last used location anyway.
  is_default           boolean not null default false,
  notes                text,
  -- Which preset this was cloned from, for "reset to preset".
  preset_slug          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists locations_user_idx on public.locations (user_id);

-- One row per equipment item per location. Absent row = not available.
create table if not exists public.location_equipment (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  equipment     public.equipment_slug not null,
  -- Explicit false rows are useful: "PF has no barbell" is information the
  -- engine and the swap ranker both want, not just a missing row.
  available     boolean not null default true,
  -- min_lb / max_lb are PER IMPLEMENT — the number printed on the dumbbell or
  -- the fixed bar, which is what Seth can read off the rack. The engine doubles
  -- them for load_style = 'total_dumbbell_pair' before rounding a prescription.
  min_lb        numeric(7,2) check (min_lb is null or min_lb >= 0),
  max_lb        numeric(7,2) check (max_lb is null or max_lb >= 0),
  -- Smallest step between achievable loads: 5 for a DB rack, 2.5 for Bowflex.
  increment_lb  numeric(6,2) check (increment_lb is null or increment_lb > 0),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (location_id, equipment),
  constraint location_equipment_range_ok
    check (min_lb is null or max_lb is null or max_lb >= min_lb)
);

create index if not exists location_equipment_location_idx on public.location_equipment (location_id);
create index if not exists location_equipment_user_idx     on public.location_equipment (user_id);

comment on column public.location_equipment.min_lb is
  'Per-implement minimum (the number on the dumbbell), not the total-load figure. The engine doubles it for dumbbell pairs.';
comment on column public.location_equipment.max_lb is
  'Per-implement maximum. PF dumbbells typically top out at 75; Seth''s Bowflex pair at 52.5 per hand.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Plans — AUDIT ONLY
--
--    ⚠️ CLAUDE.md invariant 4: the plan is a DERIVED VIEW over inputs and
--    history. The engine RECOMPUTES on every open. These three tables exist so
--    we can diff "what did it say yesterday?" against "what does it say now?"
--    and so the audit screen can explain a change. NOTHING READS THEM BACK AS
--    TRUTH. If you find engine or UI code loading a plan row to decide what
--    Seth does today, that is the bug.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.plans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  generated_at   timestamptz not null default now(),
  -- The day this plan was generated FOR (its "today").
  plan_date      date not null,
  week_start     date,
  -- Deterministic hash of inputs → plan. Equal signatures = identical plan;
  -- this is how we skip writing a duplicate audit row on every re-open.
  signature      text not null,
  engine_version text,
  -- Snapshots of the engine's reasoning at generation time.
  readiness      jsonb,
  ledger         jsonb,
  deload         jsonb,
  weekly         jsonb,
  input_digest   jsonb,
  warnings       text[] not null default '{}',
  created_at     timestamptz not null default now()
);

create index if not exists plans_user_date_idx  on public.plans (user_id, plan_date desc);
create unique index if not exists plans_user_signature_idx on public.plans (user_id, signature);

comment on table public.plans is
  'Persisted engine output, for audit and diffing only. Never read back as truth — the engine recomputes on every open (CLAUDE.md invariant 4).';

create table if not exists public.plan_days (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  plan_id       uuid not null references public.plans(id) on delete cascade,
  date          date not null,
  day_index     smallint not null check (day_index between 0 and 6),
  -- False for the six projected days, which assume neutral readiness.
  is_today      boolean not null default false,
  session_type  public.session_type not null,
  title         text,
  -- The single line Seth reads before deciding to show up.
  why           text,
  location_id   uuid references public.locations(id) on delete set null,
  estimated_min integer check (estimated_min is null or estimated_min >= 0),
  deload        boolean not null default false,
  -- Everything the engine chose NOT to do, and why. Powers the audit view.
  notes         text[] not null default '{}',
  -- Full PrescribedSession as the engine emitted it.
  payload       jsonb,
  created_at    timestamptz not null default now(),
  unique (plan_id, date)
);

create index if not exists plan_days_user_date_idx on public.plan_days (user_id, date desc);

create table if not exists public.plan_blocks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  plan_day_id   uuid not null references public.plan_days(id) on delete cascade,
  block_index   smallint not null check (block_index >= 0),
  -- Assembly priority order (RESEARCH §6.2):
  -- power → strength → conditioning → zone2 → mobility.
  kind          text not null check (kind in
                  ('warmup', 'power', 'strength', 'program',
                   'conditioning', 'zone2', 'mobility', 'cooldown')),
  title         text,
  estimated_min integer check (estimated_min is null or estimated_min >= 0),
  -- PrescribedExercise[] as emitted (exercise_id, sets, prediction, why…).
  exercises     jsonb not null default '[]'::jsonb,
  -- CardioPrescription, when this block is cardio.
  cardio        jsonb,
  created_at    timestamptz not null default now(),
  unique (plan_day_id, block_index)
);

create index if not exists plan_blocks_day_idx on public.plan_blocks (plan_day_id, block_index);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Sessions — what actually happened
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  date             date not null,
  type             public.session_type not null,
  location_id      uuid references public.locations(id) on delete set null,
  -- The audit row this session was started from, when it was.
  plan_day_id      uuid references public.plan_days(id) on delete set null,
  title            text,
  why              text,
  duration_min     numeric(6,2) check (duration_min is null or duration_min >= 0),
  started_at       timestamptz,
  ended_at         timestamptz,
  completed        boolean not null default false,
  -- Seth's post-session note, or the LLM's parse of a whiteboard photo.
  note             text,
  source           text not null default 'app'
                     check (source in ('app', 'telegram', 'import', 'strava', 'manual')),
  -- Readiness as assessed when the session was prescribed, kept for the
  -- readiness-vs-performance overlay on the dashboard.
  readiness_score  numeric(5,2) check (readiness_score is null or readiness_score between 0 and 100),
  readiness_band   text check (readiness_band is null or readiness_band in
                     ('push', 'as_planned', 'reduced', 'recovery')),
  -- Denormalized roll-up, refreshed on finish. Cheap dashboards.
  tonnage_lb       numeric(12,2) check (tonnage_lb is null or tonnage_lb >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sessions_time_order check (ended_at is null or started_at is null or ended_at >= started_at)
);

create index if not exists sessions_user_date_idx      on public.sessions (user_id, date desc);
create index if not exists sessions_user_type_date_idx on public.sessions (user_id, type, date desc);
create index if not exists sessions_user_completed_idx on public.sessions (user_id, date desc) where completed;

create table if not exists public.session_exercises (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  session_id      uuid not null references public.sessions(id) on delete cascade,
  exercise_id     uuid not null references public.exercises(id) on delete restrict,
  order_index     smallint not null check (order_index >= 0),
  -- Set when Seth swapped away from what the engine prescribed. The gap
  -- between prescribed and performed is a first-class metric (PRD §6: he
  -- should override <20% of sessions).
  swapped_from    uuid references public.exercises(id) on delete set null,
  -- Superset partner, when the engine paired them for time efficiency.
  superset_with   uuid references public.session_exercises(id) on delete set null,
  block_kind      text check (block_kind is null or block_kind in
                    ('warmup', 'power', 'strength', 'program',
                     'conditioning', 'zone2', 'mobility', 'cooldown')),
  -- KOT or other program step this fulfils.
  program_step_id uuid references public.program_steps(id) on delete set null,
  why             text,
  note            text,
  estimated_min   numeric(6,2) check (estimated_min is null or estimated_min >= 0),
  -- PredictionBand: {"normal":[a,b],"probable":n,"max":n,"confidence":0..1}
  prediction      jsonb,
  -- PrescribedSet[] exactly as the engine issued it, so "prescribed vs done"
  -- survives even after Seth edits every number.
  prescribed      jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (session_id, order_index)
);

create index if not exists session_exercises_session_idx  on public.session_exercises (session_id, order_index);
create index if not exists session_exercises_exercise_idx on public.session_exercises (user_id, exercise_id);

-- The set log. One row per set. This is the most-written table in the system.
create table if not exists public.sets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  set_index           smallint not null check (set_index >= 1),
  reps                integer check (reps is null or reps >= 0),
  -- TOTAL LOAD in pounds. See the conventions block at the top of this file.
  load_lb             numeric(7,2),
  rpe                 numeric(3,1) check (rpe is null or rpe between 1 and 10),
  completed           boolean not null default false,
  duration_s          integer check (duration_s is null or duration_s >= 0),
  distance_mi         numeric(8,3) check (distance_mi is null or distance_mi >= 0),
  -- Warm-up sets do not count toward the regional load ledger.
  is_warmup           boolean not null default false,
  -- Assisted movements (assisted pull-up / dip machines) record the assistance
  -- as a NEGATIVE load_lb. Every other style must be non-negative — that pair
  -- of facts is what sets_load_lb_sign enforces.
  is_assisted         boolean not null default false,
  rest_s              integer check (rest_s is null or rest_s >= 0),
  logged_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (session_exercise_id, set_index),
  constraint sets_load_lb_sign
    check (load_lb is null or load_lb >= 0 or is_assisted)
);

create index if not exists sets_session_exercise_idx on public.sets (session_exercise_id, set_index);
create index if not exists sets_user_logged_idx      on public.sets (user_id, logged_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Cardio & Strava
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cardio_logs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  session_id          uuid references public.sessions(id) on delete set null,
  date                date not null,
  modality            public.cardio_modality not null,
  structure           text check (structure is null or structure in
                        ('steady', 'intervals', 'walk_run', 'sprints', 'ruck')),
  duration_min        numeric(7,2) check (duration_min is null or duration_min >= 0),
  distance_mi         numeric(8,3) check (distance_mi is null or distance_mi >= 0),
  avg_hr              integer check (avg_hr is null or avg_hr between 20 and 250),
  max_hr              integer check (max_hr is null or max_hr between 20 and 250),
  -- Minutes per zone, computed from the Strava HR stream (we compute these
  -- ourselves — Strava's /zones endpoint needs a paid subscription).
  -- {"z1":12,"z2":30,"z3":4,"z4":0,"z5":0}
  zone_minutes        jsonb not null default '{}'::jsonb,
  rpe                 numeric(3,1) check (rpe is null or rpe between 1 and 10),
  source              text not null default 'manual'
                        check (source in ('strava', 'manual', 'import')),
  strava_activity_id  text,
  -- The CardioPrescription this was measured against, if any.
  prescribed          jsonb,
  -- 0–1: did the run hit the prescribed zone and duration?
  compliance          numeric(4,3) check (compliance is null or compliance between 0 and 1),
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists cardio_logs_user_date_idx on public.cardio_logs (user_id, date desc);
create index if not exists cardio_logs_session_idx   on public.cardio_logs (session_id) where session_id is not null;

-- Raw-ish mirror of Strava, so a webhook replay or a reconcile is idempotent
-- and we never re-hit the API for something we already have.
create table if not exists public.strava_activities (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.users(id) on delete cascade,
  strava_activity_id      bigint not null,
  athlete_id              bigint,
  name                    text,
  sport_type              text,
  start_date              timestamptz,
  start_date_local        timestamptz,
  -- Local calendar day, denormalized so (user_id, date) lookups stay cheap.
  local_date              date,
  distance_mi             numeric(8,3) check (distance_mi is null or distance_mi >= 0),
  moving_time_s           integer check (moving_time_s is null or moving_time_s >= 0),
  elapsed_time_s          integer check (elapsed_time_s is null or elapsed_time_s >= 0),
  total_elevation_gain_ft numeric(8,2),
  average_hr              numeric(5,1),
  max_hr                  numeric(5,1),
  average_speed_mph       numeric(6,2),
  calories                numeric(8,2),
  has_heartrate           boolean not null default false,
  -- Downsampled HR/pace stream summary — full streams are too big for the
  -- 500 MB free tier, and we only need what feeds the zone computation.
  streams_summary         jsonb,
  zone_minutes            jsonb not null default '{}'::jsonb,
  raw                     jsonb,
  cardio_log_id           uuid references public.cardio_logs(id) on delete set null,
  synced_at               timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (user_id, strava_activity_id)
);

create index if not exists strava_activities_user_date_idx on public.strava_activities (user_id, local_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Daily inputs — Oura, sliders, body metrics
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.oura_daily (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  date                  date not null,
  readiness_score       integer check (readiness_score is null or readiness_score between 0 and 100),
  sleep_score           integer check (sleep_score is null or sleep_score between 0 and 100),
  activity_score        integer check (activity_score is null or activity_score between 0 and 100),
  hrv_ms                numeric(6,2) check (hrv_ms is null or hrv_ms >= 0),
  resting_hr            numeric(5,1) check (resting_hr is null or resting_hr between 20 and 150),
  body_temp_deviation_c numeric(4,2),
  respiratory_rate      numeric(4,1) check (respiratory_rate is null or respiratory_rate >= 0),
  steps                 integer check (steps is null or steps >= 0),
  active_calories       integer check (active_calories is null or active_calories >= 0),
  met_minutes           numeric(8,2) check (met_minutes is null or met_minutes >= 0),
  -- Dashboard-grade longevity markers, free on the Oura API.
  vo2max                numeric(5,2) check (vo2max is null or vo2max >= 0),
  cardiovascular_age    numeric(5,1),
  stress_high_min       integer check (stress_high_min is null or stress_high_min >= 0),
  resilience            text check (resilience is null or resilience in
                          ('limited', 'adequate', 'solid', 'strong', 'exceptional')),
  -- Untouched API payloads, so a contributor field we ignore today is still
  -- there tomorrow without a backfill.
  raw                   jsonb,
  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists oura_daily_user_date_idx on public.oura_daily (user_id, date desc);

-- The three tappable sliders. The fallback when Oura is missing or the ring
-- is on the charger (CLAUDE.md invariant 2 — every integration degrades).
create table if not exists public.self_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  date       date not null,
  -- 1 = wrecked, 5 = fresh.
  soreness   smallint not null check (soreness between 1 and 5),
  -- 1 = flat, 5 = energized.
  energy     smallint not null check (energy between 1 and 5),
  -- 1 = calm, 5 = maxed out. NOTE: higher is WORSE for stress.
  stress     smallint not null check (stress between 1 and 5),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists self_reports_user_date_idx on public.self_reports (user_id, date desc);

create table if not exists public.body_metrics (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  date          date not null,
  weight_lb     numeric(6,2) not null check (weight_lb > 0),
  body_fat_pct  numeric(5,2) check (body_fat_pct is null or body_fat_pct between 0 and 100),
  lean_mass_lb  numeric(6,2) check (lean_mass_lb is null or lean_mass_lb >= 0),
  -- The Wyze scale has no public API: 'scale_photo' means the bot asked and
  -- vision-parsed the screenshot Seth sent back.
  source        text not null default 'manual'
                  check (source in ('manual', 'scale_photo', 'import')),
  photo_url     text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists body_metrics_user_date_idx on public.body_metrics (user_id, date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Injury & rehab register
--     Injuries never disappear on their own — Seth resolves them.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.injuries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  region       public.region not null,
  label        text not null,
  onset        date,
  kind         text not null default 'recent' check (kind in ('recent', 'longstanding')),
  -- 0 = none, 10 = worst imaginable. A ≥2-point rise in 24 h regresses the
  -- program one step (RESEARCH §6.3).
  current_pain smallint not null default 0 check (current_pain between 0 and 10),
  -- Movements or patterns that provoke it — slugs or free text.
  aggravators  text[] not null default '{}',
  notes        text,
  resolved_on  date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists injuries_user_active_idx on public.injuries (user_id) where resolved_on is null;
create index if not exists injuries_user_region_idx on public.injuries (user_id, region);

create table if not exists public.injury_checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  injury_id  uuid not null references public.injuries(id) on delete cascade,
  date       date not null,
  pain       smallint not null check (pain between 0 and 10),
  note       text,
  -- 'telegram' for the weekly bot check-in, 'app' for the in-session prompt.
  source     text not null default 'telegram' check (source in ('app', 'telegram', 'import')),
  created_at timestamptz not null default now(),
  unique (injury_id, date)
);

create index if not exists injury_checkins_user_date_idx on public.injury_checkins (user_id, date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Program progress & goals
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.program_progress (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  program_id       uuid not null references public.programs(id) on delete cascade,
  -- KOT target is 2 full cycles.
  cycle            integer not null default 1 check (cycle > 0),
  is_active        boolean not null default true,
  -- step_key → {"date":"2026-09-20","evidence":"3×5 @ 45 lb, RPE 7"}
  met              jsonb not null default '{}'::jsonb,
  current_step_ids text[] not null default '{}',
  started_on       date,
  completed_on     date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, program_id, cycle)
);

create index if not exists program_progress_active_idx on public.program_progress (user_id) where is_active;

-- One row per athlete. The defaults are the evidence defaults from RESEARCH
-- §6.1; changing mode re-solves the week.
create table if not exists public.goal_settings (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users(id) on delete cascade,
  mode                   public.goal_mode not null default 'maintain',
  -- Athletic north star: drives plyo/power slot priority.
  vertical_jump_focus    boolean not null default true,
  warmup_min             integer not null default 8 check (warmup_min >= 0),
  cooldown_min           integer not null default 5 check (cooldown_min >= 0),
  -- When true, warm-up/cooldown sit ON TOP of the stated budget (PRD §8.1).
  warmup_outside_budget  boolean not null default true,
  default_budget_min     integer not null default 30 check (default_budget_min > 0),
  default_location_id    uuid references public.locations(id) on delete set null,
  active_program_id      uuid references public.programs(id) on delete set null,
  -- Overrides for the weekly template (strength days, zone2 target, etc.).
  weekly_template        jsonb not null default '{}'::jsonb,
  -- 06:30 local by default (PRD §8.8).
  bot_brief_hour_local   smallint not null default 6 check (bot_brief_hour_local between 0 and 23),
  bot_brief_minute_local smallint not null default 30 check (bot_brief_minute_local between 0 and 59),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. LLM job queue — the Mac mini's inbox
--
--     The mini is OUTBOUND-ONLY (CLAUDE.md invariant 3). It polls this table
--     every ~15 s, claims a row, calls LM Studio at http://localhost:1234/v1,
--     and writes the result back. No tunnels, no inbound ports.
--
--     ⏱  A job still 'queued' past its deadline_at (default: created_at + 60 s)
--        is picked up by the Vercel Gemini free-tier fallback, which writes the
--        same result shape and sets status = 'fallback'. If Gemini is also
--        unavailable the caller falls back to deterministic template copy —
--        the today card NEVER blocks on this table.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.llm_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  -- 'why_copy' | 'telegram_reply' | 'photo_parse' | 'weekly_narrative' | …
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  result      jsonb,
  status      public.llm_job_status not null default 'queued',
  -- Worker identity, e.g. 'mac-mini-1' or 'vercel-gemini'.
  claimed_by  text,
  claimed_at  timestamptz,
  -- Unclaimed past this instant → the Gemini fallback takes it. 60 s.
  deadline_at timestamptz not null default (now() + interval '60 seconds'),
  attempts    smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 3 check (max_attempts > 0),
  error       text,
  priority    smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  completed_at timestamptz
);

-- The worker's poll runs several times a minute forever. This partial index
-- keeps it to a tiny index scan over only the queued rows.
create index if not exists llm_jobs_queued_idx
  on public.llm_jobs (status, created_at) where status = 'queued';
-- The fallback sweeper's query: queued AND past deadline.
create index if not exists llm_jobs_deadline_idx
  on public.llm_jobs (deadline_at) where status = 'queued';
create index if not exists llm_jobs_user_created_idx on public.llm_jobs (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Telegram transcript, CSV imports, integration credentials
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bot_messages (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  direction           text not null check (direction in ('inbound', 'outbound')),
  channel             text not null default 'telegram' check (channel in ('telegram', 'web', 'system')),
  -- 'daily_brief' | 'session_summary' | 'weekly_report' | 'scale_prompt'
  -- | 'injury_checkin' | 'freeform' | 'photo'
  kind                text not null default 'freeform',
  chat_id             text,
  telegram_message_id bigint,
  body                text,
  -- Buttons offered, intent classified, tool calls made, media file_id…
  payload             jsonb not null default '{}'::jsonb,
  media_url           text,
  -- Set when this message produced a log (session, body metric, check-in).
  session_id          uuid references public.sessions(id) on delete set null,
  llm_job_id          uuid references public.llm_jobs(id) on delete set null,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists bot_messages_user_created_idx on public.bot_messages (user_id, created_at desc);

-- Generic CSV importer (Fitbod, Strong, Hevy, …) → fuzzy exercise match →
-- review screen → seeds history and predictions.
create table if not exists public.imports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  source         text not null default 'csv',
  filename       text,
  -- Supabase Storage path; the file itself is never stored in a column.
  storage_path   text,
  status         text not null default 'uploaded'
                   check (status in ('uploaded', 'parsing', 'review', 'applied', 'failed')),
  -- Detected column → canonical field, as confirmed on the review screen.
  mapping        jsonb not null default '{}'::jsonb,
  row_count      integer check (row_count is null or row_count >= 0),
  matched_count  integer check (matched_count is null or matched_count >= 0),
  -- Names the fuzzy matcher could not resolve, awaiting Seth's decision.
  unmatched      jsonb not null default '[]'::jsonb,
  error          text,
  applied_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists imports_user_created_idx on public.imports (user_id, created_at desc);

-- ⚠️ SECRETS LIVE HERE.
--
-- Every *_token / secret column stores a value that the APPLICATION LAYER has
-- already ENCRYPTED AT REST (AES-GCM with a key from the server-side env,
-- never the anon key) BEFORE the insert. Nothing in this table is ever written
-- or read as plaintext, including by the Mac mini worker. Postgres sees
-- ciphertext; only the Vercel server runtime and the worker hold the key.
-- RLS additionally restricts every row to its owner, and the anon key must
-- never be used to read this table.
create table if not exists public.integration_tokens (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  provider            text not null check (provider in ('oura', 'strava', 'telegram', 'gemini')),
  -- Oura PATs do not expire; Strava access tokens last ~6 h and rotate via the
  -- refresh token. Both arrive here already encrypted.
  access_token        text,
  refresh_token       text,
  expires_at          timestamptz,
  scope               text,
  external_account_id text,
  -- Non-secret provider metadata only (athlete name, webhook subscription id).
  meta                jsonb not null default '{}'::jsonb,
  last_sync_at        timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, provider)
);

comment on table public.integration_tokens is
  'Oura / Strava / Telegram credentials. Values are ENCRYPTED BY THE APPLICATION before insert — never plaintext. Service-role access only in practice.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. updated_at triggers
--     One loop, so no table can be forgotten. Re-running is safe.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  tables text[] := array[
    'users', 'equipment_catalog', 'exercises', 'exercise_media',
    'programs', 'program_steps', 'locations', 'location_equipment',
    'sessions', 'session_exercises', 'sets', 'cardio_logs',
    'strava_activities', 'oura_daily', 'self_reports', 'body_metrics',
    'injuries', 'program_progress', 'goal_settings', 'llm_jobs',
    'imports', 'integration_tokens'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- End of 0001. Next: 0002_rls.sql turns row level security on for every table.
-- ═════════════════════════════════════════════════════════════════════════════

-- == 0002_rls.sql ==

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

-- == 0003_seed_equipment.sql ==

-- ═════════════════════════════════════════════════════════════════════════════
-- 0003_seed_equipment.sql — Longevity OS · the global equipment catalog
-- ═════════════════════════════════════════════════════════════════════════════
-- One row per slug in the EQUIPMENT const in packages/engine/src/types.ts —
-- all 60 of them, in the same order, so a diff between this file and that one
-- is a straight line-up. These rows are GLOBAL: user_id is null.
--
-- `notes` is where the real world gets recorded. The engine reads bar weights
-- and DB ranges from location_equipment (per club), but these notes are what
-- Seth sees on the tappable equipment card, and they are the defaults the
-- presets in 0004 copy from.
--
-- Categories: free_weight · machine · cardio · accessory · bodyweight · rack_bench
--
-- No locations are inserted here. Locations are per-user and belong to
-- 0004_seed_presets.sql.
--
-- Re-runnable: `on conflict (slug) where user_id is null do update` refreshes
-- names, categories and notes without touching Seth's private rows or the ids
-- that location_equipment might already reference.
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.equipment_catalog (user_id, slug, display_name, category, notes, sort_order) values
  -- ── bodyweight ─────────────────────────────────────────────────────────────
  (null, 'bodyweight',              'Bodyweight',                 'bodyweight',  'Always available, everywhere. The engine assumes it at every location.', 10),
  (null, 'wall_space',              'Wall space',                 'bodyweight',  'Wall sits, handstand holds, and the vertical-jump chalk test.', 20),

  -- ── free weights ───────────────────────────────────────────────────────────
  (null, 'dumbbell',                'Dumbbells (fixed)',          'free_weight', 'PF dumbbells typically 5–75 lb in 5 lb steps; some clubs cap at 60, some Black Card clubs reach 80. Log TOTAL load — both hands summed.', 100),
  (null, 'adjustable_dumbbell',     'Adjustable dumbbells',       'free_weight', 'Home: Bowflex pair to 52.5 lb per hand, 2.5 lb increments. Total-load convention means 105 lb is the pair ceiling.', 110),
  (null, 'barbell',                 'Olympic barbell',            'free_weight', 'NOT at Planet Fitness. 45 lb bar unless the location says otherwise. Every barbell lift needs a barbell_free alternative.', 120),
  (null, 'ez_curl_bar',             'EZ curl bar',                'free_weight', 'PF stocks FIXED EZ bars, roughly 20–70 lb, not a loadable one.', 130),
  (null, 'fixed_barbell',           'Fixed-weight barbells',      'free_weight', 'Straight and EZ, 20–70 lb in 10 lb steps at most PF clubs. The PF substitute for RDLs and rows.', 140),
  (null, 'trap_bar',                'Trap / hex bar',             'free_weight', 'Not at PF. Useful for the deadlift strength standard behind depth jumps.', 150),
  (null, 'kettlebell',              'Kettlebells',                'free_weight', 'Not at PF. Swings substitute with a single dumbbell.', 160),
  (null, 'bumper_plates',           'Bumper plates',              'free_weight', 'CrossFit box only. PF has no bumpers and no dropping.', 170),

  -- ── racks, benches, bars you hang from ─────────────────────────────────────
  (null, 'power_rack',              'Power / squat rack',         'rack_bench',  'NOT at Planet Fitness — no racks, no platforms. Squats there run through the Smith machine.', 200),
  (null, 'bench_flat',              'Flat bench',                 'rack_bench',  NULL, 210),
  (null, 'bench_adjustable',        'Adjustable bench',           'rack_bench',  'Home bench inclines and declines, and anchors Nordic curls.', 220),
  (null, 'nordic_support',          'Nordic / ankle anchor',      'rack_bench',  'Nordic hamstring curls cut hamstring injuries ~50% (van Dyk 2019). Seth''s home bench supports them — program 1–2×/week.', 230),
  (null, 'pull_up_bar',             'Pull-up bar',                'rack_bench',  NULL, 240),
  (null, 'dip_station',             'Dip station / parallel bars','rack_bench',  NULL, 250),
  (null, 'back_extension_bench',    'Back extension bench',       'rack_bench',  '45° or horizontal hyper. Present at most PF clubs.', 260),
  (null, 'ghd',                     'GHD',                        'rack_bench',  'CrossFit box only. Never at PF.', 270),

  -- ── machines ───────────────────────────────────────────────────────────────
  (null, 'smith_machine',           'Smith machine',              'machine',     'Smith bar counterbalanced, ~15–20 lb effective — NOT 45. Set smith_bar_weight_lb per club; default 20. PF has 2–3 of them.', 300),
  (null, 'assisted_pullup_machine', 'Assisted pull-up / dip',     'machine',     'Assistance is logged as a NEGATIVE load_lb (load_style = assisted).', 310),
  (null, 'cable_machine',           'Cable tower',                'machine',     'Dual adjustable pulleys at most PF clubs.', 320),
  (null, 'functional_trainer',      'Functional trainer',         'machine',     'The barbell-free answer for rotation, anti-rotation and chops.', 330),
  (null, 'selectorized_machine',    'Selectorized machine (other)','machine',    'Catch-all for the plate-stack line — Life Fitness, Hammer Strength, Cybex, Precor.', 340),
  (null, 'leg_press',               'Leg press',                  'machine',     NULL, 350),
  (null, 'leg_extension',           'Leg extension',              'machine',     'Useful for KOT knee work when a sled is unavailable.', 360),
  (null, 'leg_curl',                'Leg curl',                   'machine',     NULL, 370),
  (null, 'hip_abductor_adductor',   'Hip abductor / adductor',    'machine',     NULL, 380),
  (null, 'calf_machine',            'Calf raise machine',         'machine',     NULL, 390),
  (null, 'chest_press_machine',     'Chest press machine',        'machine',     NULL, 400),
  (null, 'shoulder_press_machine',  'Shoulder press machine',     'machine',     NULL, 410),
  (null, 'lat_pulldown',            'Lat pulldown',               'machine',     NULL, 420),
  (null, 'seated_row',              'Seated row',                 'machine',     NULL, 430),
  (null, 'pec_deck',                'Pec deck / rear delt',       'machine',     NULL, 440),
  (null, 'ab_crunch_machine',       'Ab crunch machine',          'machine',     'Loaded spinal flexion — the engine avoids it while low-back pain is active.', 450),

  -- ── cardio ─────────────────────────────────────────────────────────────────
  (null, 'treadmill',               'Treadmill',                  'cardio',      'Doubles as the PF backward-sled substitute: walk backward on a POWERED-OFF belt (RESEARCH §2).', 500),
  (null, 'elliptical',              'Elliptical',                 'cardio',      NULL, 510),
  (null, 'arc_trainer',             'Arc trainer',                'cardio',      'Cybex Arc. Common at PF; low-impact Zone 2 on a heavy-legs day.', 520),
  (null, 'stair_climber',           'Stair climber',              'cardio',      NULL, 530),
  (null, 'stationary_bike',         'Upright bike',               'cardio',      'Preferred Zone 2 within 24 h of a heavy lower-body day — cycling interferes less than running (RESEARCH §6.2).', 540),
  (null, 'recumbent_bike',          'Recumbent bike',             'cardio',      NULL, 550),
  (null, 'rower',                   'Rower',                      'cardio',      'At many but not all PF clubs — check the box per location.', 560),
  (null, 'ski_erg',                 'Ski erg',                    'cardio',      'CrossFit box. Not at PF.', 570),
  (null, 'assault_bike',            'Air / assault bike',         'cardio',      'CrossFit box. Not at PF.', 580),
  (null, 'track_or_open_space',     'Track or open space',        'cardio',      '10–30 m accelerations need ~40 m of clear run-out.', 590),
  (null, 'outdoor_route',           'Outdoor route',              'cardio',      'Walk-run progressions, rucks, Zone 2 and backward walking from the front door.', 600),

  -- ── accessories ────────────────────────────────────────────────────────────
  (null, 'resistance_bands',        'Resistance bands',           'accessory',   'Band tension is approximate — tracked by colour mapping, not by a scale.', 700),
  (null, 'suspension_trainer',      'Suspension trainer',         'accessory',   'TRX-style. Turns rows and split squats into travel movements.', 710),
  (null, 'medicine_ball',           'Medicine ball',              'accessory',   'PF stretching area stocks these.', 720),
  (null, 'slam_ball',               'Slam ball',                  'accessory',   'Check PF club rules before programming slams.', 730),
  (null, 'stability_ball',          'Stability ball',             'accessory',   'PF stretching area.', 740),
  (null, 'bosu',                    'BOSU',                       'accessory',   NULL, 750),
  (null, 'foam_roller',             'Foam roller',                'accessory',   NULL, 760),
  (null, 'yoga_mat',                'Yoga mat',                   'accessory',   'The floor for McGill Big 3, mobility and the daily rehab floor.', 770),
  (null, 'slant_board',             'Slant board',                'accessory',   'KOT Jefferson curls and ATG squats. DIY wedge or a stack of plates works.', 780),
  (null, 'tibialis_bar',            'Tibialis bar',               'accessory',   'KOT tib raises, 25% BW 5×5 standard. Substitute: a dumbbell held between the feet, or a band.', 790),
  (null, 'sled',                    'Sled',                       'accessory',   'Backward sled ≈50% BW is the KOT knee entry point. Not at home or PF — substitute backward treadmill (off) or backward walking.', 800),
  (null, 'plyo_box',                'Plyo box',                   'accessory',   'Box jumps STEP DOWN, always. Benches substitute for step-ups at PF.', 810),
  (null, 'jump_rope',               'Jump rope',                  'accessory',   'Cheap plyo contacts — count them against the 40–100/session ceiling.', 820),
  (null, 'rings',                   'Gymnastic rings',            'accessory',   'CrossFit box or a home bar.', 830),
  (null, 'chalk',                   'Chalk',                      'accessory',   'Banned at Planet Fitness. Grip-limited pulls need straps or a different lift there.', 840),
  -- Named by the source exercise corpora. The ingest reports vocabulary it
  -- cannot map rather than coercing it into a near neighbour, and these five
  -- are what that report asked for.
  (null, 'ab_wheel',                'Ab wheel',                   'accessory',   'Wheel roller. Anti-extension work; brutal and cheap.', 850),
  (null, 'battle_rope',             'Battle rope',                'accessory',   'Conditioning. Some CrossFit boxes; never Planet Fitness.', 860),
  (null, 'sledgehammer',            'Sledgehammer',               'accessory',   'Tire striking. Box equipment.', 870),
  (null, 'tire',                    'Tire',                       'accessory',   'Flipping and striking. Box equipment.', 880),
  (null, 'arm_ergometer',           'Upper body ergometer',       'cardio',      'Arm bike. Genuinely useful Zone 2 on a day the lower body is recovering.', 890)
on conflict (slug) where user_id is null do update set
  display_name = excluded.display_name,
  category     = excluded.category,
  notes        = excluded.notes,
  sort_order   = excluded.sort_order,
  updated_at   = now();

-- Assertion: the catalog must cover the whole enum. If types.ts gains a slug
-- and this file does not, the migration fails here rather than silently
-- leaving an item Seth can never tick on a location checklist.
do $$
declare missing text;
begin
  select string_agg(e.slug::text, ', ' order by e.slug::text) into missing
  from (select unnest(enum_range(null::public.equipment_slug)) as slug) e
  where not exists (
    select 1 from public.equipment_catalog c
    where c.user_id is null and c.slug = e.slug
  );

  if missing is not null then
    raise exception 'equipment_catalog is missing global rows for: %', missing;
  end if;
end $$;

-- == 0004_seed_presets.sql ==

-- ═════════════════════════════════════════════════════════════════════════════
-- 0004_seed_presets.sql — Longevity OS · location presets
-- ═════════════════════════════════════════════════════════════════════════════
-- A preset is a reusable equipment checklist. Applying one CREATES A LOCATION
-- for an athlete and fills in its location_equipment rows.
--
--   select public.apply_location_preset('<user-uuid>', 'planet_fitness_standard',
--                                       'PF — Rochester Hills');
--
-- ⚠️ SETH CLONES THE PF PRESET PER CLUB AND EDITS IT. Planet Fitness equipment
-- varies by franchise — one club stops the dumbbells at 60, another reaches 80,
-- some have rowers and some do not. Apply the preset once per club with a
-- distinct name, then tick the checklist against reality on the first visit.
-- The same is true of the Smith bar: 20 lb is a default, not a measurement.
--
-- Four presets ship here:
--   home                      — Seth's basement (PRD §5)
--   planet_fitness_standard   — the honest PF inventory (RESEARCH §2)
--   crossfit_box_typical      — drop-in box, logged as an external session
--   bodyweight_only           — travel; a hotel room and a pair of shoes
--
-- Rows with `available = false` are deliberate, not omissions. "PF has no
-- barbell" is something the engine and the swap ranker both want to know.
--
-- No user rows are created by this migration — it only defines the presets.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Preset tables (shared reference data — user_id null = global)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.location_presets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references public.users(id) on delete cascade,  -- NULL = global
  slug                text not null,
  name                text not null,
  kind                public.location_kind not null default 'other',
  bar_weight_lb       numeric(7,2) not null default 45 check (bar_weight_lb >= 0),
  smith_bar_weight_lb numeric(7,2) not null default 20 check (smith_bar_weight_lb >= 0),
  overhead_min        integer not null default 0 check (overhead_min >= 0),
  description         text,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists location_presets_global_slug_idx
  on public.location_presets (slug) where user_id is null;
create unique index if not exists location_presets_user_slug_idx
  on public.location_presets (user_id, slug) where user_id is not null;

create table if not exists public.location_preset_equipment (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users(id) on delete cascade,  -- NULL = global
  preset_id    uuid not null references public.location_presets(id) on delete cascade,
  equipment    public.equipment_slug not null,
  available    boolean not null default true,
  -- min_lb / max_lb are PER IMPLEMENT — the number printed on the dumbbell or
  -- the fixed bar, which is what Seth can read off the rack. The engine doubles
  -- them for load_style = 'total_dumbbell_pair'.
  min_lb       numeric(7,2) check (min_lb is null or min_lb >= 0),
  max_lb       numeric(7,2) check (max_lb is null or max_lb >= 0),
  increment_lb numeric(6,2) check (increment_lb is null or increment_lb > 0),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (preset_id, equipment),
  constraint location_preset_equipment_range_ok
    check (min_lb is null or max_lb is null or max_lb >= min_lb)
);

create index if not exists location_preset_equipment_preset_idx
  on public.location_preset_equipment (preset_id);

-- updated_at triggers for the two new tables.
do $$
declare t text;
begin
  foreach t in array array['location_presets', 'location_preset_equipment'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- RLS, in the reference-table shape from 0002: everyone reads the global
-- presets, nobody but the owner writes their own.
do $$
declare
  t       text;
  grantee text := '';
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grantee := ' to authenticated';
  end if;

  foreach t in array array['location_presets', 'location_preset_equipment'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_global_or_own', t);
    execute format(
      'create policy %I on public.%I for select%s using (user_id is null or user_id = auth.uid())',
      t || '_select_global_or_own', t, grantee);

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
-- 2. The presets themselves
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.location_presets
  (user_id, slug, name, kind, bar_weight_lb, smith_bar_weight_lb, overhead_min, description, sort_order)
values
  (null, 'home', 'Home', 'home', 45, 20, 0,
   'Bowflex adjustable dumbbells to 52.5 lb per hand in 2.5 lb steps, adjustable flat/incline bench with Nordic support, pull-up bar, resistance bands, yoga mat, wall space, and the front door for outdoor work.', 10),

  (null, 'planet_fitness_standard', 'Planet Fitness — standard', 'planet_fitness', 0, 20, 15,
   'The honest standard-club inventory: no barbells, racks, bumper plates, chalk or GHD. Smith machines, dumbbells 5–75, fixed straight and EZ bars 20–70, cable towers and functional trainers, the full selectorized line, and a wall of cardio. Clone this per club and edit.', 20),

  (null, 'crossfit_box_typical', 'CrossFit box — typical', 'crossfit_box', 45, 20, 15,
   'Drop-in box: barbells and bumpers, racks, kettlebells, rings, GHD, boxes, ropes, ergs, sled, chalk. Logged as an external session — the class decides, not the engine.', 30),

  (null, 'bodyweight_only', 'Bodyweight only (travel)', 'bodyweight_only', 0, 0, 0,
   'A hotel room, a mat, a wall and a pair of shoes. Everything the engine prescribes here is bodyweight, mobility, or out the door.', 40)
on conflict (slug) where user_id is null do update set
  name                = excluded.name,
  kind                = excluded.kind,
  bar_weight_lb       = excluded.bar_weight_lb,
  smith_bar_weight_lb = excluded.smith_bar_weight_lb,
  overhead_min        = excluded.overhead_min,
  description         = excluded.description,
  sort_order          = excluded.sort_order,
  updated_at          = now();

-- ── Home ─────────────────────────────────────────────────────────────────────
insert into public.location_preset_equipment
  (user_id, preset_id, equipment, available, min_lb, max_lb, increment_lb, notes)
select null, p.id, v.equipment::public.equipment_slug, v.available, v.min_lb, v.max_lb, v.increment_lb, v.notes
from public.location_presets p
cross join (values
  ('bodyweight'::text,       true,  null::numeric, null::numeric, null::numeric, null::text),
  ('adjustable_dumbbell',    true,  5,    52.5, 2.5, 'Bowflex pair. 52.5 lb per hand — total-load ceiling is 105 lb.'),
  ('bench_adjustable',       true,  null, null, null, 'Flat, incline and decline.'),
  ('bench_flat',             true,  null, null, null, 'The adjustable bench laid flat.'),
  ('nordic_support',         true,  null, null, null, 'Ankles anchored under the bench. Nordics 1–2×/week.'),
  ('pull_up_bar',            true,  null, null, null, null),
  ('resistance_bands',       true,  null, null, null, 'Band tension approximate; tracked by colour.'),
  ('yoga_mat',               true,  null, null, null, 'McGill Big 3 and the daily mobility floor.'),
  ('wall_space',             true,  null, null, null, 'Also where the vertical-jump chalk test lives.'),
  ('outdoor_route',          true,  null, null, null, 'Walk-run, Zone 2, rucks and backward walking.'),
  ('foam_roller',            true,  null, null, null, null),
  ('barbell',                false, null, null, null, 'No barbell at home — every barbell lift needs a barbell_free alternative.'),
  ('power_rack',             false, null, null, null, null),
  ('smith_machine',          false, null, null, null, null),
  ('cable_machine',          false, null, null, null, 'Bands stand in for cable work.'),
  ('sled',                   false, null, null, null, 'Backward walking outdoors or down the hallway replaces the sled.'),
  ('plyo_box',               false, null, null, null, 'Step-ups use the bench.'),
  ('treadmill',              false, null, null, null, null)
) as v(equipment, available, min_lb, max_lb, increment_lb, notes)
where p.slug = 'home' and p.user_id is null
on conflict (preset_id, equipment) do update set
  available    = excluded.available,
  min_lb       = excluded.min_lb,
  max_lb       = excluded.max_lb,
  increment_lb = excluded.increment_lb,
  notes        = excluded.notes,
  updated_at   = now();

-- ── Planet Fitness — standard (RESEARCH §2) ──────────────────────────────────
insert into public.location_preset_equipment
  (user_id, preset_id, equipment, available, min_lb, max_lb, increment_lb, notes)
select null, p.id, v.equipment::public.equipment_slug, v.available, v.min_lb, v.max_lb, v.increment_lb, v.notes
from public.location_presets p
cross join (values
  -- present
  ('bodyweight'::text,        true,  null::numeric, null::numeric, null::numeric, null::text),
  ('wall_space',              true,  null, null, null, null),
  ('dumbbell',                true,  5,    75,   5,    'Typically 5–75 lb. Some clubs cap at 60; some Black Card clubs reach 80. Check on the first visit.'),
  ('fixed_barbell',           true,  20,   70,   10,   'Fixed straight bars. The PF answer for RDLs and rows — floor deadlifts are not permitted.'),
  ('ez_curl_bar',             true,  20,   70,   10,   'Fixed EZ bars, not a loadable one.'),
  ('smith_machine',           true,  null, null, 5,    'Counterbalanced: ~15–20 lb effective bar, NOT 45. Two or three per club. Weigh it and set smith_bar_weight_lb.'),
  ('bench_flat',              true,  null, null, null, null),
  ('bench_adjustable',        true,  null, null, null, 'Also the step-up platform, since there are no plyo boxes.'),
  ('back_extension_bench',    true,  null, null, null, null),
  ('assisted_pullup_machine', true,  null, null, null, 'Assistance logs as a NEGATIVE load_lb.'),
  ('cable_machine',           true,  null, null, 5,    'Dual adjustable pulleys.'),
  ('functional_trainer',      true,  null, null, 5,    'Rotation, anti-rotation and chops without a barbell.'),
  ('selectorized_machine',    true,  null, null, 5,    'Life Fitness / Hammer Strength / Cybex / Precor line.'),
  ('leg_press',               true,  null, null, null, null),
  ('leg_extension',           true,  null, null, null, null),
  ('leg_curl',                true,  null, null, null, null),
  ('hip_abductor_adductor',   true,  null, null, null, null),
  ('calf_machine',            true,  null, null, null, null),
  ('chest_press_machine',     true,  null, null, null, null),
  ('shoulder_press_machine',  true,  null, null, null, null),
  ('lat_pulldown',            true,  null, null, null, null),
  ('seated_row',              true,  null, null, null, null),
  ('pec_deck',                true,  null, null, null, 'Fly and rear-delt.'),
  ('ab_crunch_machine',       true,  null, null, null, 'Loaded spinal flexion — skipped while low-back pain is active.'),
  ('treadmill',               true,  null, null, null, 'Backward walking on a POWERED-OFF belt is the KOT sled substitute.'),
  ('elliptical',              true,  null, null, null, null),
  ('arc_trainer',             true,  null, null, null, 'Low-impact Zone 2 the day after heavy legs.'),
  ('stair_climber',           true,  null, null, null, null),
  ('stationary_bike',         true,  null, null, null, null),
  ('recumbent_bike',          true,  null, null, null, null),
  ('rower',                   true,  null, null, null, 'At many clubs but NOT all — confirm on the first visit.'),
  ('yoga_mat',                true,  null, null, null, 'Stretching / abs area.'),
  ('medicine_ball',           true,  null, null, null, 'Stretching area.'),
  ('stability_ball',          true,  null, null, null, 'Stretching area.'),
  ('foam_roller',             true,  null, null, null, null),
  -- absent, and the engine needs to know it
  ('barbell',                 false, null, null, null, 'No Olympic barbells at a standard club.'),
  ('power_rack',              false, null, null, null, 'No racks, no platforms. Squats go through the Smith machine.'),
  ('bumper_plates',           false, null, null, null, 'No bumpers, no dropping.'),
  ('chalk',                   false, null, null, null, 'Banned. Grip-limited pulls need straps or a different lift.'),
  ('ghd',                     false, null, null, null, null),
  ('trap_bar',                false, null, null, null, null),
  ('kettlebell',              false, null, null, null, 'Swings substitute with a single dumbbell.'),
  ('sled',                    false, null, null, null, 'Substitute: backward walking on a powered-off treadmill.'),
  ('plyo_box',                false, null, null, null, 'Substitute: step-ups on a bench.'),
  ('pull_up_bar',             false, null, null, null, 'Only the assisted pull-up machine.'),
  ('dip_station',             false, null, null, null, 'Only the assisted dip station.'),
  ('nordic_support',          false, null, null, null, 'No ankle anchor — Nordics stay a home movement.'),
  ('slant_board',             false, null, null, null, 'Bring a wedge, or stack two 45s.'),
  ('tibialis_bar',            false, null, null, null, 'Substitute: a dumbbell held between the feet.'),
  ('rings',                   false, null, null, null, null),
  ('ski_erg',                 false, null, null, null, null),
  ('assault_bike',            false, null, null, null, null),
  ('slam_ball',               false, null, null, null, 'Slams are usually against club rules — ask before programming them.'),
  ('jump_rope',               false, null, null, null, 'Bring your own and check the club is fine with it.'),
  ('suspension_trainer',      false, null, null, null, null),
  ('track_or_open_space',     false, null, null, null, 'No room to sprint. Accelerations move outdoors or to a treadmill.'),
  ('outdoor_route',           false, null, null, null, null)
) as v(equipment, available, min_lb, max_lb, increment_lb, notes)
where p.slug = 'planet_fitness_standard' and p.user_id is null
on conflict (preset_id, equipment) do update set
  available    = excluded.available,
  min_lb       = excluded.min_lb,
  max_lb       = excluded.max_lb,
  increment_lb = excluded.increment_lb,
  notes        = excluded.notes,
  updated_at   = now();

-- ── CrossFit box — typical ───────────────────────────────────────────────────
insert into public.location_preset_equipment
  (user_id, preset_id, equipment, available, min_lb, max_lb, increment_lb, notes)
select null, p.id, v.equipment::public.equipment_slug, v.available, v.min_lb, v.max_lb, v.increment_lb, v.notes
from public.location_presets p
cross join (values
  ('bodyweight'::text,       true,  null::numeric, null::numeric, null::numeric, null::text),
  ('wall_space',             true,  null, null, null, 'Wall balls and handstands.'),
  ('barbell',                true,  null, null, 2.5,  '45 lb men''s bar, 35 lb women''s.'),
  ('bumper_plates',          true,  null, null, null, null),
  ('power_rack',             true,  null, null, null, null),
  ('trap_bar',               true,  null, null, null, 'Not every box has one.'),
  ('dumbbell',               true,  5,    100,  5,    null),
  ('kettlebell',             true,  18,   106,  null, 'Kilogram bells; the app converts to pounds on entry.'),
  ('rings',                  true,  null, null, null, null),
  ('ghd',                    true,  null, null, null, null),
  ('plyo_box',               true,  null, null, null, '20/24/30 in. Step down from every jump.'),
  ('jump_rope',              true,  null, null, null, 'Double-unders are plyo contacts — they count against the ceiling.'),
  ('rower',                  true,  null, null, null, null),
  ('ski_erg',                true,  null, null, null, null),
  ('assault_bike',           true,  null, null, null, null),
  ('medicine_ball',          true,  null, null, null, 'Wall balls, 14–20 lb.'),
  ('slam_ball',              true,  null, null, null, null),
  ('chalk',                  true,  null, null, null, null),
  ('pull_up_bar',            true,  null, null, null, null),
  ('dip_station',            true,  null, null, null, null),
  ('sled',                   true,  null, null, null, 'The real thing. Backward sled ≈50% BW is the KOT knee entry point.'),
  ('bench_flat',             true,  null, null, null, null),
  ('bench_adjustable',       true,  null, null, null, null),
  ('track_or_open_space',    true,  null, null, null, 'Sprints and sled pushes out the roll-up door.'),
  ('yoga_mat',               true,  null, null, null, null),
  ('resistance_bands',       true,  null, null, null, null),
  ('stationary_bike',        true,  null, null, null, null),
  ('foam_roller',            true,  null, null, null, null),
  ('smith_machine',          false, null, null, null, null),
  ('selectorized_machine',   false, null, null, null, 'Boxes rarely stock a machine line.'),
  ('leg_press',              false, null, null, null, null),
  ('lat_pulldown',           false, null, null, null, null),
  ('treadmill',              false, null, null, null, null),
  ('elliptical',             false, null, null, null, null),
  ('arc_trainer',            false, null, null, null, null)
) as v(equipment, available, min_lb, max_lb, increment_lb, notes)
where p.slug = 'crossfit_box_typical' and p.user_id is null
on conflict (preset_id, equipment) do update set
  available    = excluded.available,
  min_lb       = excluded.min_lb,
  max_lb       = excluded.max_lb,
  increment_lb = excluded.increment_lb,
  notes        = excluded.notes,
  updated_at   = now();

-- ── Bodyweight only (travel) ─────────────────────────────────────────────────
insert into public.location_preset_equipment
  (user_id, preset_id, equipment, available, min_lb, max_lb, increment_lb, notes)
select null, p.id, v.equipment::public.equipment_slug, v.available, v.min_lb, v.max_lb, v.increment_lb, v.notes
from public.location_presets p
cross join (values
  ('bodyweight'::text,     true,  null::numeric, null::numeric, null::numeric, null::text),
  ('wall_space',           true,  null, null, null, 'Wall sits, handstand holds, couch stretch against the wall.'),
  ('yoga_mat',             true,  null, null, null, 'A towel counts.'),
  ('outdoor_route',        true,  null, null, null, 'Walk-run, Zone 2, backward walking. The default cardio here.'),
  ('track_or_open_space',  true,  null, null, null, null),
  ('resistance_bands',     false, null, null, null, 'Pack a set and tick this on — it doubles what the engine can prescribe.'),
  ('suspension_trainer',   false, null, null, null, null),
  ('pull_up_bar',          false, null, null, null, null),
  ('dumbbell',             false, null, null, null, null),
  ('bench_flat',           false, null, null, null, 'A chair or a bed frame substitutes for step-ups and split squats.')
) as v(equipment, available, min_lb, max_lb, increment_lb, notes)
where p.slug = 'bodyweight_only' and p.user_id is null
on conflict (preset_id, equipment) do update set
  available    = excluded.available,
  min_lb       = excluded.min_lb,
  max_lb       = excluded.max_lb,
  increment_lb = excluded.increment_lb,
  notes        = excluded.notes,
  updated_at   = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. apply_location_preset() — clone a preset into a real location
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.apply_location_preset(
  p_user_id     uuid,
  p_preset_slug text,
  p_name        text default null,
  -- false (default): keep whatever Seth has already edited on an existing
  -- location of the same name, and only add equipment rows that are missing.
  -- true: "reset to preset" — overwrite bar weights and every checklist row.
  p_overwrite   boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_preset      public.location_presets%rowtype;
  v_location_id uuid;
begin
  -- An athlete's own preset of the same slug wins over the global one.
  select * into v_preset
  from public.location_presets
  where slug = p_preset_slug
    and (user_id is null or user_id = p_user_id)
  order by user_id nulls last
  limit 1;

  if not found then
    raise exception 'Unknown location preset: %', p_preset_slug
      using hint = 'Presets: home, planet_fitness_standard, crossfit_box_typical, bodyweight_only';
  end if;

  insert into public.locations
    (user_id, name, kind, bar_weight_lb, smith_bar_weight_lb, overhead_min, preset_slug)
  values
    (p_user_id, coalesce(p_name, v_preset.name), v_preset.kind,
     v_preset.bar_weight_lb, v_preset.smith_bar_weight_lb, v_preset.overhead_min, v_preset.slug)
  on conflict (user_id, name) do update set
    kind                = case when p_overwrite then excluded.kind                else public.locations.kind                end,
    bar_weight_lb       = case when p_overwrite then excluded.bar_weight_lb       else public.locations.bar_weight_lb       end,
    smith_bar_weight_lb = case when p_overwrite then excluded.smith_bar_weight_lb else public.locations.smith_bar_weight_lb end,
    overhead_min        = case when p_overwrite then excluded.overhead_min        else public.locations.overhead_min        end,
    preset_slug         = excluded.preset_slug,
    updated_at          = now()
  returning id into v_location_id;

  insert into public.location_equipment
    (user_id, location_id, equipment, available, min_lb, max_lb, increment_lb, notes)
  select p_user_id, v_location_id, pe.equipment, pe.available,
         pe.min_lb, pe.max_lb, pe.increment_lb, pe.notes
  from public.location_preset_equipment pe
  where pe.preset_id = v_preset.id
  on conflict (location_id, equipment) do update set
    available    = case when p_overwrite then excluded.available    else public.location_equipment.available    end,
    min_lb       = case when p_overwrite then excluded.min_lb       else public.location_equipment.min_lb       end,
    max_lb       = case when p_overwrite then excluded.max_lb       else public.location_equipment.max_lb       end,
    increment_lb = case when p_overwrite then excluded.increment_lb else public.location_equipment.increment_lb end,
    notes        = case when p_overwrite then excluded.notes        else public.location_equipment.notes        end,
    updated_at   = now();

  return v_location_id;
end;
$$;

comment on function public.apply_location_preset(uuid, text, text, boolean) is
  'Clone a location preset into a real location for an athlete. Returns the location id. Seth clones planet_fitness_standard once per club, names it after the club, then edits the checklist on his first visit.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Seeding Seth's own locations is an APPLICATION step, not a migration step —
-- it needs his user id, which only exists after he signs in. The onboarding
-- route calls, with the service key:
--
--   select public.apply_location_preset(:uid, 'home');
--   select public.apply_location_preset(:uid, 'planet_fitness_standard',
--                                       'Planet Fitness — <club>');
--   select public.apply_location_preset(:uid, 'bodyweight_only');
-- ═════════════════════════════════════════════════════════════════════════════

-- == 0005_cron.sql ==

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

-- == 0006_worker.sql ==

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

-- == 0007_equipment_vocabulary.sql ==

-- ═════════════════════════════════════════════════════════════════════════════
-- 0007_equipment_vocabulary.sql — Longevity OS · five slugs the corpora needed
-- ═════════════════════════════════════════════════════════════════════════════
-- The exercise ingest (scripts/ingest-exercises.ts) reports any source-vocabulary
-- term it cannot map to a canonical slug rather than coercing it into a
-- near-neighbour — a deliberately loud failure mode. That report named five
-- pieces of real equipment with no slug: Gym Visual's `rope` (10 exercises),
-- `wheel roller` (2), `hammer`, `tire`, and `upper body ergometer`.
--
-- Coercing an ab wheel into "bodyweight" or an arm bike into "stationary_bike"
-- would have made the library quietly wrong at a Planet Fitness that has one and
-- a home that does not. So the vocabulary grows instead.
--
-- Mirrors the `EQUIPMENT` const in packages/engine/src/types.ts. If you add a
-- slug there, add it here, or the enum-equality check in packages/db fails.
-- Safe to run more than once.
--
-- ⚠️ THE ADD-VALUE LOOP BELOW IS A NO-OP ON A FRESH DATABASE, AND MUST STAY
-- THAT WAY. `0001` creates `equipment_slug` with all 65 values, so the loop
-- finds nothing to add. It exists only for a database that already ran an older
-- `0001`.
--
-- The reason matters: Postgres refuses to USE a value added by
-- `alter type ... add value` inside the same transaction that added it
-- (SQLSTATE 55P04). The Supabase SQL Editor runs a pasted script as ONE
-- transaction, so adding a value here and inserting a catalog row using it
-- below would fail — as it did, in the editor, having passed a psql run where
-- every statement gets its own implicit transaction. Values that come from
-- `create type` carry no such restriction, which is why they belong in 0001.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v text;
  new_values text[] := array['ab_wheel', 'battle_rope', 'sledgehammer', 'tire', 'arm_ergometer'];
begin
  foreach v in array new_values loop
    if not exists (
      select 1
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
       where t.typname = 'equipment_slug' and e.enumlabel = v
    ) then
      -- `add value` cannot run inside a transaction block on older servers, so
      -- it is issued dynamically one label at a time.
      execute format('alter type public.equipment_slug add value %L', v);
      raise notice '0007: added equipment_slug value %', v;
    end if;
  end loop;
end;
$$;

-- A new enum label is not visible to the same transaction that created it, so
-- the catalog rows go in a separate statement.
-- On a fresh database `0003` has already seeded these five, so this upsert is a
-- no-op. It stays for a database that ran an older `0003` and needs them added.
--
-- `user_id is null` marks a GLOBAL catalog row, and the unique index on slug is
-- partial on exactly that predicate, so the conflict target has to repeat it.
insert into public.equipment_catalog (slug, display_name, category, notes) values
  ('ab_wheel',      'Ab Wheel',             'accessory', 'Wheel roller. Anti-extension work; brutal and cheap.'),
  ('battle_rope',   'Battle Rope',          'accessory', 'Conditioning. Present at some CrossFit boxes, never at Planet Fitness.'),
  ('sledgehammer',  'Sledgehammer',         'accessory', 'Tire striking. Box equipment.'),
  ('tire',          'Tire',                 'accessory', 'Flipping and striking. Box equipment.'),
  ('arm_ergometer', 'Upper Body Ergometer', 'cardio',    'Arm bike. Genuinely useful Zone 2 on a day the lower body is recovering.')
on conflict (slug) where user_id is null do update
  set display_name = excluded.display_name,
      category     = excluded.category,
      notes        = excluded.notes,
      updated_at   = now();

-- == 0008_oura_oauth.sql ==

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

-- == 0009_grants.sql ==

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
