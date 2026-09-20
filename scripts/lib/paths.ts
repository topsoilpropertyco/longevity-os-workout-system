/**
 * Longevity OS — script paths & deterministic IO helpers
 *
 * Every generated artifact in `data/` must be byte-identical for identical
 * inputs (CLAUDE.md: reports and generated data are committed, so a rerun must
 * not produce a noisy diff). All writes go through `writeJson` / `writeText`,
 * which sort object keys and normalize line endings.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Walk up from the running script (or cwd) until we find the repo root — the
 * directory holding CLAUDE.md and data/. Avoids depending on cwd so the
 * scripts work from anywhere.
 */
export function repoRoot(): string {
  const starts = [
    process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : undefined,
    process.cwd(),
  ].filter(Boolean) as string[];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 12; i += 1) {
      if (fs.existsSync(path.join(dir, 'CLAUDE.md')) && fs.existsSync(path.join(dir, 'data'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error('Could not locate the longevity-os repo root (looked for CLAUDE.md + data/).');
}

export const ROOT = repoRoot();

export const PATHS = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  rawDir: path.join(ROOT, 'data', 'raw'),
  reportsDir: path.join(ROOT, 'data', 'reports'),
  programsDir: path.join(ROOT, 'programs'),
  freeExerciseDb: path.join(ROOT, 'data', 'raw', 'free-exercise-db.json'),
  gymVisual: path.join(ROOT, 'data', 'raw', 'gymvisual-exercises.json'),
  gymVisualNotice: path.join(ROOT, 'data', 'raw', 'gymvisual-NOTICE.md'),
  exercises: path.join(ROOT, 'data', 'exercises.json'),
  curatedExercises: path.join(ROOT, 'data', 'curated-exercises.json'),
  exerciseMedia: path.join(ROOT, 'data', 'exercise-media.json'),
  mediaCoverageReport: path.join(ROOT, 'data', 'reports', 'media-coverage.md'),
  kotReconciliationReport: path.join(ROOT, 'data', 'reports', 'kot-reconciliation.md'),
  importReview: path.join(ROOT, 'data', 'reports', 'import-review.json'),
  kotProgram: path.join(ROOT, 'programs', 'kot', 'program.json'),
  kotRawDir: path.join(ROOT, 'docs', 'programs', 'kot', 'raw'),
  importsRawDir: path.join(ROOT, 'docs', 'imports', 'raw'),
} as const;

/** Remote sources, re-downloaded by ingest-exercises.ts when the raw file is absent. */
export const SOURCE_URLS = {
  freeExerciseDb:
    'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json',
  freeExerciseDbImageBase:
    'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/',
  gymVisual:
    'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json',
  gymVisualMediaBase: 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/',
  gymVisualNotice:
    'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/NOTICE.md',
} as const;

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Recursively sort object keys so JSON.stringify output is stable. */
export function sortDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sortDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      const v = src[key];
      if (v === undefined) continue; // undefined would vanish anyway — drop it deterministically
      out[key] = sortDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Deterministic JSON write: sorted keys, 2-space indent, single trailing newline, LF. */
export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const text = `${JSON.stringify(sortDeep(value), null, 2).replace(/\r\n/g, '\n')}\n`;
  fs.writeFileSync(file, text, 'utf8');
}

export function writeText(file: string, text: string): void {
  ensureDir(path.dirname(file));
  const normalized = `${text.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`;
  fs.writeFileSync(file, normalized, 'utf8');
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function exists(file: string): boolean {
  return fs.existsSync(file);
}

/** Download a URL to disk. Used only when a raw dataset is missing (they are gitignored). */
export async function download(url: string, dest: string): Promise<void> {
  process.stdout.write(`  downloading ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  const body = await res.text();
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, body, 'utf8');
}
