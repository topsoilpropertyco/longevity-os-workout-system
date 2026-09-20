/**
 * Longevity OS — KOT spreadsheet reconciliation
 *
 *   npx tsx scripts/ingest-kot.ts
 *
 * Reads Seth's own Knees Over Toes spreadsheets from `docs/programs/kot/raw/`
 * (gitignored — his material stays local), compares them against the PUBLIC
 * scaffold in `programs/kot/program.json`, and writes a diff at
 * `data/reports/kot-reconciliation.md`:
 *
 *   - steps only in his sheet   → the scaffold is missing them
 *   - steps only in the scaffold → we invented them; delete or confirm
 *   - standards that disagree    → his numbers win
 *
 * Today the directory is empty and that is the normal state: the script says so
 * and exits 0. XLSX parsing needs the optional `xlsx` package; when it is absent
 * the script prints the one command that fixes it instead of failing.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Program, ProgramStandard, ProgramStep } from '../packages/engine/src/types';
import { PATHS, readJson, writeText } from './lib/paths';
import { allNumbers, firstNumber, parseCsvFile, pick, type CsvRow } from './lib/csv';
import { nameKey, scorePair } from './lib/normalize';

/** Column headers we look for, loosest first. Seth's sheets will not match exactly. */
export const KOT_SHEET_COLUMNS = {
  name: ['step', 'exercise', 'movement', 'name', 'lift', 'drill'],
  standard: ['standard', 'standards', 'goal', 'target', 'requirement', 'criteria'],
  block: ['block', 'section', 'group', 'category', 'phase', 'level'],
  sets: ['sets', 'set'],
  reps: ['reps', 'rep', 'repetitions'],
  load: ['load', 'weight', 'percent', 'percent bw', '%bw', 'pct bw', 'bodyweight', '% bw'],
  notes: ['note', 'notes', 'comment', 'comments'],
} as const;

interface SheetStep {
  file: string;
  rowNumber: number;
  name: string;
  key: string;
  block?: string;
  standardText: string;
  standard: ProgramStandard;
}

interface Comparison {
  sheet: SheetStep;
  step: ProgramStep;
  how: 'exact' | 'fuzzy';
  score: number;
  disagreements: string[];
}

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(csv|tsv|xlsx|xlsm|xls)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Percent cells arrive as "25%", "0.25", "25% BW", "25 percent". Normalize to a fraction. */
function parsePctBodyweight(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = raw.toLowerCase();
  if (!/%|percent|bw|bodyweight/.test(value)) return undefined;
  const n = firstNumber(value);
  if (n === undefined) return undefined;
  return n > 1.5 ? Math.round((n / 100) * 1000) / 1000 : n;
}

/** "5x5", "3 x 10", "5 sets of 5" → sets/reps. */
function parseSetsReps(raw: string | undefined): { sets?: number; reps?: number } {
  if (!raw) return {};
  const m = raw.toLowerCase().match(/(\d+)\s*(?:x|×|sets? of)\s*(\d+)/);
  if (m) return { sets: Number(m[1]), reps: Number(m[2]) };
  return {};
}

