/**
 * Longevity OS — exercise library ingestion
 *
 *   npx tsx scripts/ingest-exercises.ts
 *
 * Merges the two public corpora into one canonical library:
 *   - `yuhonas/free-exercise-db`      876 exercises, Unlicense / public domain.
 *                                     The METADATA SPINE (force, level, mechanic,
 *                                     muscles, instructions, static images).
 *   - `hasaneyldrm/exercises-dataset` 1,324 exercises with GIFs, media © Gym visual,
 *                                     redistributed with attribution (see
 *                                     data/raw/gymvisual-NOTICE.md). The MEDIA layer.
 *
 * Outputs (all deterministic — same inputs produce byte-identical files):
 *   data/exercises.json              the merged library (committed)
 *   data/exercise-media.json         media URLs + attribution (committed)
 *   data/reports/media-coverage.md   coverage, fuzzy matches, KOT gaps (committed)
 *
 * Raw corpora live in data/raw/ and are gitignored; they are re-downloaded here
 * when absent. Non-English Gym Visual instructions are DISCARDED — the
 * multilingual payload is 17 MB and we ship English only.
 */

import type {
  Equipment,
  Exercise,
  ExerciseMedia,
  MovementPattern,
  Region,
} from '../packages/engine/src/types';
import { EQUIPMENT } from '../packages/engine/src/types';
import {
  PATHS,
  SOURCE_URLS,
  download,
  exists,
  readJson,
  writeJson,
  writeText,
} from './lib/paths';
import {
  cleanName,
  displayName,
  nameKey,
  scorePair,
  slugify,
  tokenize,
  FUZZY,
} from './lib/normalize';
import {
  deriveBarbellFree,
  deriveEccentricDominant,
  deriveLoadStyle,
  derivePattern,
  derivePlyoContacts,
  deriveRegionLoads,
  dominantRegion,
  equipmentFromName,
  normalizeEquipmentList,
  normalizeForce,
  normalizeLevel,
  normalizeMechanic,
} from './lib/derive';
import { FREE_EXERCISE_DB_EQUIPMENT, GYM_VISUAL_EQUIPMENT } from './lib/vocab';
import { CURATED_EXERCISES, KOT_MOVEMENT_SLUGS } from './curated-exercises';

const GYM_VISUAL_ATTRIBUTION = '© Gym visual — https://gymvisual.com/';

// ─────────────────────────────────────────────────────────────────────────────
// Raw source shapes
// ─────────────────────────────────────────────────────────────────────────────

interface FreeExerciseDbRaw {
  id: string;
  name: string;
  force?: string | null;
  level?: string | null;
  mechanic?: string | null;
  equipment?: string | null;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  instructions?: string[];
  category?: string;
  images?: string[];
}

interface GymVisualRaw {
  id: string;
  name: string;
  category?: string;
  body_part?: string;
  equipment?: string;
  instructions?: Record<string, string>;
  instruction_steps?: Record<string, string[]>;
  muscle_group?: string;
  secondary_muscles?: string[];
  target?: string;
  image?: string;
  gif_url?: string;
  media_id?: string;
  attribution?: string;
}

interface SourceRecord {
  source: 'free-exercise-db' | 'gym-visual';
  sourceId: string;
  name: string;
  key: string;
  tokens: string[];
  category?: string;
  equipment: Equipment[];
  unmappedEquipment?: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  force?: string | null;
  level?: string | null;
  mechanic?: string | null;
  media?: ExerciseMedia;
}

interface FuzzyMatch {
  freeExerciseName: string;
  gymVisualName: string;
  freeKey: string;
  gymKey: string;
  score: number;
  tokenSet: number;
  jaccard: number;
  keyRatio: number;
}

const unmappedEquipmentValues = new Map<string, { source: string; example: string; count: number }>();
const unmappedMuscleValues = new Map<string, { count: number; example: string }>();

function noteUnmappedEquipment(source: string, value: string, example: string): void {
  const k = `${source}:${value}`;
  const prev = unmappedEquipmentValues.get(k);
  if (prev) prev.count += 1;
  else unmappedEquipmentValues.set(k, { source, example, count: 1 });
}

function noteUnmappedMuscle(value: string, example: string): void {
  const prev = unmappedMuscleValues.get(value);
  if (prev) prev.count += 1;
  else unmappedMuscleValues.set(value, { count: 1, example });
}

