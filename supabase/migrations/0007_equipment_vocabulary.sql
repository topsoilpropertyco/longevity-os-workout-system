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