function rowToSheetStep(file: string, rowNumber: number, row: CsvRow): SheetStep | null {
  const name = pick(row, [...KOT_SHEET_COLUMNS.name]);
  if (!name) return null;
  const standardCell = pick(row, [...KOT_SHEET_COLUMNS.standard]) ?? '';
  const notes = pick(row, [...KOT_SHEET_COLUMNS.notes]) ?? '';
  const loadCell = pick(row, [...KOT_SHEET_COLUMNS.load]) ?? '';
  const setsCell = pick(row, [...KOT_SHEET_COLUMNS.sets]);
  const repsCell = pick(row, [...KOT_SHEET_COLUMNS.reps]);

  const combined = [standardCell, loadCell, notes].filter(Boolean).join(' ');
  const fromText = parseSetsReps(combined);
  const standard: ProgramStandard = {};
  const pct = parsePctBodyweight(loadCell) ?? parsePctBodyweight(standardCell);
  if (pct !== undefined) standard.pct_bodyweight = pct;
  if (/per hand|each hand|per side|each side/i.test(combined)) standard.per_hand = true;
  const sets = firstNumber(setsCell) ?? fromText.sets;
  const reps = firstNumber(repsCell) ?? fromText.reps;
  if (sets !== undefined) standard.sets = sets;
  if (reps !== undefined) standard.reps = reps;
  const holdMatch = combined.match(/(\d+)\s*(?:s|sec|seconds?)\b/i);
  if (holdMatch) standard.hold_s = Number(holdMatch[1]);
  const minMatch = combined.match(/(\d+)\s*(?:min|minutes?)\b/i);
  if (minMatch) standard.duration_min = Number(minMatch[1]);

  return {
    file: path.basename(file),
    rowNumber,
    name,
    key: nameKey(name),
    block: pick(row, [...KOT_SHEET_COLUMNS.block]),
    standardText: standardCell || [loadCell, setsCell && `${setsCell} sets`, repsCell && `${repsCell} reps`, notes]
      .filter(Boolean)
      .join(' · '),
    standard,
  };
}

async function readXlsx(file: string): Promise<{ rows: CsvRow[] } | { unavailable: true }> {
  try {
    // Optional dependency — we never add a hard dep for a file format Seth may not
    // use. The specifier is a variable so TypeScript does not demand the types.
    const specifier = 'xlsx';
    const mod: any = await import(specifier);
    const wb = mod.readFile(file);
    const rows: CsvRow[] = [];
    for (const sheetName of wb.SheetNames) {
      const json: Record<string, unknown>[] = mod.utils.sheet_to_json(wb.Sheets[sheetName], {
        defval: '',
        raw: false,
      });
      for (const r of json) {
        const row: CsvRow = {};
        for (const [k, v] of Object.entries(r)) row[String(k).trim().toLowerCase()] = String(v).trim();
        rows.push(row);
      }
    }
    return { rows };
  } catch {
    return { unavailable: true };
  }
}

function compareStandards(sheet: ProgramStandard, scaffold: ProgramStandard | undefined): string[] {
  if (!scaffold) return [];
  const out: string[] = [];
  const fields: (keyof ProgramStandard)[] = [
    'pct_bodyweight',
    'per_hand',
    'reps',
    'sets',
    'hold_s',
    'duration_min',
    'distance_mi',
  ];
  for (const field of fields) {
    const a = sheet[field];
    const b = scaffold[field];
    if (a === undefined || b === undefined) continue;
    if (a !== b) out.push(`${field}: sheet says ${String(a)}, scaffold says ${String(b)}`);
  }
  return out;
}

function reconcile(sheetSteps: SheetStep[], program: Program) {
  const matched: Comparison[] = [];
  const usedStepIds = new Set<string>();

  const stepKeys = program.steps.map((step) => ({
    step,
    keys: [nameKey(step.name), nameKey(step.exercise_slug.replace(/-/g, ' '))],
  }));

  for (const sheet of [...sheetSteps].sort((a, b) => a.key.localeCompare(b.key))) {
    let best: { step: ProgramStep; how: 'exact' | 'fuzzy'; score: number } | undefined;
    for (const { step, keys } of stepKeys) {
      if (usedStepIds.has(step.id)) continue;
      if (keys.includes(sheet.key)) {
        best = { step, how: 'exact', score: 1 };
        break;
      }
      for (const key of keys) {
        const score = scorePair(sheet.key, key);
        if (score && score.score > (best?.score ?? 0)) best = { step, how: 'fuzzy', score: score.score };
      }
    }
    if (!best) continue;
    usedStepIds.add(best.step.id);
    matched.push({
      sheet,
      step: best.step,
      how: best.how,
      score: Math.round(best.score * 1000) / 1000,
      disagreements: compareStandards(sheet.standard, best.step.standard),
    });
  }

  const sheetOnly = sheetSteps.filter((s) => !matched.some((m) => m.sheet === s));
  const scaffoldOnly = program.steps.filter((s) => !usedStepIds.has(s.id));
  return { matched, sheetOnly, scaffoldOnly };
}