// ─────────────────────────────────────────────────────────────────────────────
// Load
// ─────────────────────────────────────────────────────────────────────────────

async function ensureRawData(): Promise<void> {
  if (!exists(PATHS.freeExerciseDb)) {
    process.stdout.write('free-exercise-db.json missing — downloading (public domain)\n');
    await download(SOURCE_URLS.freeExerciseDb, PATHS.freeExerciseDb);
  }
  if (!exists(PATHS.gymVisual)) {
    process.stdout.write('gymvisual-exercises.json missing — downloading (media © Gym visual)\n');
    await download(SOURCE_URLS.gymVisual, PATHS.gymVisual);
  }
  if (!exists(PATHS.gymVisualNotice)) {
    await download(SOURCE_URLS.gymVisualNotice, PATHS.gymVisualNotice).catch(() => {
      process.stdout.write('  (could not fetch the Gym visual NOTICE — keep attribution anyway)\n');
    });
  }
}

function loadFreeExerciseDb(): SourceRecord[] {
  const raw = readJson<FreeExerciseDbRaw[] | { exercises: FreeExerciseDbRaw[] }>(PATHS.freeExerciseDb);
  const rows = Array.isArray(raw) ? raw : raw.exercises;
  return rows.map((row) => {
    const name = displayName(row.name);
    const sourceEquipment = (row.equipment ?? '').toLowerCase().trim();
    let equipment = sourceEquipment ? FREE_EXERCISE_DB_EQUIPMENT[sourceEquipment] ?? null : null;
    if (!equipment) {
      if (sourceEquipment && !(sourceEquipment in FREE_EXERCISE_DB_EQUIPMENT)) {
        noteUnmappedEquipment('free-exercise-db', sourceEquipment, name);
      }
      equipment = equipmentFromName(name);
      if (!equipment.length) equipment = ['bodyweight'];
    }
    const images = (row.images ?? []).map((p) => `${SOURCE_URLS.freeExerciseDbImageBase}${p}`).sort();
    return {
      source: 'free-exercise-db' as const,
      sourceId: row.id,
      name,
      key: nameKey(name),
      tokens: tokenize(nameKey(name)),
      category: row.category,
      equipment: normalizeEquipmentList(equipment),
      primaryMuscles: (row.primaryMuscles ?? []).map((m) => m.toLowerCase()),
      secondaryMuscles: (row.secondaryMuscles ?? []).map((m) => m.toLowerCase()),
      instructions: (row.instructions ?? []).map((s) => cleanName(s)).filter(Boolean),
      force: row.force,
      level: row.level,
      mechanic: row.mechanic,
      media: images.length ? { image_urls: images } : undefined,
    };
  });
}

