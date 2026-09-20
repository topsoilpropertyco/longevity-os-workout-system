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