function emptyReport(files: string[], program: Program): string {
  return [
    '# KOT Reconciliation Report',
    '',
    `Generated by \`scripts/ingest-kot.ts\` · source directory \`docs/programs/kot/raw/\` · ${files.length} file(s) found.`,
    '',
    '## Nothing to reconcile yet',
    '',
    "Seth has not dropped his Knees Over Toes spreadsheets into `docs/programs/kot/raw/` yet, so there is nothing to compare.",
    'This is the expected state today, not an error.',
    '',
    '**What the app is using in the meantime:** the PUBLIC scaffold at `programs/kot/program.json`',
    `(${program.steps.length} steps across ${program.blocks.length} blocks, source: \`${program.source}\`).`,
    'It is a placeholder built from `docs/RESEARCH_FOUNDATION.md` §7 — not Seth\'s program.',
    '',
    '## To reconcile',
    '',
    '1. Drop the CSV or XLSX exports into `docs/programs/kot/raw/` (they stay local; the directory is gitignored).',
    '2. Run `npx tsx scripts/ingest-kot.ts`.',
    '3. Read this report and correct `programs/kot/program.json` — his numbers win over the scaffold.',
    '',
    'Useful column headers (any one of each group is recognized):',
    '',
    ...Object.entries(KOT_SHEET_COLUMNS).map(
      ([field, cols]) => `- **${field}** — ${(cols as readonly string[]).map((c) => `\`${c}\``).join(', ')}`,
    ),
  ].join('\n');
}

function buildReport(
  files: string[],
  program: Program,
  result: ReturnType<typeof reconcile>,
  xlsxSkipped: string[],
): string {
  const lines: string[] = [];
  lines.push('# KOT Reconciliation Report');
  lines.push('');
  lines.push(
    `Generated by \`scripts/ingest-kot.ts\`. Sheets: ${files.map((f) => `\`${path.basename(f)}\``).join(', ')}. ` +
      `Scaffold: \`programs/kot/program.json\` (${program.steps.length} steps).`,
  );
  lines.push('');
  lines.push("**Seth's sheet is the source of truth. Where they disagree, change the scaffold.**");
  lines.push('');

  if (xlsxSkipped.length) {
    lines.push('## ⚠️ Skipped XLSX files');
    lines.push('');
    lines.push('The optional `xlsx` package is not installed, so these files were not read:');
    lines.push('');
    for (const f of xlsxSkipped) lines.push(`- \`${path.basename(f)}\``);
    lines.push('');
    lines.push('Fix with `npm install --no-save xlsx` and re-run, or re-export the sheets as CSV.');
    lines.push('');
  }

  lines.push('## 1. Steps only in Seth\'s sheet (missing from the scaffold)');
  lines.push('');
  if (result.sheetOnly.length) {
    lines.push('| Sheet | Row | Step | Standard as written |');
    lines.push('| --- | ---: | --- | --- |');
    for (const s of result.sheetOnly) {
      lines.push(`| ${s.file} | ${s.rowNumber} | ${s.name} | ${s.standardText || '—'} |`);
    }
  } else {
    lines.push('_None — every row in the sheet matched a scaffold step._');
  }
  lines.push('');

  lines.push('## 2. Steps only in the scaffold (we invented them)');
  lines.push('');
  if (result.scaffoldOnly.length) {
    lines.push('| Step id | Name | Block | Standard |');
    lines.push('| --- | --- | --- | --- |');
    for (const s of result.scaffoldOnly) {
      lines.push(`| \`${s.id}\` | ${s.name} | ${s.block} | ${s.standard_text} |`);
    }
    lines.push('');
    lines.push('Delete these from `programs/kot/program.json` unless Seth confirms he does them.');
  } else {
    lines.push('_None — every scaffold step appears in the sheet._');
  }
  lines.push('');

  lines.push('## 3. Standards that disagree');
  lines.push('');
  const conflicts = result.matched.filter((m) => m.disagreements.length);
  if (conflicts.length) {
    lines.push('| Step | Sheet row | Match | Disagreement |');
    lines.push('| --- | --- | --- | --- |');
    for (const c of conflicts) {
      lines.push(
        `| \`${c.step.id}\` ${c.step.name} | ${c.sheet.file}:${c.sheet.rowNumber} | ${c.how} (${c.score}) | ${c.disagreements.join('; ')} |`,
      );
    }
  } else {
    lines.push('_No numeric disagreements found among the matched steps._');
  }
  lines.push('');

  lines.push('## 4. Matched steps (for the record)');
  lines.push('');
  lines.push('| Step id | Sheet row | Match | Sheet standard | Scaffold standard |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const m of result.matched) {
    lines.push(
      `| \`${m.step.id}\` | ${m.sheet.file}:${m.sheet.rowNumber} ${m.sheet.name} | ${m.how} (${m.score}) | ${m.sheet.standardText || '—'} | ${m.step.standard_text} |`,
    );
  }
  lines.push('');
  lines.push(
    '> Fuzzy matches are name-similarity guesses. Check each one before trusting the disagreement list above.',
  );
  return lines.join('\n');
}

