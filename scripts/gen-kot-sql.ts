/**
 * GEN-KOT-SQL — `programs/kot/program.json` → `supabase/migrations/0011_seed_kot.sql`
 *
 * The rebuilt Knees Over Toes program is 69 steps across three phases and
 * twelve weekday templates. Hand-maintaining that as SQL beside the JSON would
 * guarantee the two drift, and the drift would be invisible: a step quietly
 * missing from the database is a step Seth never sees.
 *
 * So the SQL is generated, never edited. `npm run sql:kot` regenerates it and
 * CI fails if the checked-in file does not match what this script produces —
 * the same staleness guard the schema bundle uses.
 *
 * The program is GLOBAL (`user_id is null`), so unlike locations it can be
 * seeded in a migration: it needs no athlete to exist first. Enrolling Seth is
 * still an application step — `select public.start_program(:uid, 'kot');`,
 * defined in 0010.
 *
 * Usage:  npx tsx scripts/gen-kot-sql.ts [--check]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PATHS } from './lib/paths.js';

const OUT = path.join(PATHS.root, 'supabase', 'migrations', '0011_seed_kot.sql');

// ─────────────────────────────────────────────────────────────────────────────
// The shape on disk. Deliberately loose: this script's job is transport, not
// validation — `scripts/validate-data.ts` already checks the file against the
// engine's `Program` type, and runs before this in `npm run check`.
// ─────────────────────────────────────────────────────────────────────────────

interface KotStep {
  id: string;
  order: number;
  name: string;
  standard_text?: string;
  standard?: unknown;
  exercise_slug?: string;
  substitutions?: unknown[];
  prerequisites?: string[];
  block?: string;
  phase_id?: string;
  progressions?: string[];
  demo_url?: string;
  per_side?: boolean;
  rest_s?: number;
}

interface KotProgram {
  slug: string;
  name: string;
  description?: string;
  ordering: string;
  days_per_week: [number, number] | number[];
  blocks?: unknown[];
  target_cycles?: number;
  source?: string;
  attribution?: string;
  phases?: unknown[];
  days?: unknown[];
  current_phase_id?: string;
  steps: KotStep[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Literals
// ─────────────────────────────────────────────────────────────────────────────

/** A Postgres string literal. Doubling the quote is the whole escape rule. */
function lit(v: string | null | undefined): string {
  if (v === null || v === undefined) return 'null';
  return `'${v.replace(/'/g, "''")}'`;
}

/** A jsonb literal. JSON has no quote of its own to collide with, so same rule. */
function json(v: unknown, fallback = '{}'): string {
  if (v === null || v === undefined) return `${lit(fallback)}::jsonb`;
  return `${lit(JSON.stringify(v))}::jsonb`;
}

function num(v: number | null | undefined): string {
  return v === null || v === undefined ? 'null' : String(v);
}