function loadGymVisual(): SourceRecord[] {
  const raw = readJson<GymVisualRaw[] | { exercises: GymVisualRaw[] }>(PATHS.gymVisual);
  const rows = Array.isArray(raw) ? raw : raw.exercises;
  return rows.map((row) => {
    const name = displayName(row.name);
    const sourceEquipment = (row.equipment ?? '').toLowerCase().trim();
    let equipment = sourceEquipment ? GYM_VISUAL_EQUIPMENT[sourceEquipment] ?? null : null;
    if (!equipment) {
      if (sourceEquipment && !(sourceEquipment in GYM_VISUAL_EQUIPMENT)) {
        noteUnmappedEquipment('gym-visual', sourceEquipment, name);
      }
      if (sourceEquipment && GYM_VISUAL_EQUIPMENT[sourceEquipment] === null) {
        noteUnmappedEquipment('gym-visual', sourceEquipment, name);
      }
      equipment = equipmentFromName(name);
      if (!equipment.length) equipment = ['bodyweight'];
    }

    // English only. The other nine languages are 17 MB we never ship.
    const steps = row.instruction_steps?.en ?? [];
    const prose = row.instructions?.en;
    const instructions = steps.length
      ? steps.map((s) => cleanName(s))
      : prose
        ? cleanName(prose)
            .split(/(?<=\.)\s+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const media: ExerciseMedia = { attribution: row.attribution ?? GYM_VISUAL_ATTRIBUTION };
    if (row.gif_url) media.gif_url = `${SOURCE_URLS.gymVisualMediaBase}${row.gif_url}`;
    if (row.image) media.thumb_url = `${SOURCE_URLS.gymVisualMediaBase}${row.image}`;

    const primary = [row.muscle_group, row.target]
      .filter((v): v is string => Boolean(v))
      .map((v) => v.toLowerCase());

    return {
      source: 'gym-visual' as const,
      sourceId: row.id,
      name,
      key: nameKey(name),
      tokens: tokenize(nameKey(name)),
      category: row.category,
      equipment: normalizeEquipmentList(equipment),
      primaryMuscles: [...new Set(primary)],
      secondaryMuscles: (row.secondary_muscles ?? []).map((m) => m.toLowerCase()),
      instructions,
      media: media.gif_url || media.thumb_url ? media : undefined,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Join
// ─────────────────────────────────────────────────────────────────────────────

interface JoinResult {
  pairs: { fedb: SourceRecord; gv: SourceRecord; how: 'exact' | 'fuzzy'; fuzzy?: FuzzyMatch }[];
  fedbOnly: SourceRecord[];
  gvOnly: SourceRecord[];
  fuzzyMatches: FuzzyMatch[];
}

/**
 * A similarity guard beyond the string: two records that load different body
 * regions are not the same movement, however alike the names read ("Standing
 * Leg Curl" vs "Weighted Standing Curl"). Requires the dominant region of each
 * side to be meaningfully loaded on the other.
 */
function regionCompatible(a: SourceRecord, b: SourceRecord): boolean {
  const loadsA = deriveRegionLoads(a.primaryMuscles, a.secondaryMuscles);
  const loadsB = deriveRegionLoads(b.primaryMuscles, b.secondaryMuscles);
  const domA = dominantRegion(loadsA);
  const domB = dominantRegion(loadsB);
  if (!domA || !domB) return true; // one side told us nothing — fall back to the string
  if (domA === domB) return true;
  return (loadsB[domA] ?? 0) >= 0.3 && (loadsA[domB] ?? 0) >= 0.3;
}

function joinDatasets(fedb: SourceRecord[], gv: SourceRecord[]): JoinResult {
  const pairs: JoinResult['pairs'] = [];
  const usedGv = new Set<string>();
  const usedFedb = new Set<string>();

  // ── Pass 1: exact normalized-key match, deterministic by sourceId order.
  const gvByKey = new Map<string, SourceRecord[]>();
  for (const rec of [...gv].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    const list = gvByKey.get(rec.key) ?? [];
    list.push(rec);
    gvByKey.set(rec.key, list);
  }
  for (const rec of [...fedb].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    const candidates = gvByKey.get(rec.key);
    if (!candidates) continue;
    const hit = candidates.find((c) => !usedGv.has(c.sourceId));
    if (!hit) continue;
    usedGv.add(hit.sourceId);
    usedFedb.add(rec.sourceId);
    pairs.push({ fedb: rec, gv: hit, how: 'exact' });
  }

  // ── Pass 2: conservative fuzzy. Blocked on a shared token so we score
  //    thousands of pairs instead of a million, then greedily take the best
  //    scoring pairs 1:1. EVERY accepted pair is reported for human review.
  const remainingFedb = fedb.filter((r) => !usedFedb.has(r.sourceId));
  const remainingGv = gv.filter((r) => !usedGv.has(r.sourceId));
  const tokenIndex = new Map<string, SourceRecord[]>();
  for (const rec of remainingGv) {
    for (const token of new Set(rec.tokens)) {
      const list = tokenIndex.get(token) ?? [];
      list.push(rec);
      tokenIndex.set(token, list);
    }
  }

  const scored: (FuzzyMatch & { fedb: SourceRecord; gv: SourceRecord })[] = [];
  for (const rec of remainingFedb) {
    const seen = new Set<string>();
    for (const token of new Set(rec.tokens)) {
      for (const cand of tokenIndex.get(token) ?? []) {
        if (seen.has(cand.sourceId)) continue;
        seen.add(cand.sourceId);
        const score = scorePair(rec.key, cand.key);
        if (!score) continue;
        if (!regionCompatible(rec, cand)) continue;
        scored.push({
          fedb: rec,
          gv: cand,
          freeExerciseName: rec.name,
          gymVisualName: cand.name,
          freeKey: rec.key,
          gymKey: cand.key,
          score: score.score,
          tokenSet: score.tokenSet,
          jaccard: score.jaccard,
          keyRatio: score.keyRatio,
        });
      }
    }
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.freeKey.localeCompare(b.freeKey) ||
      a.gymKey.localeCompare(b.gymKey),
  );

  const fuzzyMatches: FuzzyMatch[] = [];
  for (const cand of scored) {
    if (usedFedb.has(cand.fedb.sourceId) || usedGv.has(cand.gv.sourceId)) continue;
    usedFedb.add(cand.fedb.sourceId);
    usedGv.add(cand.gv.sourceId);
    const match: FuzzyMatch = {
      freeExerciseName: cand.freeExerciseName,
      gymVisualName: cand.gymVisualName,
      freeKey: cand.freeKey,
      gymKey: cand.gymKey,
      score: Math.round(cand.score * 1000) / 1000,
      tokenSet: Math.round(cand.tokenSet * 1000) / 1000,
      jaccard: Math.round(cand.jaccard * 1000) / 1000,
      keyRatio: Math.round(cand.keyRatio * 1000) / 1000,
    };
    fuzzyMatches.push(match);
    pairs.push({ fedb: cand.fedb, gv: cand.gv, how: 'fuzzy', fuzzy: match });
  }

  fuzzyMatches.sort((a, b) => b.score - a.score || a.freeKey.localeCompare(b.freeKey));

  return {
    pairs,
    fedbOnly: fedb.filter((r) => !usedFedb.has(r.sourceId)),
    gvOnly: gv.filter((r) => !usedGv.has(r.sourceId)),
    fuzzyMatches,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge into canonical Exercise records
// ─────────────────────────────────────────────────────────────────────────────

const usedIds = new Set<string>();

function uniqueId(base: string): string {
  const seed = base || 'exercise';
  if (!usedIds.has(seed)) {
    usedIds.add(seed);
    return seed;
  }
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${seed}-${i}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not allocate a unique id for ${base}`);
}

function mergeRecord(fedb: SourceRecord | undefined, gv: SourceRecord | undefined): Exercise {
  const primarySource = fedb ?? gv!;
  const name = primarySource.name;
  const slug = slugify(name);
  const id = uniqueId(slug);

  const aliases = [
    ...new Set(
      [fedb?.name, gv?.name, fedb?.key, gv?.key]
        .filter((v): v is string => Boolean(v))
        .map((v) => v.toLowerCase())
        .filter((v) => v !== name.toLowerCase()),
    ),
  ].sort();

  const equipment = normalizeEquipmentList([...(fedb?.equipment ?? []), ...(gv?.equipment ?? [])]);

  const region_loads = deriveRegionLoads(
    [...new Set([...(fedb?.primaryMuscles ?? []), ...(gv?.primaryMuscles ?? [])])].sort(),
    [...new Set([...(fedb?.secondaryMuscles ?? []), ...(gv?.secondaryMuscles ?? [])])].sort(),
    (muscle) => noteUnmappedMuscle(muscle, name),
  );

  const mechanic = normalizeMechanic(fedb?.mechanic);
  const pattern = derivePattern(name, fedb?.category ?? gv?.category, mechanic, region_loads);
  const instructions = (fedb?.instructions.length ? fedb.instructions : gv?.instructions) ?? [];

  const media: ExerciseMedia | undefined =
    fedb?.media || gv?.media
      ? {
          ...(gv?.media?.gif_url ? { gif_url: gv.media.gif_url } : {}),
          ...(gv?.media?.thumb_url ? { thumb_url: gv.media.thumb_url } : {}),
          ...(fedb?.media?.image_urls ? { image_urls: fedb.media.image_urls } : {}),
          ...(gv?.media ? { attribution: gv.media.attribution ?? GYM_VISUAL_ATTRIBUTION } : {}),
        }
      : undefined;

  const exercise: Exercise = {
    id,
    name,
    slug,
    aliases,
    pattern,
    force: normalizeForce(fedb?.force),
    mechanic,
    level: normalizeLevel(fedb?.level),
    equipment,
    region_loads,
    load_style: deriveLoadStyle(equipment, pattern, name),
    barbell_free: deriveBarbellFree(equipment),
    eccentric_dominant: deriveEccentricDominant(name),
    plyo_contacts_per_rep: derivePlyoContacts(name, pattern),
    instructions,
    source: fedb ? 'free-exercise-db' : 'gym-visual',
  };
  if (media) exercise.media = media;
  return exercise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

function pct(n: number, total: number): string {
  if (!total) return '0.0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

interface CoverageRow {
  label: string;
  total: number;
  gif: number;
  staticOnly: number;
  none: number;
}

function coverageBy(
  library: Exercise[],
  keyOf: (e: Exercise) => string[],
): CoverageRow[] {
  const rows = new Map<string, CoverageRow>();
  for (const ex of library) {
    for (const label of keyOf(ex)) {
      const row = rows.get(label) ?? { label, total: 0, gif: 0, staticOnly: 0, none: 0 };
      row.total += 1;
      if (ex.media?.gif_url) row.gif += 1;
      else if (ex.media?.image_urls?.length) row.staticOnly += 1;
      else row.none += 1;
      rows.set(label, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

interface KotGap {
  movement: string;
  slug: string;
  status: 'no media' | 'gif' | 'static only';
  /** Only set on an EXACT normalized-name hit — a near name is not the same movement. */
  matchedLibraryEntry?: string;
  /** Informational only: the nearest public name, which is usually a cousin, not this movement. */
  nearestPublicEntry?: string;
}

/**
 * Does the public library hold media for this curated KOT movement?
 *
 * Deliberately strict: only an EXACT normalized-name hit (on the curated name
 * or one of its aliases) counts as "we have media for this". A near-miss like
 * "Barbell Side Split Squat" is NOT an ATG split squat, so it is reported as an
 * informational nearest-neighbour and the movement still counts as a gap.
 */
function kotGaps(library: Exercise[]): KotGap[] {
  const out: KotGap[] = [];
  for (const slug of [...KOT_MOVEMENT_SLUGS].sort()) {
    const curated = CURATED_EXERCISES.find((e) => e.slug === slug);
    if (!curated) continue;
    const needles = new Set([curated.name, ...curated.aliases].map(nameKey));
    let exact: Exercise | undefined;
    let nearest: { name: string; score: number } | undefined;
    for (const ex of library) {
      const hay = [ex.name, ...ex.aliases].map(nameKey);
      for (const h of hay) {
        if (needles.has(h)) {
          exact = ex;
          break;
        }
        for (const needle of needles) {
          const score = scorePair(needle, h);
          if (score && score.score > (nearest?.score ?? FUZZY.minKeyRatio)) {
            nearest = { name: ex.name, score: score.score };
          }
        }
      }
      if (exact) break;
    }
    const media = exact?.media;
    const status: KotGap['status'] = media?.gif_url
      ? 'gif'
      : media?.image_urls?.length
        ? 'static only'
        : 'no media';
    out.push({
      movement: curated.name,
      slug,
      status,
      ...(exact ? { matchedLibraryEntry: exact.name } : {}),
      ...(nearest && !exact ? { nearestPublicEntry: `${nearest.name} (${nearest.score.toFixed(2)})` } : {}),
    });
  }
  return out;
}

function buildReport(
  library: Exercise[],
  fuzzyMatches: FuzzyMatch[],
  counts: { fedb: number; gv: number; exact: number; fuzzy: number; fedbOnly: number; gvOnly: number },
): string {
  const total = library.length;
  const withGif = library.filter((e) => e.media?.gif_url).length;
  const staticOnly = library.filter((e) => !e.media?.gif_url && e.media?.image_urls?.length).length;
  const nothing = total - withGif - staticOnly;

  const equipmentRows = coverageBy(library, (e) => (e.equipment.length ? e.equipment : ['(none)']));
  const patternRows = coverageBy(library, (e) => [e.pattern]);
  const gaps = kotGaps(library);

  const lines: string[] = [];
  lines.push('# Exercise Media Coverage Report');
  lines.push('');
  lines.push(
    'Generated by `scripts/ingest-exercises.ts`. Regenerate with `npx tsx scripts/ingest-exercises.ts`.',
  );
  lines.push('Do not hand-edit — fix the mapping tables in `scripts/lib/vocab.ts` and re-run.');
  lines.push('');
  lines.push('## 1. Totals');
  lines.push('');
  lines.push('| Metric | Count | Share |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Exercises in the merged library | ${total} | 100.0% |`);
  lines.push(`| With an animated GIF (© Gym visual) | ${withGif} | ${pct(withGif, total)} |`);
  lines.push(`| Static images only (free-exercise-db) | ${staticOnly} | ${pct(staticOnly, total)} |`);
  lines.push(`| No media at all | ${nothing} | ${pct(nothing, total)} |`);
  lines.push(`| Curated records (hand-authored, no media by definition) | ${CURATED_EXERCISES.length} | — |`);
  lines.push('');
  lines.push('### Join');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| free-exercise-db source rows | ${counts.fedb} |`);
  lines.push(`| Gym Visual source rows | ${counts.gv} |`);
  lines.push(`| Exact name-key joins | ${counts.exact} |`);
  lines.push(`| Fuzzy joins (REVIEW BELOW) | ${counts.fuzzy} |`);
  lines.push(`| free-exercise-db only (no GIF) | ${counts.fedbOnly} |`);
  lines.push(`| Gym Visual only (GIF, no PD metadata) | ${counts.gvOnly} |`);
  lines.push('');
  lines.push('## 2. Coverage by equipment');
  lines.push('');
  lines.push('An exercise counts once per equipment slug it can be performed with.');
  lines.push('');
  lines.push('| Equipment | Exercises | GIF | Static only | None | GIF % |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of equipmentRows) {
    lines.push(
      `| \`${row.label}\` | ${row.total} | ${row.gif} | ${row.staticOnly} | ${row.none} | ${pct(row.gif, row.total)} |`,
    );
  }
  lines.push('');
  lines.push('## 3. Coverage by movement pattern');
  lines.push('');
  lines.push('| Pattern | Exercises | GIF | Static only | None | GIF % |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of patternRows) {
    lines.push(
      `| \`${row.label}\` | ${row.total} | ${row.gif} | ${row.staticOnly} | ${row.none} | ${pct(row.gif, row.total)} |`,
    );
  }
  lines.push('');
  lines.push('## 4. Fuzzy matches — REVIEW REQUIRED');
  lines.push('');
  lines.push(
    `${fuzzyMatches.length} pair(s) were joined by similarity rather than an exact name key. ` +
      `Thresholds: token-set ≥ ${FUZZY.minTokenSetRatio}, Jaccard ≥ ${FUZZY.minJaccard}, key ratio ≥ ${FUZZY.minKeyRatio}; ` +
      'a discriminating token (single / reverse / seated / incline / …) present on only one side vetoes the pair, ' +
      'as does a disagreement about which body region the movement loads.',
  );
  lines.push('');
  if (fuzzyMatches.length) {
    lines.push('| free-exercise-db | Gym Visual | score | token-set | jaccard | key ratio |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: |');
    for (const m of fuzzyMatches) {
      lines.push(
        `| ${m.freeExerciseName} | ${m.gymVisualName} | ${m.score.toFixed(3)} | ${m.tokenSet.toFixed(3)} | ${m.jaccard.toFixed(3)} | ${m.keyRatio.toFixed(3)} |`,
      );
    }
  } else {
    lines.push('_No fuzzy matches were accepted._');
  }
  lines.push('');
  lines.push('## 5. Unmapped source vocabulary');
  lines.push('');
  lines.push(
    'Values the source datasets use that have no canonical equivalent in `packages/engine/src/types.ts`. ' +
      'They fell back to name-based hints or bodyweight. Fix by editing `scripts/lib/vocab.ts`.',
  );
  lines.push('');
  const equipmentIssues = [...unmappedEquipmentValues.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (equipmentIssues.length) {
    lines.push('| Source | Value | Rows | Example |');
    lines.push('| --- | --- | ---: | --- |');
    for (const [key, info] of equipmentIssues) {
      lines.push(`| ${info.source} | \`${key.split(':').slice(1).join(':')}\` | ${info.count} | ${info.example} |`);
    }
  } else {
    lines.push('_Every source equipment value mapped cleanly._');
  }
  lines.push('');
  const muscleIssues = [...unmappedMuscleValues.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (muscleIssues.length) {
    lines.push('| Unmapped muscle | Rows | Example |');
    lines.push('| --- | ---: | --- |');
    for (const [muscle, info] of muscleIssues) {
      lines.push(`| \`${muscle}\` | ${info.count} | ${info.example} |`);
    }
  } else {
    lines.push('_Every source muscle mapped to a region._');
  }
  lines.push('');
  lines.push('## 6. KOT gaps');
  lines.push('');
  lines.push(
    'The Knees Over Toes movements RESEARCH §7 expects the public datasets to miss. ' +
      'Each one is hand-authored in `data/curated-exercises.json` with written cues and instructions; ' +
      'a **no media** row means the app shows text only until Seth records his own clip.',
  );
  lines.push('');
  lines.push('| KOT movement | curated slug | public media | exact library hit | nearest public name (NOT equivalent) |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const gap of gaps) {
    lines.push(
      `| ${gap.movement} | \`${gap.slug}\` | ${gap.status === 'no media' ? '**none**' : gap.status} | ${gap.matchedLibraryEntry ?? '—'} | ${gap.nearestPublicEntry ?? '—'} |`,
    );
  }
  lines.push('');
  const missing = gaps.filter((g) => g.status === 'no media');
  lines.push(
    `**${missing.length} of ${gaps.length} KOT movements have no public media.** ` +
      (missing.length ? `Text-only: ${missing.map((g) => g.movement).join(', ')}.` : ''),
  );
  lines.push('');
  lines.push('## 7. Licence position');
  lines.push('');
  lines.push('- `free-exercise-db` metadata and static images: **Unlicense / public domain**, no obligations.');
  lines.push(
    `- Gym Visual GIFs and thumbnails: **${GYM_VISUAL_ATTRIBUTION}**, redistributed with attribution, 180×180 only. ` +
      'The credit MUST stay visible in-app wherever this media renders (settings → credits). See `data/raw/gymvisual-NOTICE.md`.',
  );
  lines.push('- Curated records: written for this project; no third-party rights attach.');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stdout.write('Longevity OS — exercise ingestion\n');
  await ensureRawData();

  const fedb = loadFreeExerciseDb();
  const gv = loadGymVisual();
  process.stdout.write(`  free-exercise-db: ${fedb.length} rows\n`);
  process.stdout.write(`  gym visual:       ${gv.length} rows\n`);

  const join = joinDatasets(fedb, gv);
  const exactCount = join.pairs.filter((p) => p.how === 'exact').length;
  process.stdout.write(
    `  joined: ${exactCount} exact, ${join.fuzzyMatches.length} fuzzy, ` +
      `${join.fedbOnly.length} free-exercise-db only, ${join.gvOnly.length} gym-visual only\n`,
  );

  const library: Exercise[] = [
    ...join.pairs.map((p) => mergeRecord(p.fedb, p.gv)),
    ...join.fedbOnly.map((r) => mergeRecord(r, undefined)),
    ...join.gvOnly.map((r) => mergeRecord(undefined, r)),
  ].sort((a, b) => a.id.localeCompare(b.id));

  writeJson(PATHS.exercises, library);

  // Media side-car, keyed by exercise id.
  const mediaIndex: Record<string, ExerciseMedia> = {};
  for (const ex of library) if (ex.media) mediaIndex[ex.id] = ex.media;
  writeJson(PATHS.exerciseMedia, {
    _notice:
      'GIFs and thumbnails are © Gym visual (https://gymvisual.com/), redistributed with attribution at 180x180. ' +
      'The credit must remain visible in-app. Static images come from free-exercise-db (Unlicense / public domain).',
    attribution: GYM_VISUAL_ATTRIBUTION,
    generated_by: 'scripts/ingest-exercises.ts',
    count: Object.keys(mediaIndex).length,
    media: mediaIndex,
  });

  const report = buildReport(library, join.fuzzyMatches, {
    fedb: fedb.length,
    gv: gv.length,
    exact: exactCount,
    fuzzy: join.fuzzyMatches.length,
    fedbOnly: join.fedbOnly.length,
    gvOnly: join.gvOnly.length,
  });
  writeText(PATHS.mediaCoverageReport, report);

  const withGif = library.filter((e) => e.media?.gif_url).length;
  process.stdout.write(`  library: ${library.length} exercises, ${withGif} with a GIF (${pct(withGif, library.length)})\n`);
  process.stdout.write(`  wrote ${PATHS.exercises}\n`);
  process.stdout.write(`  wrote ${PATHS.exerciseMedia}\n`);
  process.stdout.write(`  wrote ${PATHS.mediaCoverageReport}\n`);

  // Sanity: every derived equipment slug must exist in the canonical union.
  const canonical = new Set<string>(EQUIPMENT as readonly string[]);
  const bad = library.flatMap((e) => e.equipment.filter((q) => !canonical.has(q)).map((q) => `${e.id}:${q}`));
  if (bad.length) throw new Error(`Non-canonical equipment slugs emitted: ${bad.slice(0, 10).join(', ')}`);
}

main().catch((err) => {
  process.stderr.write(`\nIngestion failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});

export type { FuzzyMatch };
export { joinDatasets, mergeRecord };
