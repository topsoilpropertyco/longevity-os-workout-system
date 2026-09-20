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
  (null, 'chalk',                   'Chalk',                      'accessory',   'Banned at Planet Fitness. Grip-limited pulls need straps or a different lift there.', 840)
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
