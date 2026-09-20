/**
 * Longevity OS — generic training-history CSV importer (PRD §8.10)
 *
 *   npx tsx scripts/import-csv.ts [--dir=<folder>]
 *
 * Reads old-app exports from `docs/imports/raw/` (gitignored — Seth's data stays
 * local), sniffs which app produced each file, normalizes every row to
 * `(date, exercise, set, reps, weight, unit)`, converts kg → lb, fuzzy-matches
 * exercise names against the merged library plus the curated records, and emits
 * `data/reports/import-review.json` for the review screen.
 *
 * IT NEVER WRITES TO THE DATABASE. The output is a reviewable artifact: the app
 * shows unmatched names, Seth maps or discards them, and only then is anything
 * persisted.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Exercise } from '../packages/engine/src/types';
import { PATHS, readJson, writeJson } from './lib/paths';
import { parseCsvFile, pick, firstNumber, type CsvRow } from './lib/csv';
import { nameKey, scorePair } from './lib/normalize';

const KG_TO_LB = 2.20462;

// ─────────────────────────────────────────────────────────────────────────────
// Dialects
// ─────────────────────────────────────────────────────────────────────────────

export type DialectName = 'fitbod' | 'strong' | 'hevy' | 'generic';

export interface Dialect {
  name: DialectName;
  /** Header names that identify this export; all must be present. */
  signature: string[];
  date: string[];
  exercise: string[];
  setIndex: string[];
  reps: string[];
  weight: string[];
  /** Columns whose header itself declares the unit, e.g. `weight_kg`. */
  unit: 'kg' | 'lb' | 'infer';
  warmupFlag?: string[];
  duration?: string[];
  distance?: string[];
}

/**
 * Column layouts for the three apps PRD §8.10 names, plus a permissive
 * fallback. Header matching is case-insensitive and ignores surrounding
 * punctuation, so `Weight (kg)` and `weight_kg` both hit.
 */
export const DIALECTS: Dialect[] = [
  {
    name: 'hevy',
    signature: ['exercise_title', 'set_index'],
    date: ['start_time', 'date'],
    exercise: ['exercise_title'],
    setIndex: ['set_index'],
    reps: ['reps'],
    weight: ['weight_kg', 'weight_lbs', 'weight'],
    unit: 'infer',
    duration: ['duration_seconds'],
    distance: ['distance_km'],
  },
  {
    name: 'strong',
    signature: ['exercise name', 'set order'],
    date: ['date'],
    exercise: ['exercise name'],
    setIndex: ['set order'],
    reps: ['reps'],
    weight: ['weight', 'weight (kg)', 'weight (lbs)', 'weight_kg', 'weight_lbs'],
    unit: 'infer',
    duration: ['seconds', 'duration'],
    distance: ['distance', 'distance (m)', 'distance (mi)'],
  },
  {
    name: 'fitbod',
    signature: ['exercise', 'iswarmup'],
    date: ['date'],
    exercise: ['exercise'],
    setIndex: ['set', 'set number'],
    reps: ['reps'],
    weight: ['weight(lb)', 'weight (lb)', 'weight(lbs)', 'weight (lbs)', 'weight(kg)', 'weight (kg)', 'weight'],
    unit: 'infer',
    warmupFlag: ['iswarmup'],
    duration: ['duration(s)', 'duration'],
    distance: ['distance(m)', 'distance'],
  },
  {
    name: 'generic',
    signature: [],
    date: ['date', 'day', 'workout date', 'start_time', 'timestamp', 'performed_at'],
    exercise: ['exercise', 'exercise name', 'exercise_title', 'movement', 'lift', 'name'],
    setIndex: ['set', 'set order', 'set_index', 'set number', 'setnumber'],
    reps: ['reps', 'rep', 'repetitions', 'count'],
    weight: ['weight', 'weight_kg', 'weight_lbs', 'load', 'lbs', 'kg', 'weight (kg)', 'weight (lb)'],
    unit: 'infer',
    warmupFlag: ['iswarmup', 'warmup', 'is_warmup'],
    duration: ['duration', 'seconds', 'time'],
    distance: ['distance'],
  },
];