function textArray(v: string[] | undefined): string {
  if (!v || v.length === 0) return `'{}'::text[]`;
  return `array[${v.map((s) => lit(s)).join(', ')}]::text[]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

export function renderKotSql(p: KotProgram): string {
  const [dpwMin, dpwMax] = [p.days_per_week[0] ?? 2, p.days_per_week[1] ?? p.days_per_week[0] ?? 3];
  const steps = [...p.steps].sort((a, b) => a.order - b.order);
  const phaseCount = (p.phases ?? []).length;
  const dayCount = (p.days ?? []).length;

  const stepRows = steps
    .map((s) =>
      [
        '  (',
        [
          lit(s.id),
          num(s.order),
          lit(s.name),
          lit(s.standard_text),
          s.standard === undefined ? 'null' : json(s.standard),
          lit(s.exercise_slug),
          json(s.substitutions ?? [], '[]'),
          textArray(s.prerequisites),
          lit(s.block),
          lit(s.phase_id),
          json(s.progressions ?? [], '[]'),
          lit(s.demo_url),
          s.per_side ? 'true' : 'false',
          num(s.rest_s),
        ].join(', '),
        ')',
      ].join(''),
    )
    .join(',\n');

  return `-- ═════════════════════════════════════════════════════════════════════════════
-- 0011_seed_kot.sql — Longevity OS · the Knees Over Toes program
-- ═════════════════════════════════════════════════════════════════════════════
-- GENERATED FILE — DO NOT EDIT. Run \`npm run sql:kot\` after changing
-- \`programs/kot/program.json\`; CI fails if this file and that one disagree.
--
-- ${phaseCount} phases · ${steps.length} steps · ${dayCount} weekday templates.
-- Global (\`user_id is null\`): the program is the same for every athlete, and
-- only an athlete's POSITION in it is personal. Enrol somebody with
-- \`select public.start_program(:uid, '${p.slug}');\` (0010).
--
-- Re-runnable. Steps are upserted on (program_id, step_key) and any step that
-- is no longer in the JSON is deleted — so a rename in the source file does not
-- leave an orphan behind that the planner might still schedule.
--
-- Source: ${(p.source ?? '').replace(/\n/g, ' ')}
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The program
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.programs
  (user_id, slug, name, description, ordering,
   days_per_week_min, days_per_week_max, blocks, target_cycles,
   source, attribution, phases, days, current_phase_id)
values
  (null, ${lit(p.slug)}, ${lit(p.name)}, ${lit(p.description)}, ${lit(p.ordering)},
   ${num(dpwMin)}, ${num(dpwMax)}, ${json(p.blocks ?? [], '[]')}, ${num(p.target_cycles ?? 1)},
   ${lit(p.source)}, ${lit(p.attribution)},
   ${json(p.phases ?? [], '[]')}, ${json(p.days ?? [], '[]')}, ${lit(p.current_phase_id)})
on conflict (slug) do update set
  name              = excluded.name,
  description       = excluded.description,
  ordering          = excluded.ordering,
  days_per_week_min = excluded.days_per_week_min,
  days_per_week_max = excluded.days_per_week_max,
  blocks            = excluded.blocks,
  target_cycles     = excluded.target_cycles,
  source            = excluded.source,
  attribution       = excluded.attribution,
  phases            = excluded.phases,
  days              = excluded.days,
  current_phase_id  = excluded.current_phase_id,
  updated_at        = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The steps
-- ─────────────────────────────────────────────────────────────────────────────
-- Staged through a temp table rather than a chain of data-modifying CTEs.
-- CTEs in one statement cannot see each other's writes, so the retire / free /
-- upsert sequence below has to be three statements: doing it in one would
-- either collide on the (program_id, step_order) unique index or try to touch
-- the same row twice and raise "tuple to be updated was already modified".

-- \`on commit drop\` would be wrong: applied as individual migrations each
-- statement is its own transaction, so the table would vanish before the next
-- line could fill it. A session-lifetime temp table behaves identically whether
-- the file is pasted into the Supabase SQL Editor as one transaction or run
-- statement by statement through psql.
drop table if exists kot_incoming;
create temp table kot_incoming (
  step_key      text primary key,
  step_order    integer not null,
  name          text not null,
  standard_text text,
  standard      jsonb,
  exercise_slug text,
  substitutions jsonb not null,
  prerequisites text[] not null,
  block         text,
  phase_id      text,
  progressions  jsonb not null,
  demo_url      text,
  per_side      boolean not null,
  rest_s        integer
);

insert into kot_incoming values
${stepRows};

-- (a) Retire steps the source file no longer has, so a renamed step cannot
--     leave an orphan behind that the planner might still schedule.
delete from public.program_steps s
using public.programs p
where p.slug = ${lit(p.slug)} and p.user_id is null and s.program_id = p.id
  and s.step_key not in (select step_key from kot_incoming);

-- (b) Park every surviving step far above the range being written. step_order
--     is unique per program, so a step that moved would collide with whatever
--     is currently sitting where it is going. Parking NEGATIVE would be the
--     obvious trick and is not available: 0001 constrains step_order >= 0.
update public.program_steps s
set step_order = s.step_order + 1000000
from public.programs p
where p.slug = ${lit(p.slug)} and p.user_id is null and s.program_id = p.id
  and s.step_order < 1000000;

-- (c) Now the real orders are all free.
insert into public.program_steps
  (user_id, program_id, step_key, step_order, name, standard_text, standard,
   exercise_slug, substitutions, prerequisites, block, phase_id, progressions,
   demo_url, per_side, rest_s)
select null, p.id, i.step_key, i.step_order, i.name, i.standard_text, i.standard,
       i.exercise_slug, i.substitutions, i.prerequisites, i.block, i.phase_id,
       i.progressions, i.demo_url, i.per_side, i.rest_s
from kot_incoming i
cross join public.programs p
where p.slug = ${lit(p.slug)} and p.user_id is null
on conflict (program_id, step_key) do update set
  step_order    = excluded.step_order,
  name          = excluded.name,
  standard_text = excluded.standard_text,
  standard      = excluded.standard,
  exercise_slug = excluded.exercise_slug,
  substitutions = excluded.substitutions,
  prerequisites = excluded.prerequisites,
  block         = excluded.block,
  phase_id      = excluded.phase_id,
  progressions  = excluded.progressions,
  demo_url      = excluded.demo_url,
  per_side      = excluded.per_side,
  rest_s        = excluded.rest_s,
  updated_at    = now();

drop table if exists kot_incoming;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Assertions
-- ─────────────────────────────────────────────────────────────────────────────
-- Everything above is a bulk statement. If one of them silently did nothing,
-- the planner would schedule a program with holes in it rather than fail. So
-- the counts are checked, here, while the transaction can still be rolled back.

do $$
declare
  v_program uuid;
  v_steps   integer;
  v_phases  integer;
  v_days    integer;
  v_orphan  text;
begin
  select id, jsonb_array_length(phases), jsonb_array_length(days)
    into v_program, v_phases, v_days
  from public.programs where slug = ${lit(p.slug)} and user_id is null;

  if v_program is null then
    raise exception 'the ${p.slug} program did not seed';
  end if;

  select count(*) into v_steps from public.program_steps where program_id = v_program;

  if v_steps <> ${steps.length} then
    raise exception '${p.slug}: expected ${steps.length} steps, found %', v_steps;
  end if;
  if v_phases <> ${phaseCount} then
    raise exception '${p.slug}: expected ${phaseCount} phases, found %', v_phases;
  end if;
  if v_days <> ${dayCount} then
    raise exception '${p.slug}: expected ${dayCount} weekday templates, found %', v_days;
  end if;

  -- Every step must name a phase the program actually declares, and every
  -- weekday template must reference steps that exist. A dangling step_id here
  -- is a blank slot in a real session.
  select string_agg(distinct s.phase_id, ', ') into v_orphan
  from public.program_steps s
  join public.programs p on p.id = s.program_id
  where s.program_id = v_program
    and s.phase_id is not null
    and not (s.phase_id = any (public.program_phase_ids(p.phases)));

  if v_orphan is not null then
    raise exception '${p.slug}: steps reference undeclared phases: %', v_orphan;
  end if;

  select string_agg(distinct t.step_id, ', ') into v_orphan
  from public.programs p
  cross join lateral jsonb_array_elements(p.days) as d
  cross join lateral jsonb_array_elements(d->'blocks') as b
  cross join lateral jsonb_array_elements_text(b->'step_ids') as t(step_id)
  where p.id = v_program
    and not exists (
      select 1 from public.program_steps s
      where s.program_id = v_program and s.step_key = t.step_id
    );

  if v_orphan is not null then
    raise exception '${p.slug}: weekday templates reference unknown steps: %', v_orphan;
  end if;

  raise notice '${p.slug}: % steps, % phases, % weekday templates', v_steps, v_phases, v_days;
end $$;
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  const check = process.argv.includes('--check');
  const program = JSON.parse(readFileSync(PATHS.kotProgram, 'utf8')) as KotProgram;
  const sql = renderKotSql(program);

  if (check) {
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8');
    } catch {
      /* missing counts as stale */
    }
    if (current !== sql) {
      process.stderr.write(
        `supabase/migrations/0011_seed_kot.sql is stale.\n` +
          `It is generated from programs/kot/program.json — run \`npm run sql:kot\` and commit the result.\n`,
      );
      process.exit(1);
    }
    process.stdout.write('0011_seed_kot.sql is up to date with programs/kot/program.json\n');
    return;
  }

  writeFileSync(OUT, sql, 'utf8');
  process.stdout.write(
    `wrote supabase/migrations/0011_seed_kot.sql — ` +
      `${program.steps.length} steps, ${(program.phases ?? []).length} phases, ` +
      `${(program.days ?? []).length} weekday templates\n`,
  );
}

main();
