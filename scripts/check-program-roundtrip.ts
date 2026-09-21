/**
 * CHECK-PROGRAM-ROUNDTRIP — the program survives the trip through Postgres
 *
 * `programs/kot/program.json` is the source of truth. It becomes SQL
 * (`scripts/gen-kot-sql.ts`), the SQL becomes rows, and the rows become an
 * engine `Program` again (`toProgram` in `@longevity/db`). Three translations,
 * each individually plausible, and a mistake in any one of them shows up not as
 * an error but as a session missing an exercise.
 *
 * So this closes the loop: read the rows back out of a real database and assert
 * that what comes out is what went in. Everything the engine reads is compared
 * — phases and their load rules, weekday templates down to the step ids in each
 * block, and every field of every step.
 *
 * Needs a live, migrated database, so it runs in the `migrations` CI job
 * alongside the RLS checks rather than in `npm run check`. Connection comes
 * from the standard PG* environment variables, via psql.
 *
 * Usage:  npx tsx scripts/check-program-roundtrip.ts
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { toProgram, toProgramProgress } from '@longevity/db';
import type { Program, ProgramProgress } from '@longevity/engine';
import { PATHS } from './lib/paths.js';

/** One row set, as JSON, straight out of Postgres. */
function query<T>(sql: string): T {
  const wrapped = `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`;
  let out: string;
  try {
    out = execFileSync('psql', ['-tA', '-v', 'ON_ERROR_STOP=1', '-c', wrapped], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `could not reach Postgres through psql — this check needs a live, migrated database.\n${msg}\n`,
    );
    process.exit(2);
  }
  return JSON.parse(out) as T;
}

/**
 * Compare two values structurally and report the PATH to each difference.
 *
 * `JSON.stringify(a) === JSON.stringify(b)` would answer the question and tell
 * you nothing useful when the answer is no — and the objects here are a 69-step
 * program, where "they differ" is not an actionable message.
 *
 * `undefined` and an absent key are treated as the same thing: the engine's
 * optional fields are written as absent, and a jsonb round trip through
 * Postgres cannot preserve the distinction anyway.
 */
function diff(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (a === b) return out;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      out.push(`${path}: one is an array and the other is not`);
      return out;
    }
    if (a.length !== b.length) out.push(`${path}: length ${a.length} → ${b.length}`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff(a[i], b[i], `${path}[${i}]`, out);
    }
    return out;
  }

  const objA = typeof a === 'object' && a !== null;
  const objB = typeof b === 'object' && b !== null;
  if (objA && objB) {
    const keys = new Set([
      ...Object.keys(a as object),
      ...Object.keys(b as object),
    ]);
    for (const k of keys) {
      const va = (a as Record<string, unknown>)[k];
      const vb = (b as Record<string, unknown>)[k];
      if (va === undefined && vb === undefined) continue;
      diff(va, vb, path ? `${path}.${k}` : k, out);
    }
    return out;
  }

  out.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  return out;
}

interface SourceProgram extends Program {
  /** Provenance and open questions, for humans. Never reaches the database. */
  _note?: string;
}

function main(): void {
  const source = JSON.parse(readFileSync(PATHS.kotProgram, 'utf8')) as SourceProgram;
  const { _note, ...expected } = source;
  void _note;

  const [programRow] = query<Record<string, unknown>[]>(
    `select * from public.programs where slug = 'kot' and user_id is null`,
  );
  if (!programRow) {
    process.stderr.write("no global 'kot' program in the database — 0011 did not run.\n");
    process.exit(1);
  }

  const stepRows = query<Record<string, unknown>[]>(
    `select s.* from public.program_steps s
      where s.program_id = (select id from public.programs where slug = 'kot' and user_id is null)
      order by s.step_order`,
  );

  const actual = toProgram(programRow, stepRows);
  if (!actual) {
    process.stderr.write('toProgram rejected the rows it was given.\n');
    process.exit(1);
  }

  process.stdout.write('Longevity OS — program round trip\n\n');
  process.stdout.write(
    `  json → sql → postgres → rows → Program\n` +
      `  ${expected.steps.length} steps · ${(expected.phases ?? []).length} phases · ` +
      `${(expected.days ?? []).length} weekday templates\n\n`,
  );

  const problems = diff(expected, actual);

  // The progress default is the other half of the contract: it is what a
  // brand-new athlete gets, and `start_program` must agree with it.
  // Both files carry a `_note`: provenance and open questions, for humans. It
  // is deliberately not a column, so it is not part of what round-trips.
  const { _note: _progressNote, ...progressDefault } = JSON.parse(
    readFileSync(PATHS.kotProgram.replace('program.json', 'progress-default.json'), 'utf8'),
  ) as ProgramProgress & { _note?: string };
  void _progressNote;
  const mapped = toProgramProgress(
    {
      cycle: progressDefault.cycle,
      met: progressDefault.met,
      current_step_ids: progressDefault.current_step_ids,
      phase_id: progressDefault.phase_id ?? null,
      week_in_phase: progressDefault.week_in_phase ?? null,
    },
    actual,
  );
  for (const p of diff(progressDefault, mapped, 'progress')) problems.push(p);

  if (problems.length) {
    process.stderr.write(
      `the program does not survive the round trip — ${problems.length} difference${
        problems.length === 1 ? '' : 's'
      }:\n`,
    );
    for (const p of problems.slice(0, 40)) process.stderr.write(`  ${p}\n`);
    if (problems.length > 40) process.stderr.write(`  … and ${problems.length - 40} more\n`);
    process.stderr.write(
      '\nEither scripts/gen-kot-sql.ts drops something, or toProgram in\n' +
        'packages/db/src/program.ts does. Both are the same bug from Seth’s side:\n' +
        'an exercise that silently never appears.\n',
    );
    process.exit(1);
  }

  const days = actual.days ?? [];
  const stepIds = new Set(actual.steps.map((s) => s.id));
  const slots = days.reduce(
    (n, d) => n + d.blocks.reduce((m, b) => m + b.step_ids.length, 0),
    0,
  );
  const dangling = days
    .flatMap((d) => d.blocks.flatMap((b) => b.step_ids))
    .filter((id) => !stepIds.has(id));

  if (dangling.length) {
    process.stderr.write(`weekday templates name steps that do not exist: ${[...new Set(dangling)].join(', ')}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `  ✓ identical, field for field\n` +
      `  ✓ ${slots} template slots across ${days.length} days, every one resolving to a real step\n` +
      `  ✓ the cold-start progress record maps to ${mapped.phase_id ?? '(no phase)'}, week ${
        mapped.week_in_phase ?? '?'
      }, ${mapped.current_step_ids.length} steps in play\n`,
  );
}

main();
