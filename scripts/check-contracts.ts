/**
 * Longevity OS — Contract Check
 *
 * Three files independently describe the same vocabulary:
 *
 *   1. `packages/engine/src/types.ts` — the TypeScript unions. Source of truth.
 *   2. `supabase/migrations/*.sql`    — the Postgres enums.
 *   3. `packages/db/src/types.ts`     — the generated database types.
 *
 * They drift silently. A slug added to the engine but not the enum produces a
 * runtime insert failure weeks later; one added to the enum but not the engine
 * is dead weight nobody notices. This script fails loudly instead.
 *
 * Run: `npx tsx scripts/check-contracts.ts`
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ENGINE_TYPES = join(ROOT, 'packages/engine/src/types.ts');
const DB_TYPES = join(ROOT, 'packages/db/src/types.ts');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

/** Engine union name → Postgres enum name. Only pairs listed here are checked. */
const PAIRS: { constName: string; sqlEnum: string; dbEnum: string }[] = [
  { constName: 'REGIONS', sqlEnum: 'region', dbEnum: 'region' },
  { constName: 'MOVEMENT_PATTERNS', sqlEnum: 'movement_pattern', dbEnum: 'movement_pattern' },
  { constName: 'EQUIPMENT', sqlEnum: 'equipment_slug', dbEnum: 'equipment_slug' },
  { constName: 'SESSION_TYPES', sqlEnum: 'session_type', dbEnum: 'session_type' },
  { constName: 'GOAL_MODES', sqlEnum: 'goal_mode', dbEnum: 'goal_mode' },
  { constName: 'CARDIO_MODALITIES', sqlEnum: 'cardio_modality', dbEnum: 'cardio_modality' },
];

const failures: string[] = [];

// ── 1. the engine's unions ───────────────────────────────────────────────────

const engineSrc = readFileSync(ENGINE_TYPES, 'utf8');

function engineUnion(constName: string): string[] {
  const re = new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const;`);
  const m = engineSrc.match(re);
  if (!m?.[1]) throw new Error(`${constName} not found in ${ENGINE_TYPES}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
}

// ── 2. the Postgres enums ────────────────────────────────────────────────────

const sqlSrc = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');

function sqlEnumValues(name: string): string[] {
  const created = sqlSrc.match(
    new RegExp(`create type (?:public\\.)?${name} as enum\\s*\\(([\\s\\S]*?)\\);`, 'i'),
  );
  const values = created?.[1] ? [...created[1].matchAll(/'([^']+)'/g)].map((x) => x[1] as string) : [];

  // Later migrations extend the enum. `alter type ... add value 'x'` appears
  // both literally and inside the dynamic `format(... %L)` loop in 0007, so
  // gather the array literals that loop iterates over too.
  for (const m of sqlSrc.matchAll(
    new RegExp(`alter type (?:public\\.)?${name} add value '([^']+)'`, 'gi'),
  )) {
    values.push(m[1] as string);
  }
  for (const m of sqlSrc.matchAll(
    /new_values text\[\] := array\[([^\]]+)\]/gi,
  )) {
    // Only counts when the surrounding block names this enum.
    const block = sqlSrc.slice(Math.max(0, (m.index ?? 0) - 400), (m.index ?? 0) + 1200);
    if (!block.includes(`'${name}'`)) continue;
    for (const v of m[1]!.matchAll(/'([^']+)'/g)) values.push(v[1] as string);
  }

  return [...new Set(values)];
}

// ── 3. the generated database types ──────────────────────────────────────────

const dbSrc = readFileSync(DB_TYPES, 'utf8');

/**
 * Scoped to the `Enums:` block. Searching the whole file would match a column
 * declaration like `region: Database["public"]["Enums"]["region"]` and read the
 * path segments as if they were enum members — which is exactly the false
 * failure this comment exists to stop someone re-introducing.
 */
const dbEnumsBlock = (() => {
  const start = dbSrc.indexOf('Enums: {');
  if (start === -1) throw new Error(`no Enums block in ${DB_TYPES}`);
  // Walk braces so a nested object cannot truncate the block early.
  let depth = 0;
  for (let i = dbSrc.indexOf('{', start); i < dbSrc.length; i++) {
    if (dbSrc[i] === '{') depth++;
    else if (dbSrc[i] === '}') {
      depth--;
      if (depth === 0) return dbSrc.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated Enums block in ${DB_TYPES}`);
})();

function dbEnumValues(name: string): string[] {
  const line = dbEnumsBlock.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm'));
  if (!line?.[1]) throw new Error(`${name} not found in the Enums block of ${DB_TYPES}`);
  return [...line[1].matchAll(/"([^"]+)"/g)].map((x) => x[1] as string);
}

// ── compare ──────────────────────────────────────────────────────────────────

function diff(label: string, a: string[], b: string[], aName: string, bName: string): void {
  const onlyA = a.filter((x) => !b.includes(x));
  const onlyB = b.filter((x) => !a.includes(x));
  if (onlyA.length) failures.push(`${label}: in ${aName} but not ${bName} → ${onlyA.join(', ')}`);
  if (onlyB.length) failures.push(`${label}: in ${bName} but not ${aName} → ${onlyB.join(', ')}`);
}

console.log('Longevity OS — contract check\n');

for (const pair of PAIRS) {
  const engine = engineUnion(pair.constName);
  const sql = sqlEnumValues(pair.sqlEnum);
  const db = dbEnumValues(pair.dbEnum);

  diff(pair.constName, engine, sql, 'engine types.ts', `sql enum ${pair.sqlEnum}`);
  diff(pair.constName, engine, db, 'engine types.ts', `packages/db ${pair.dbEnum}`);

  const ok = engine.length === sql.length && engine.length === db.length;
  console.log(
    `  ${ok ? '✓' : '✗'} ${pair.constName.padEnd(20)} engine ${String(engine.length).padStart(3)} · sql ${String(sql.length).padStart(3)} · db ${String(db.length).padStart(3)}`,
  );
}

// ── the exercise library only uses canonical slugs ───────────────────────────

try {
  const library = JSON.parse(readFileSync(join(ROOT, 'data/exercises.json'), 'utf8')) as {
    equipment?: string[];
    region_loads?: Record<string, number>;
  }[];
  const equipment = new Set(engineUnion('EQUIPMENT'));
  const regions = new Set(engineUnion('REGIONS'));
  const badEquipment = new Set<string>();
  const badRegions = new Set<string>();
  for (const ex of library) {
    for (const e of ex.equipment ?? []) if (!equipment.has(e)) badEquipment.add(e);
    for (const r of Object.keys(ex.region_loads ?? {})) if (!regions.has(r)) badRegions.add(r);
  }
  if (badEquipment.size) failures.push(`data/exercises.json uses non-canonical equipment: ${[...badEquipment].join(', ')}`);
  if (badRegions.size) failures.push(`data/exercises.json uses non-canonical regions: ${[...badRegions].join(', ')}`);
  console.log(`  ${badEquipment.size + badRegions.size === 0 ? '✓' : '✗'} data/exercises.json      ${library.length} exercises, canonical vocabulary`);
} catch {
  console.log('  – data/exercises.json      not generated yet (run npm run ingest:exercises)');
}

// ── report ───────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error('\nCONTRACT VIOLATIONS:\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('\nAdd the value in all three places, or remove it from all three.\n');
  process.exit(1);
}

console.log('\nAll contracts agree.\n');