/** Normalize a header for comparison: lowercase, collapse punctuation. */
function headerKey(header: string): string {
  return header.toLowerCase().replace(/[\s_]+/g, ' ').replace(/[^a-z0-9()% ]/g, '').trim();
}

export function detectDialect(headers: string[]): Dialect {
  const keys = new Set(headers.map(headerKey));
  for (const dialect of DIALECTS) {
    if (!dialect.signature.length) continue;
    if (dialect.signature.every((sig) => keys.has(headerKey(sig)))) return dialect;
  }
  return DIALECTS[DIALECTS.length - 1]!;
}

/** kg when a header says so, or when a unit column says so; otherwise lb. */
export function detectUnit(headers: string[], rows: CsvRow[]): 'kg' | 'lb' {
  const keys = headers.map(headerKey);
  if (keys.some((k) => /\bkg\b|weight kg|weight \(kg\)/.test(k))) return 'kg';
  if (keys.some((k) => /\blbs?\b|weight lb|weight \(lb/.test(k))) return 'lb';
  const unitCol = rows.find((r) => r['unit'] || r['units'] || r['weight unit']);
  const declared = (unitCol?.['unit'] ?? unitCol?.['units'] ?? unitCol?.['weight unit'] ?? '').toLowerCase();
  if (declared.includes('kg')) return 'kg';
  if (declared.includes('lb')) return 'lb';
  return 'lb';
}

/** Normalize any of the date shapes these apps emit to ISO `YYYY-MM-DD`. */
export function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = trimmed.match(/^(\d{1,2})[/](\d{1,2})[/](\d{2,4})/);
  if (us) {
    const year = us[3]!.length === 2 ? `20${us[3]}` : us[3]!;
    return `${year}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalized rows
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportedSet {
  date: string;
  exercise: string;
  set: number;
  reps: number;
  /** Always pounds — converted from kg when the export was metric. */
  weight_lb: number;
  /** The unit as it appeared in the source file. */
  source_unit: 'kg' | 'lb';
  source_weight: number;
  warmup: boolean;
  source_file: string;
  source_row: number;
  /** Library exercise id, when we could match the name confidently. */
  exercise_id?: string;
  match?: 'exact' | 'fuzzy' | 'unmatched';
  match_score?: number;
  /** Several library entries share this name — the review screen should confirm. */
  ambiguous?: boolean;
}

interface LibraryEntry {
  id: string;
  name: string;
  keys: string[];
  /** Equipment slugs, used to break ties when several entries share a name key. */
  equipment: string[];
}

function loadLibrary(): LibraryEntry[] {
  const merged = fs.existsSync(PATHS.exercises) ? readJson<Exercise[]>(PATHS.exercises) : [];
  const curated = fs.existsSync(PATHS.curatedExercises) ? readJson<Exercise[]>(PATHS.curatedExercises) : [];
  return [...merged, ...curated]
    .map((e) => ({
      id: e.id,
      name: e.name,
      keys: [...new Set([nameKey(e.name), nameKey(e.slug.replace(/-/g, ' ')), ...e.aliases.map(nameKey)])],
      equipment: [...e.equipment],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

interface MatchResult {
  exercise_id?: string;
  match: 'exact' | 'fuzzy' | 'unmatched';
  score: number;
  /** True when several library entries share the matched name key — review it. */
  ambiguous?: boolean;
  suggestions: { exercise_id: string; name: string; score: number }[];
}

/**
 * "Bench Press (Dumbbell)" normalizes to the same key as "Band Bench Press"
 * (leading implement words are stripped when joining datasets). When several
 * library entries tie on the key, prefer the one whose equipment is actually
 * named in the raw source string, then the shortest name. Ties are flagged
 * `ambiguous` so the review screen can offer the alternatives.
 */
function disambiguate(raw: string, candidates: LibraryEntry[]): LibraryEntry {
  const rawTokens = new Set(
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' '),
  );
  const scoreOf = (entry: LibraryEntry): number => {
    const equipmentHits = entry.equipment.filter((slug) =>
      slug.split('_').every((word) => rawTokens.has(word)),
    ).length;
    return equipmentHits * 10 - entry.name.length / 100;
  };
  return [...candidates].sort(
    (a, b) => scoreOf(b) - scoreOf(a) || a.name.length - b.name.length || a.id.localeCompare(b.id),
  )[0]!;
}

function matchExercise(name: string, library: LibraryEntry[], cache: Map<string, MatchResult>): MatchResult {
  const key = nameKey(name);
  const cached = cache.get(key);
  if (cached) return cached;

  const exactCandidates = library.filter((e) => e.keys.includes(key));
  if (exactCandidates.length) {
    const winner = disambiguate(name, exactCandidates);
    const result: MatchResult = {
      exercise_id: winner.id,
      match: 'exact',
      score: 1,
      ...(exactCandidates.length > 1 ? { ambiguous: true } : {}),
      suggestions:
        exactCandidates.length > 1
          ? exactCandidates
              .filter((e) => e.id !== winner.id)
              .slice(0, 5)
              .map((e) => ({ exercise_id: e.id, name: e.name, score: 1 }))
          : [],
    };
    cache.set(key, result);
    return result;
  }

  const scored: { exercise_id: string; name: string; score: number }[] = [];
  for (const entry of library) {
    let best = 0;
    for (const candidate of entry.keys) {
      const score = scorePair(key, candidate);
      if (score && score.score > best) best = score.score;
    }
    if (best > 0) scored.push({ exercise_id: entry.id, name: entry.name, score: Math.round(best * 1000) / 1000 });
  }
  scored.sort((a, b) => b.score - a.score || a.exercise_id.localeCompare(b.exercise_id));
  const top = scored[0];
  const result: MatchResult =
    top && top.score >= 0.85
      ? { exercise_id: top.exercise_id, match: 'fuzzy', score: top.score, suggestions: scored.slice(0, 5) }
      : { match: 'unmatched', score: top?.score ?? 0, suggestions: scored.slice(0, 5) };
  cache.set(key, result);
  return result;
}

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(csv|tsv|txt)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function sourceDirFromArgs(): string {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--dir='));
  return arg ? path.resolve(arg.slice('--dir='.length)) : PATHS.importsRawDir;
}

function main(): void {
  process.stdout.write('Longevity OS — history CSV import (review only, nothing is persisted)\n');
  const dir = sourceDirFromArgs();
  const files = listSourceFiles(dir);
  const library = loadLibrary();
  const cache = new Map<string, MatchResult>();

  const fileSummaries: {
    file: string;
    dialect: DialectName;
    unit: 'kg' | 'lb';
    rows: number;
    imported: number;
    skipped: number;
    headers: string[];
  }[] = [];
  const sets: ImportedSet[] = [];
  const unmatched = new Map<string, { name: string; occurrences: number; suggestions: MatchResult['suggestions'] }>();
  const matchedNames = new Map<
    string,
    {
      name: string;
      exercise_id: string;
      match: string;
      score: number;
      occurrences: number;
      ambiguous?: boolean;
      alternatives?: MatchResult['suggestions'];
    }
  >();

  for (const file of files) {
    const { headers, rows } = parseCsvFile(file);
    const dialect = detectDialect(headers);
    const unit = detectUnit(headers, rows);
    let imported = 0;
    let skipped = 0;

    rows.forEach((row, index) => {
      const exerciseName = pick(row, dialect.exercise) ?? pick(row, DIALECTS[3]!.exercise);
      const date = normalizeDate(pick(row, dialect.date) ?? pick(row, DIALECTS[3]!.date));
      const reps = firstNumber(pick(row, dialect.reps) ?? pick(row, DIALECTS[3]!.reps));
      if (!exerciseName || !date || reps === undefined) {
        skipped += 1;
        return;
      }
      const rawWeight = firstNumber(pick(row, dialect.weight) ?? pick(row, DIALECTS[3]!.weight)) ?? 0;
      const weightLb = unit === 'kg' ? Math.round(rawWeight * KG_TO_LB * 10) / 10 : rawWeight;
      const setIndex = firstNumber(pick(row, dialect.setIndex) ?? '') ?? imported + 1;
      const warmupRaw = (dialect.warmupFlag ? pick(row, dialect.warmupFlag) : undefined) ?? '';
      const match = matchExercise(exerciseName, library, cache);

      const record: ImportedSet = {
        date,
        exercise: exerciseName,
        set: setIndex,
        reps,
        weight_lb: weightLb,
        source_unit: unit,
        source_weight: rawWeight,
        warmup: /^(true|yes|1)$/i.test(warmupRaw.trim()),
        source_file: path.basename(file),
        source_row: index + 2,
        match: match.match,
      };
      if (match.exercise_id) record.exercise_id = match.exercise_id;
      if (match.match !== 'exact') record.match_score = match.score;
      if (match.ambiguous) record.ambiguous = true;
      sets.push(record);
      imported += 1;

      const key = nameKey(exerciseName);
      if (match.match === 'unmatched') {
        const prev = unmatched.get(key);
        if (prev) prev.occurrences += 1;
        else unmatched.set(key, { name: exerciseName, occurrences: 1, suggestions: match.suggestions });
      } else {
        const prev = matchedNames.get(key);
        if (prev) prev.occurrences += 1;
        else
          matchedNames.set(key, {
            name: exerciseName,
            exercise_id: match.exercise_id!,
            match: match.match,
            score: match.score,
            occurrences: 1,
            ...(match.ambiguous ? { ambiguous: true, alternatives: match.suggestions } : {}),
          });
      }
    });

    fileSummaries.push({
      file: path.basename(file),
      dialect: dialect.name,
      unit,
      rows: rows.length,
      imported,
      skipped,
      headers,
    });
    process.stdout.write(
      `  ${path.basename(file)}: ${dialect.name} dialect, ${unit} → lb, ${imported} sets, ${skipped} rows skipped\n`,
    );
  }

  sets.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.source_file.localeCompare(b.source_file) ||
      a.source_row - b.source_row ||
      a.set - b.set,
  );

  const review = {
    _note:
      'REVIEW ARTIFACT ONLY — scripts/import-csv.ts never writes to the database. The app shows `unmatched` on the ' +
      'import review screen; Seth maps or discards each name, and only then is history persisted.',
    generated_by: 'scripts/import-csv.ts',
    source_directory: path.relative(PATHS.root, dir) || '.',
    summary: {
      files: files.length,
      sets: sets.length,
      distinct_exercise_names: matchedNames.size + unmatched.size,
      matched_exact: [...matchedNames.values()].filter((m) => m.match === 'exact').length,
      matched_fuzzy: [...matchedNames.values()].filter((m) => m.match === 'fuzzy').length,
      unmatched: unmatched.size,
      ambiguous: [...matchedNames.values()].filter((m) => m.ambiguous).length,
      library_size: library.length,
    },
    files: fileSummaries,
    unmatched: [...unmatched.values()].sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name)),
    matched: [...matchedNames.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sets,
  };

  writeJson(PATHS.importReview, review);

  if (!files.length) {
    process.stdout.write(
      `  ${dir} is empty — nothing to import (this is the normal state today).\n` +
        "  Drop Fitbod / Strong / Hevy CSV exports there and re-run; the file layout is sniffed automatically.\n",
    );
  }
  process.stdout.write(
    `  ${sets.length} sets · ${review.summary.matched_exact} exact · ${review.summary.matched_fuzzy} fuzzy · ` +
      `${review.summary.unmatched} unmatched names\n  wrote ${PATHS.importReview}\n`,
  );
}

try {
  main();
} catch (err) {
  process.stderr.write(`\nImport failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
}
