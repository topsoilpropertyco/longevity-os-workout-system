/**
 * Longevity OS — generated-data validation
 *
 *   npx tsx scripts/validate-data.ts          ← meaningful pre-commit check
 *
 * Validates every committed JSON artifact against the domain types in
 * `packages/engine/src/types.ts`. Deliberately dependency-free (CLAUDE.md:
 * $0/month, no new deps without asking) — the union constants are imported
 * from types.ts itself, so a change there fails here rather than drifting.
 *
 * Fails loudly: prints the offending record and exits 1.
 *
 * Checks performed
 *   1. data/exercises.json         — Exercise[] shape, canonical unions, unique ids
 *   2. data/curated-exercises.json — same, plus written cues/instructions
 *   3. data/exercise-media.json    — media map + the Gym Visual attribution guard
 *   4. programs/kot/program.json   — Program shape, resolvable slugs, block/prereq graph
 *   5. data/reports/import-review.json (when present) — review artifact shape
 *
 * Pre-commit wiring (no husky, no dependency):
 *   printf '#!/bin/sh\nnpx tsx scripts/validate-data.ts\n' > .git/hooks/pre-commit
 *   chmod +x .git/hooks/pre-commit
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  EQUIPMENT,
  MOVEMENT_PATTERNS,
  REGIONS,
} from '../packages/engine/src/types';
import type { Exercise, Program } from '../packages/engine/src/types';
import { PATHS, readJson } from './lib/paths';

const LOAD_STYLES = [
  'total_dumbbell_pair',
  'single_implement',
  'barbell',
  'smith',
  'stack',
  'bodyweight',
  'assisted',
  'band',
  'none',
] as const;
const FORCES = ['push', 'pull', 'static', 'unknown'] as const;
const MECHANICS = ['compound', 'isolation', 'unknown'] as const;
const LEVELS = ['beginner', 'intermediate', 'expert'] as const;
const SOURCES = ['free-exercise-db', 'gym-visual', 'curated', 'kot'] as const;
const ORDERINGS = ['ground_up', 'as_listed', 'engine_choice'] as const;

const GYM_VISUAL_HOST = 'gymvisual';

interface Problem {
  file: string;
  where: string;
  message: string;
  record?: unknown;
}

const problems: Problem[] = [];

function fail(file: string, where: string, message: string, record?: unknown): void {
  problems.push({ file, where, message, record });
}

function expectString(file: string, where: string, value: unknown, field: string, record: unknown): void {
  if (typeof value !== 'string' || !value.length) {
    fail(file, where, `${field} must be a non-empty string (got ${JSON.stringify(value)})`, record);
  }
}

function expectBoolean(file: string, where: string, value: unknown, field: string, record: unknown): void {
  if (typeof value !== 'boolean') {
    fail(file, where, `${field} must be a boolean (got ${JSON.stringify(value)})`, record);
  }
}

function expectEnum<T extends readonly string[]>(
  file: string,
  where: string,
  value: unknown,
  field: string,
  allowed: T,
  record: unknown,
): void {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(file, where, `${field} must be one of ${allowed.join(' | ')} (got ${JSON.stringify(value)})`, record);
  }
}

function expectStringArray(file: string, where: string, value: unknown, field: string, record: unknown): void {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    fail(file, where, `${field} must be an array of strings`, record);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exercise
// ─────────────────────────────────────────────────────────────────────────────

function validateExercise(file: string, ex: Exercise, index: number, opts: { curated: boolean }): void {
  const where = `${file}[${index}] ${typeof ex?.name === 'string' ? ex.name : '(unnamed)'}`;
  if (!ex || typeof ex !== 'object') {
    fail(file, where, 'record is not an object', ex);
    return;
  }
  expectString(file, where, ex.id, 'id', ex);
  expectString(file, where, ex.name, 'name', ex);
  expectString(file, where, ex.slug, 'slug', ex);
  expectStringArray(file, where, ex.aliases, 'aliases', ex);
  expectEnum(file, where, ex.pattern, 'pattern', MOVEMENT_PATTERNS, ex);
  expectEnum(file, where, ex.force, 'force', FORCES, ex);
  expectEnum(file, where, ex.mechanic, 'mechanic', MECHANICS, ex);
  expectEnum(file, where, ex.level, 'level', LEVELS, ex);
  expectEnum(file, where, ex.load_style, 'load_style', LOAD_STYLES, ex);
  expectEnum(file, where, ex.source, 'source', SOURCES, ex);
  expectBoolean(file, where, ex.barbell_free, 'barbell_free', ex);
  expectBoolean(file, where, ex.eccentric_dominant, 'eccentric_dominant', ex);
  expectStringArray(file, where, ex.instructions, 'instructions', ex);

  if (!Array.isArray(ex.equipment)) {
    fail(file, where, 'equipment must be an array', ex);
  } else {
    for (const slug of ex.equipment) {
      if (!(EQUIPMENT as readonly string[]).includes(slug)) {
        fail(file, where, `equipment "${slug}" is not a canonical Equipment slug`, ex);
      }
    }
  }

  if (typeof ex.plyo_contacts_per_rep !== 'number' || ex.plyo_contacts_per_rep < 0) {
    fail(file, where, 'plyo_contacts_per_rep must be a number ≥ 0', ex);
  }

  if (!ex.region_loads || typeof ex.region_loads !== 'object') {
    fail(file, where, 'region_loads must be an object', ex);
  } else {
    for (const [region, value] of Object.entries(ex.region_loads)) {
      if (!(REGIONS as readonly string[]).includes(region)) {
        fail(file, where, `region_loads key "${region}" is not a canonical Region`, ex);
      }
      if (typeof value !== 'number' || value < 0 || value > 1) {
        fail(file, where, `region_loads.${region} must be a number in 0–1 (got ${JSON.stringify(value)})`, ex);
      }
    }
  }

  if (ex.rehab_for) {
    for (const region of ex.rehab_for) {
      if (!(REGIONS as readonly string[]).includes(region)) {
        fail(file, where, `rehab_for "${region}" is not a canonical Region`, ex);
      }
    }
  }

  if (ex.media) {
    const media = ex.media;
    const gif = media.gif_url ?? '';
    const thumb = media.thumb_url ?? '';
    if ((gif || thumb) && !media.attribution) {
      fail(file, where, 'media has a GIF/thumbnail but no attribution — the Gym Visual credit is mandatory', ex);
    }
    if ((gif.includes(GYM_VISUAL_HOST) || thumb.includes(GYM_VISUAL_HOST) || gif || thumb) && media.attribution) {
      if (!media.attribution.toLowerCase().includes('gym visual')) {
        fail(file, where, `media.attribution must name Gym visual (got "${media.attribution}")`, ex);
      }
    }
    if (media.image_urls && !Array.isArray(media.image_urls)) {
      fail(file, where, 'media.image_urls must be an array', ex);
    }
  }

  if (opts.curated) {
    if (!ex.cue) fail(file, where, 'curated records must carry a written cue (media is missing by definition)', ex);
    if (!ex.instructions?.length) fail(file, where, 'curated records must carry written instructions', ex);
    if (ex.source !== 'curated') fail(file, where, `curated records must have source "curated" (got "${ex.source}")`, ex);
  }
}

function validateExerciseFile(file: string, opts: { curated: boolean }): Exercise[] {
  if (!fs.existsSync(file)) {
    fail(file, file, 'file is missing — run `npx tsx scripts/ingest-exercises.ts`');
    return [];
  }
  const label = path.relative(PATHS.root, file);
  const data = readJson<unknown>(file);
  if (!Array.isArray(data)) {
    fail(label, label, 'expected a JSON array of Exercise records');
    return [];
  }
  const list = data as Exercise[];
  list.forEach((ex, i) => validateExercise(label, ex, i, opts));

  const ids = new Map<string, number>();
  for (const ex of list) {
    const count = (ids.get(ex.id) ?? 0) + 1;
    ids.set(ex.id, count);
    if (count > 1) fail(label, `${label} ${ex.id}`, 'duplicate exercise id', ex);
  }
  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// Media side-car
// ─────────────────────────────────────────────────────────────────────────────

function validateMediaFile(library: Exercise[]): void {
  const label = path.relative(PATHS.root, PATHS.exerciseMedia);
  if (!fs.existsSync(PATHS.exerciseMedia)) {
    fail(label, label, 'file is missing — run `npx tsx scripts/ingest-exercises.ts`');
    return;
  }
  const data = readJson<{ media?: Record<string, { gif_url?: string; attribution?: string }>; attribution?: string }>(
    PATHS.exerciseMedia,
  );
  if (!data.media || typeof data.media !== 'object') {
    fail(label, label, 'expected a top-level `media` object keyed by exercise id');
    return;
  }
  if (!data.attribution || !data.attribution.toLowerCase().includes('gym visual')) {
    fail(label, label, 'top-level attribution must carry the "© Gym visual" credit');
  }
  const ids = new Set(library.map((e) => e.id));
  for (const [id, media] of Object.entries(data.media)) {
    if (!ids.has(id)) fail(label, `${label} ${id}`, 'media entry references an unknown exercise id', media);
    if (media.gif_url && !media.attribution?.toLowerCase().includes('gym visual')) {
      fail(label, `${label} ${id}`, 'GIF without the Gym Visual attribution', media);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Program
// ─────────────────────────────────────────────────────────────────────────────

function validateProgram(library: Exercise[], curated: Exercise[]): void {
  const label = path.relative(PATHS.root, PATHS.kotProgram);
  if (!fs.existsSync(PATHS.kotProgram)) {
    fail(label, label, 'programs/kot/program.json is missing');
    return;
  }
  const program = readJson<Program & { _note?: string }>(PATHS.kotProgram);
  expectString(label, label, program.slug, 'slug', undefined);
  expectString(label, label, program.name, 'name', undefined);
  expectString(label, label, program.description, 'description', undefined);
  expectString(label, label, program.source, 'source', undefined);
  expectEnum(label, label, program.ordering, 'ordering', ORDERINGS, undefined);
  if (
    !Array.isArray(program.days_per_week) ||
    program.days_per_week.length !== 2 ||
    program.days_per_week.some((n) => typeof n !== 'number')
  ) {
    fail(label, label, 'days_per_week must be a [min, max] pair of numbers');
  }
  if (typeof program.target_cycles !== 'number' || program.target_cycles < 1) {
    fail(label, label, 'target_cycles must be a positive number');
  }
  if (!program._note || !/public/i.test(program._note)) {
    fail(
      label,
      label,
      '_note must state plainly that this is the PUBLIC scaffold and must be reconciled against Seth\'s spreadsheets',
    );
  }

  const blockIds = new Set<string>();
  for (const block of program.blocks ?? []) {
    expectString(label, `${label} block ${block?.id}`, block?.id, 'block.id', block);
    expectString(label, `${label} block ${block?.id}`, block?.name, 'block.name', block);
    if (typeof block?.order !== 'number') fail(label, `${label} block ${block?.id}`, 'block.order must be a number', block);
    if (blockIds.has(block.id)) fail(label, `${label} block ${block.id}`, 'duplicate block id', block);
    blockIds.add(block.id);
  }

  const knownSlugs = new Set<string>();
  for (const ex of [...library, ...curated]) {
    knownSlugs.add(ex.slug);
    knownSlugs.add(ex.id);
  }

  const stepIds = new Set((program.steps ?? []).map((s) => s.id));
  for (const step of program.steps ?? []) {
    const where = `${label} step ${step?.id}`;
    expectString(label, where, step?.id, 'step.id', step);
    expectString(label, where, step?.name, 'step.name', step);
    expectString(label, where, step?.standard_text, 'step.standard_text', step);
    expectString(label, where, step?.exercise_slug, 'step.exercise_slug', step);
    if (typeof step?.order !== 'number') fail(label, where, 'step.order must be a number', step);
    if (!blockIds.has(step?.block)) fail(label, where, `step.block "${step?.block}" is not a declared block`, step);
    if (step?.exercise_slug && !knownSlugs.has(step.exercise_slug)) {
      fail(label, where, `exercise_slug "${step.exercise_slug}" resolves to no exercise in the library or curated set`, step);
    }
    for (const prereq of step?.prerequisites ?? []) {
      if (!stepIds.has(prereq)) fail(label, where, `prerequisite "${prereq}" is not a step in this program`, step);
    }
    for (const sub of step?.substitutions ?? []) {
      if (!(EQUIPMENT as readonly string[]).includes(sub.equipment_missing)) {
        fail(label, where, `substitution.equipment_missing "${sub.equipment_missing}" is not a canonical Equipment slug`, sub);
      }
      if (!knownSlugs.has(sub.use_slug)) {
        fail(label, where, `substitution.use_slug "${sub.use_slug}" resolves to no exercise`, sub);
      }
    }
    const standard = step?.standard;
    if (standard) {
      if (standard.pct_bodyweight !== undefined && (standard.pct_bodyweight <= 0 || standard.pct_bodyweight > 3)) {
        fail(label, where, `standard.pct_bodyweight ${standard.pct_bodyweight} is outside a sane 0–3 range`, step);
      }
      for (const field of ['reps', 'sets', 'hold_s', 'duration_min', 'distance_mi'] as const) {
        const value = standard[field];
        if (value !== undefined && (typeof value !== 'number' || value <= 0)) {
          fail(label, where, `standard.${field} must be a positive number`, step);
        }
      }
      if (standard.per_hand !== undefined && typeof standard.per_hand !== 'boolean') {
        fail(label, where, 'standard.per_hand must be a boolean', step);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-file reference checks
// ─────────────────────────────────────────────────────────────────────────────

function validateCrossReferences(library: Exercise[], curated: Exercise[]): void {
  const label = path.relative(PATHS.root, PATHS.curatedExercises);
  const known = new Set<string>();
  for (const ex of [...library, ...curated]) {
    known.add(ex.slug);
    known.add(ex.id);
  }
  for (const ex of curated) {
    for (const alt of ex.preferred_alternatives ?? []) {
      if (!known.has(alt)) fail(label, `${label} ${ex.id}`, `preferred_alternatives references unknown slug "${alt}"`, ex);
    }
    for (const bad of ex.contraindicated_with ?? []) {
      if (!known.has(bad)) fail(label, `${label} ${ex.id}`, `contraindicated_with references unknown slug "${bad}"`, ex);
    }
  }
  const curatedIds = new Set(curated.map((e) => e.id));
  const collisions = library.filter((e) => curatedIds.has(e.id));
  for (const clash of collisions) {
    fail(label, `${label} ${clash.id}`, 'id collides with a record in data/exercises.json', clash);
  }
}

function validateImportReview(): void {
  if (!fs.existsSync(PATHS.importReview)) return; // optional artifact
  const label = path.relative(PATHS.root, PATHS.importReview);
  const data = readJson<Record<string, unknown>>(PATHS.importReview);
  for (const field of ['_note', 'generated_by', 'summary', 'files', 'unmatched', 'sets']) {
    if (!(field in data)) fail(label, label, `missing "${field}" — regenerate with scripts/import-csv.ts`);
  }
  if (typeof data._note === 'string' && !/never writes/i.test(data._note)) {
    fail(label, label, '_note must state that the importer never writes to the database');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  process.stdout.write('Longevity OS — data validation\n');

  const library = validateExerciseFile(PATHS.exercises, { curated: false });
  const curated = validateExerciseFile(PATHS.curatedExercises, { curated: true });
  validateMediaFile(library);
  validateProgram(library, curated);
  validateCrossReferences(library, curated);
  validateImportReview();

  process.stdout.write(`  data/exercises.json          ${library.length} records\n`);
  process.stdout.write(`  data/curated-exercises.json  ${curated.length} records\n`);

  if (problems.length) {
    process.stderr.write(`\n✗ ${problems.length} validation problem(s):\n\n`);
    for (const problem of problems.slice(0, 50)) {
      process.stderr.write(`  [${problem.where}] ${problem.message}\n`);
      if (problem.record !== undefined) {
        const json = JSON.stringify(problem.record);
        process.stderr.write(`    offending record: ${json.length > 600 ? `${json.slice(0, 600)}…` : json}\n`);
      }
    }
    if (problems.length > 50) process.stderr.write(`  …and ${problems.length - 50} more\n`);
    process.stderr.write('\nFix the source (scripts/lib/vocab.ts, scripts/curated-exercises.ts, programs/kot/program.json) and re-run the ingest.\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write('  ✓ all generated data validates against packages/engine/src/types.ts\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(`\nValidation crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
}
