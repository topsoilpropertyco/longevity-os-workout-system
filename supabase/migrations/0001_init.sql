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
