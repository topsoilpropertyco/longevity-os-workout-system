# Longevity OS — `data/`

Everything the exercise library, the KOT program and the history importer read or
produce. Nothing here is hand-edited except where this file says so.

## Files

| File | Kind | Committed? | Produced by |
| --- | --- | --- | --- |
| `raw/free-exercise-db.json` | downloaded corpus (876 exercises) | **no** — gitignored | `scripts/ingest-exercises.ts` (re-downloads when missing) |
| `raw/gymvisual-exercises.json` | downloaded corpus (1,324 exercises + GIFs, 17 MB with all 10 languages) | **no** — gitignored | `scripts/ingest-exercises.ts` (re-downloads when missing) |
| `raw/gymvisual-NOTICE.md` | the media licence | no | fetched alongside the corpus |
| `exercises.json` | **generated** — the merged library (`Exercise[]`) | yes | `scripts/ingest-exercises.ts` |
| `exercise-media.json` | **generated** — media URLs keyed by exercise id, plus the attribution notice | yes | `scripts/ingest-exercises.ts` |
| `curated-exercises.json` | **hand-authored** — KOT, McGill Big 3, plyo ladder, DB conditioning, cardio pseudo-exercises | yes | `scripts/curated-exercises.ts` (the TS file is the source of truth) |
| `reports/media-coverage.md` | **generated** — coverage %, fuzzy matches to review, KOT gaps | yes | `scripts/ingest-exercises.ts` |
| `reports/kot-reconciliation.md` | **generated** — diff between Seth's spreadsheets and the public scaffold | yes | `scripts/ingest-kot.ts` |
| `reports/import-review.json` | **generated** — normalized sets + unmatched names for the import review screen | yes | `scripts/import-csv.ts` |

Related, outside this directory:

| Path | Kind |
| --- | --- |
| `programs/kot/program.json` | hand-authored from the PUBLIC scaffold (RESEARCH §7). Read its `_note`. Must be reconciled against Seth's own sheets. |
| `docs/programs/kot/raw/` | Seth's KOT spreadsheets — local only, gitignored |
| `docs/imports/raw/` | Seth's Fitbod/Strong/Hevy exports — local only, gitignored |

## Regenerating

```sh
npm install --no-save tsx          # tsx is the only tool these scripts need

npx tsx scripts/ingest-exercises.ts   # raw corpora → exercises.json, exercise-media.json, media-coverage.md
npx tsx scripts/curated-exercises.ts  # curated-exercises.ts → curated-exercises.json
npx tsx scripts/ingest-kot.ts         # Seth's sheets vs programs/kot/program.json → kot-reconciliation.md
npx tsx scripts/import-csv.ts         # docs/imports/raw/*.csv → reports/import-review.json
npx tsx scripts/validate-data.ts      # validates all of the above against packages/engine/src/types.ts
```

The ingest is **deterministic**: identical inputs produce byte-identical outputs
(every object key is sorted, every array is sorted, no timestamps). A rerun that
changes a file means an input or a mapping table changed — check the diff.

Both `ingest-kot.ts` and `import-csv.ts` take `--dir=<path>` to read from
somewhere other than their default source directory.

### Pre-commit check

```sh
printf '#!/bin/sh\nnpx tsx scripts/validate-data.ts\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

`validate-data.ts` checks every record against the types in
`packages/engine/src/types.ts` (canonical `Equipment` / `Region` /
`MovementPattern` unions, region loads in 0–1, resolvable program slugs and
prerequisites) and exits 1 printing the offending record.

## Where the judgement lives

The loose source vocabularies are translated into the canonical unions by the
exported, commented tables in **`scripts/lib/vocab.ts`**:
`FREE_EXERCISE_DB_EQUIPMENT`, `GYM_VISUAL_EQUIPMENT`, `NAME_EQUIPMENT_HINTS`,
`MUSCLE_REGION_WEIGHTS`, `PATTERN_RULES`, `ECCENTRIC_DOMINANT_PATTERNS`,
`PLYO_CONTACT_RULES`. They are meant to be read and corrected by a human — fix
a mapping there and re-run the ingest rather than editing `exercises.json`.

Two things worth knowing about the sources:

- Gym Visual's `sled machine` means the **45° leg press sled**, not a push sled.
- Gym Visual's `weighted` means bodyweight **plus** an added implement.

Fuzzy name joins are deliberately conservative and **every one is listed in
`reports/media-coverage.md` for review** — a discriminating token (single,
reverse, seated, incline, …) on only one side, or a disagreement about which
body region is loaded, vetoes the pair.

## Licence position

- **`yuhonas/free-exercise-db`** — metadata and static images are released under
  the **Unlicense (public domain)**. No attribution obligations; we use it as the
  metadata spine.
- **`hasaneyldrm/exercises-dataset` (Gym Visual media)** — the GIFs and 180×180
  thumbnails are **© Gym visual**, redistributed with permission and
  **attribution required**. The credit

  > **© Gym visual — https://gymvisual.com/**

  **MUST remain visible in-app** wherever this media is displayed (settings →
  credits at minimum). Every media record carries the notice in its
  `attribution` field, `exercise-media.json` carries it at the top level, and
  `scripts/validate-data.ts` fails the build if a GIF ever loses it. Media is
  distributed at 180×180 only. The non-media dataset (names, categories,
  muscles, instructions) is MIT. See `raw/gymvisual-NOTICE.md`; Gym visual's own
  terms are at https://gymvisual.com/content/3-terms-and-conditions-of-use, and
  cloning this repo grants no rights to their media.
- **Curated records** (`curated-exercises.json`) — written for this project.
  No third-party rights attach; no media by definition, which is why each one
  carries a written cue and full instructions.
- **`programs/kot/program.json`** — assembled from the *publicly described*
  Knees Over Toes structure in `docs/RESEARCH_FOUNDATION.md` §7. Not affiliated
  with or licensed from ATG. It is a placeholder until Seth's own program data
  replaces it.