/** `--dir=<path>` overrides the source directory (used by tests; defaults to docs/programs/kot/raw/). */
function sourceDirFromArgs(): string {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--dir='));
  return arg ? path.resolve(arg.slice('--dir='.length)) : PATHS.kotRawDir;
}

async function main(): Promise<void> {
  process.stdout.write('Longevity OS — KOT reconciliation\n');
  const program = readJson<Program>(PATHS.kotProgram);
  const sourceDir = sourceDirFromArgs();
  const files = listSourceFiles(sourceDir);

  if (!files.length) {
    writeText(PATHS.kotReconciliationReport, emptyReport(files, program));
    process.stdout.write(
      `  ${sourceDir} is empty — nothing to reconcile (this is the normal state today).\n` +
        `  The app is using the PUBLIC scaffold: ${program.steps.length} steps, source "${program.source}".\n` +
        `  Drop Seth's CSV/XLSX exports into docs/programs/kot/raw/ and re-run.\n` +
        `  wrote ${PATHS.kotReconciliationReport}\n`,
    );
    return;
  }

  const sheetSteps: SheetStep[] = [];
  const xlsxSkipped: string[] = [];
  for (const file of files) {
    if (/\.(xlsx|xlsm|xls)$/i.test(file)) {
      const result = await readXlsx(file);
      if ('unavailable' in result) {
        xlsxSkipped.push(file);
        process.stdout.write(
          `  ! ${path.basename(file)} is a spreadsheet and the optional "xlsx" package is not installed.\n` +
            '    Run: npm install --no-save xlsx    (or re-export that file as CSV) and run this script again.\n',
        );
        continue;
      }
      result.rows.forEach((row, i) => {
        const step = rowToSheetStep(file, i + 2, row);
        if (step) sheetSteps.push(step);
      });
      continue;
    }
    const { rows } = parseCsvFile(file);
    rows.forEach((row, i) => {
      const step = rowToSheetStep(file, i + 2, row);
      if (step) sheetSteps.push(step);
    });
  }

  if (!sheetSteps.length) {
    writeText(
      PATHS.kotReconciliationReport,
      [
        emptyReport(files, program),
        '',
        '## Files were found but no step rows could be read',
        '',
        ...files.map((f) => `- \`${path.basename(f)}\``),
        '',
        'No column matching a step/exercise name was recognized. Rename a column to `exercise` or `step` and re-run.',
      ].join('\n'),
    );
    process.stdout.write(
      `  found ${files.length} file(s) but recognized no step rows — see ${PATHS.kotReconciliationReport}\n`,
    );
    return;
  }

  const result = reconcile(sheetSteps, program);
  writeText(PATHS.kotReconciliationReport, buildReport(files, program, result, xlsxSkipped));
  process.stdout.write(
    `  ${sheetSteps.length} sheet rows · ${result.matched.length} matched · ` +
      `${result.sheetOnly.length} sheet-only · ${result.scaffoldOnly.length} scaffold-only · ` +
      `${result.matched.filter((m) => m.disagreements.length).length} standards disagree\n` +
      `  wrote ${PATHS.kotReconciliationReport}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`\nKOT reconciliation failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
