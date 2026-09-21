/**
 * SEED-SUPABASE — put the reference data into a live Supabase project
 *
 * The migrations create the schema and seed the two things small enough to be
 * SQL: the equipment catalog and the Knees Over Toes program. The exercise
 * library is neither — 1,908 exercises with their media, which as an INSERT
 * script would be a megabyte of SQL nobody could paste into an editor.
 *
 * So it goes over the wire, once, from here.
 *
 * What it writes is REFERENCE DATA ONLY: rows with `user_id is null`, shared by
 * every athlete. It never touches a session, a log, a measurement or a token.
 * That is what makes it safe to re-run, and it is re-run every time the library
 * is regenerated.
 *
 * With `--user <uuid>` it also does the one-time setup that needs an athlete:
 * applies the three location presets and enrols them in Knees Over Toes at
 * phase one, week one. Both are idempotent — `apply_location_preset` and
 * `start_program` are written so a second call changes nothing.
 *
 * Needs the SERVICE ROLE key, because RLS is on and reference rows belong to
 * nobody. That key bypasses every policy in the database: it belongs in
 * `.env.local` on Seth's Mac and in Vercel's environment, and nowhere else —
 * never in a browser, never in this repository.
 *
 * Usage:
 *   npx tsx scripts/seed-supabase.ts                 # reference data
 *   npx tsx scripts/seed-supabase.ts --user <uuid>   # …plus that athlete's setup
 *   npx tsx scripts/seed-supabase.ts --dry-run       # say what it would write
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PATHS } from './lib/paths.js';

// ─────────────────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A twelve-line `.env.local` reader.
 *
 * `dotenv` would do this, and adding a dependency to read a file of `KEY=value`
 * lines is not a trade this repo makes. Real environment variables win over the
 * file, so CI and Vercel can override without editing anything.
 */
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(path.join(PATHS.root, '.env.local'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (process.env[key] !== undefined) continue;
    let value = m[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source data
// ─────────────────────────────────────────────────────────────────────────────

interface SourceExercise {
  slug: string;
  name: string;
  aliases?: string[];
  pattern: string;
  force?: string;
  mechanic?: string;
  level?: string;
  equipment?: string[];
  region_loads?: Record<string, number>;
  load_style?: string;
  barbell_free?: boolean;
  eccentric_dominant?: boolean;
  plyo_contacts_per_rep?: number;
  kot_step?: string;
  cue?: string;
  instructions?: string[];
  preferred_alternatives?: string[];
  contraindicated_with?: string[];
  rehab_for?: string[];
  source?: string;
}

interface MediaEntry {
  gif_url?: string;
  thumb_url?: string;
  image_urls?: string[];
  attribution?: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/**
 * The library is two files and always has been. `data/exercises.json` is the
 * ingested spine; `data/curated-exercises.json` holds the movements no public
 * database has — the Knees Over Toes work, most of it. Loading only the spine
 * silently drops 32 of the program's 69 steps, so both are loaded, everywhere,
 * and the curated file wins on a slug collision because it is the one written
 * deliberately.
 */
function library(): SourceExercise[] {
  const spine = readJson<SourceExercise[]>(PATHS.exercises);
  const curated = readJson<SourceExercise[]>(PATHS.curatedExercises);
  const bySlug = new Map<string, SourceExercise>();
  for (const e of spine) bySlug.set(e.slug, e);
  for (const e of curated) bySlug.set(e.slug, e);
  return [...bySlug.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PostgREST takes the whole batch in one statement, so a batch that is too
 * large fails on request size rather than on anything to do with the data. 500
 * rows of this shape is comfortably inside every limit and still only four
 * round trips for the whole library.
 */
const BATCH = 500;

function toExerciseRow(e: SourceExercise): Record<string, unknown> {
  return {
    user_id: null,
    slug: e.slug,
    name: e.name,
    aliases: e.aliases ?? [],
    pattern: e.pattern,
    force: e.force ?? 'unknown',
    mechanic: e.mechanic ?? 'unknown',
    level: e.level ?? 'intermediate',
    equipment: e.equipment ?? [],
    region_loads: e.region_loads ?? {},
    load_style: e.load_style ?? 'none',
    barbell_free: e.barbell_free ?? false,
    eccentric_dominant: e.eccentric_dominant ?? false,
    plyo_contacts_per_rep: e.plyo_contacts_per_rep ?? 0,
    kot_step: e.kot_step ?? null,
    cue: e.cue ?? null,
    instructions: e.instructions ?? [],
    preferred_alternatives: e.preferred_alternatives ?? [],
    contraindicated_with: e.contraindicated_with ?? [],
    rehab_for: e.rehab_for ?? [],
    source: e.source ?? 'curated',
    is_active: true,
  };
}

async function upsertExercises(
  db: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await db.from('exercises').upsert(chunk, { onConflict: 'slug' });
    if (error) {
      throw new Error(
        `exercises ${i}–${i + chunk.length}: ${error.message}` +
          (error.hint ? `\n  hint: ${error.hint}` : ''),
      );
    }
    process.stdout.write(`  exercises  ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }
  process.stdout.write(`  exercises  ${rows.length}/${rows.length}     \n`);
}

/**
 * Media rows reference an exercise by id, which only exists once the exercise
 * is written — hence the id lookup rather than a second upsert keyed on slug.
 *
 * `unique (exercise_id, source)` is the conflict target: one row per exercise
 * per media source, so re-running replaces rather than accumulates.
 */
async function upsertMedia(
  db: SupabaseClient,
  media: Record<string, MediaEntry>,
  fallbackAttribution: string,
): Promise<number> {
  const ids = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('exercises')
      .select('id, slug')
      .is('user_id', null)
      .range(from, from + 999);
    if (error) throw new Error(`reading exercise ids: ${error.message}`);
    for (const r of data ?? []) ids.set(r.slug as string, r.id as string);
    if (!data || data.length < 1000) break;
  }

  const rows: Record<string, unknown>[] = [];
  const orphans: string[] = [];
  for (const [slug, m] of Object.entries(media)) {
    const exercise_id = ids.get(slug);
    if (!exercise_id) {
      orphans.push(slug);
      continue;
    }
    if (!m.gif_url && !m.thumb_url && !(m.image_urls?.length ?? 0)) continue;
    rows.push({
      user_id: null,
      exercise_id,
      gif_url: m.gif_url ?? null,
      thumb_url: m.thumb_url ?? null,
      image_urls: m.image_urls ?? [],
      attribution: m.attribution ?? fallbackAttribution,
      // The GIFs are Gym Visual's and the credit is a condition of using them
      // (CLAUDE.md: keep the attribution in-app). `source` is what the settings
      // screen reads to render that line, so it is never guessed.
      source: m.gif_url ? 'gym-visual' : 'free-exercise-db',
    });
  }

  if (orphans.length) {
    process.stdout.write(
      `  media for ${orphans.length} slug${orphans.length === 1 ? '' : 's'} with no exercise row — skipped\n`,
    );
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await db
      .from('exercise_media')
      .upsert(chunk, { onConflict: 'exercise_id,source' });
    if (error) throw new Error(`exercise_media ${i}–${i + chunk.length}: ${error.message}`);
    process.stdout.write(`  media      ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }
  process.stdout.write(`  media      ${rows.length}/${rows.length}     \n`);
  return rows.length;
}

/**
 * The per-athlete half: three locations and an enrolment.
 *
 * Both functions are defined in the migrations and both are idempotent, so this
 * is safe to re-run and safe to run on an athlete who is already set up. It is
 * separate from the reference data because it is the only part that can touch
 * somebody's own rows, and it only happens when explicitly asked.
 */
async function setUpAthlete(db: SupabaseClient, userId: string): Promise<void> {
  const presets: [string, string | null][] = [
    ['home', null],
    ['planet_fitness_standard', 'Planet Fitness'],
    ['bodyweight_only', null],
  ];

  for (const [slug, name] of presets) {
    const { error } = await db.rpc('apply_location_preset', {
      p_user_id: userId,
      p_preset_slug: slug,
      ...(name ? { p_name: name } : {}),
    });
    if (error) throw new Error(`apply_location_preset(${slug}): ${error.message}`);
    process.stdout.write(`  location   ${name ?? slug}\n`);
  }

  const { error } = await db.rpc('start_program', { p_user_id: userId, p_slug: 'kot' });
  if (error) throw new Error(`start_program(kot): ${error.message}`);
  process.stdout.write('  program    Knees Over Toes — phase one, week one\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  return process.argv[process.argv.indexOf(hit) + 1];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  loadEnvLocal();

  const url = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  const dryRun = process.argv.includes('--dry-run');
  const userId = arg('user');

  if (userId !== undefined && !UUID.test(userId)) {
    process.stderr.write(
      `--user wants the uuid from public.users, not "${userId}".\n` +
        'Find it in the Supabase table editor, or with:\n' +
        "  select id, email from public.users;\n",
    );
    process.exit(2);
  }

  const exercises = library().map(toExerciseRow);
  const mediaFile = readJson<{ media: Record<string, MediaEntry>; attribution?: string }>(
    PATHS.exerciseMedia,
  );

  process.stdout.write('Longevity OS — seed Supabase\n\n');

  if (dryRun) {
    process.stdout.write(
      `  would upsert ${exercises.length} exercises\n` +
        `  would upsert media for ${Object.keys(mediaFile.media).length} of them\n` +
        (userId ? `  would set up locations and enrol ${userId} in Knees Over Toes\n` : '') +
        '\n  --dry-run: nothing was written.\n',
    );
    return;
  }

  if (!url || !key) {
    process.stderr.write(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (in .env.local or the environment).\n\n' +
        'Both are in the Supabase dashboard under Settings → API. The service role\n' +
        'key bypasses every row-level security policy: keep it out of the browser,\n' +
        'out of this repository, and out of any chat window.\n',
    );
    process.exit(2);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  // Fail here, with a sentence, rather than 400 rows into a batch upsert.
  const probe = await db.from('programs').select('slug').eq('slug', 'kot').maybeSingle();
  if (probe.error) {
    process.stderr.write(
      `could not read public.programs: ${probe.error.message}\n\n` +
        'Usually this means the schema has not been applied yet. Paste\n' +
        'supabase/SCHEMA_ALL_IN_ONE.sql into the Supabase SQL editor and run it.\n',
    );
    process.exit(1);
  }
  if (!probe.data) {
    process.stderr.write(
      'The schema is there but the Knees Over Toes program is not, which means an\n' +
        'older copy of SCHEMA_ALL_IN_ONE.sql was applied. Re-run the current one.\n',
    );
    process.exit(1);
  }

  await upsertExercises(db, exercises);
  const mediaCount = await upsertMedia(db, mediaFile.media, mediaFile.attribution ?? '');
  if (userId) await setUpAthlete(db, userId);

  const withGif = await db
    .from('exercise_media')
    .select('*', { count: 'exact', head: true })
    .not('gif_url', 'is', null);

  process.stdout.write(
    `\n  ✓ ${exercises.length} exercises · ${mediaCount} with media` +
      (withGif.count ? ` · ${withGif.count} with a GIF` : '') +
      `\n    ${mediaFile.attribution ?? 'Media attribution required — see data/exercise-media.json'}\n`,
  );
  if (!userId) {
    process.stdout.write(
      '\n  Reference data only. To set up an athlete as well:\n' +
        '    npx tsx scripts/seed-supabase.ts --user <their uuid from public.users>\n',
    );
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`\n${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
