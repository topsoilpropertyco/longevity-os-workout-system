# Longevity OS — Credits & Licences

This project stands on other people's work. This page records whose, under what terms, and what we are obliged to do about it. A copy of the attribution section lives in the app under **Settings → Credits**, which is where the Gym Visual notice is contractually required to appear.

**This is a personal, non-commercial project**, running on Vercel's Hobby tier (which is itself non-commercial only) and Supabase's free tier. Nothing here is sold, and no licence granted below has been relied on for commercial use.

---

## Exercise metadata

### `yuhonas/free-exercise-db`

- **What:** 800+ exercises as JSON — force, level, mechanic, equipment, primary and secondary muscles, instructions, static images.
- **Licence:** **Unlicense — public domain.** No attribution required.
- **Source:** https://github.com/yuhonas/free-exercise-db
- **How we use it:** this is the canonical metadata spine. Every exercise in the library is keyed to it, and it carries no licensing risk, which is exactly why it is the spine rather than a supplement.
- **Credited anyway,** because public domain is a gift and gifts get acknowledged.

---

## Exercise media — attribution required

### Gym Visual, via `hasaneyldrm/exercises-dataset`

- **What:** 1,324 exercises with animated GIFs and 180×180 thumbnails, instructions in ten languages.
- **Source:** https://github.com/hasaneyldrm/exercises-dataset
- **Media rights holder:** **Gym visual.** The media is redistributed in that dataset with the rights holder's separate written permission, and **attribution is required**.

> **© Gym visual — https://gymvisual.com/**

**Our obligations, all of which are met:**

1. The notice above appears **in-app**, under **Settings → Credits**, and is not removable.
2. Every media record carries an `attribution` field with the same notice (`ExerciseMedia.attribution` in `packages/engine/src/types.ts`).
3. Media is used at **180×180** only, per the redistribution terms.
4. `data/raw/gymvisual-NOTICE.md` is kept intact in the repository.

**Gym Visual's own terms govern this media:** https://gymvisual.com/content/3-terms-and-conditions-of-use

**Cloning this repository does not license the media to you.** The MIT licence on this project covers our code and nothing else. If you want to use these animations in your own project, read Gym Visual's terms and obtain your own licence from them directly. The non-media dataset fields in `hasaneyldrm/exercises-dataset` are MIT-licensed separately.

### Media not used

For the record, and so nobody wonders later:

- **`mfortini/exercise-library`** — licence provenance unclear, likely derived from ExerciseDB. Gap-filling only, treated as personal use, not currently in the build.
- **ExerciseDB / AscendAPI** — open-source tier at 180p with paid tiers above it. A fallback for gaps; any paid tier requires Seth's explicit yes.
- **`sergei-argutin/exercise-dataset` (RepDB)** — attribution licence, 250 exercises at 512px WebP. Not currently used.
- **WorkoutX** — free-tier API, not currently used.
- **Stronger by Science / ExRx** — **not open. Not scraped. Not used.**

Gaps in KOT-specific movements — tibialis raise, Patrick step, Poliquin step, ATG split squat, backward sled, reverse Nordic, QL extension, seated good morning — are filled with a static image plus written cues, and reported by `npm run ingest:exercises`. They are not filled by taking someone's video.

---

## Programs

**Knees Over Toes / ATG** is Ben Patrick's methodology. Seth's own program materials live in `docs/programs/kot/raw/` and are **not committed** — they are his purchase and his copy. The public scaffold recorded in `RESEARCH_FOUNDATION.md` §7 exists so the ingestion script has a shape to normalize into; it is a structural description, not a redistribution of the program.

The **McGill Big 3** (curl-up, side plank, bird dog) is Stuart McGill's work, used here as the low-back rehab floor per the research foundation.

Training rules throughout the engine cite the literature they come from — Schumann 2022 on concurrent training, Gabbett on acute:chronic workload, van Dyk 2019 on Nordic hamstring curls, Coleman 2024 and Pancar 2025 on deloads, the Norwegian 4×4 protocol, and the 2026 BJSM resistance-training cohort. Section numbers are in `docs/ENGINE.md` and `docs/RESEARCH_FOUNDATION.md`.

---

## Services

| Service | Tier | Notes |
| --- | --- | --- |
| **Vercel** | Hobby | Free, **non-commercial use only**. Hosting and daily cron. |
| **Supabase** | Free | Postgres, auth, storage, `pg_cron`. |
| **Oura** | Personal access token | Seth's own health data, read through his own token. |
| **Strava** | Free developer app | Subject to the Strava API Agreement and brand guidelines. We never call the subscription-only `/zones` endpoint. |
| **Telegram** | Bot API | Free. |
| **Google Gemini** | Free tier | Fallback LLM only. ⚠️ Free-tier limits change — verify at build time. |
| **LM Studio** | Local | Runs on Seth's own Mac mini. Model weights carry their own licences — check each model's licence before use, particularly for anything derived from Llama or Qwen. |

---

## Open-source dependency classes

Everything below is MIT, Apache-2.0, ISC, BSD or OFL. The authoritative, versioned list is `package-lock.json`; this is the map.

| Class | What it is | Typical licence |
| --- | --- | --- |
| **Framework** | Next.js (App Router), React | MIT |
| **Language and build** | TypeScript, `tsx`, the Node 20+ runtime | Apache-2.0 / MIT |
| **Styling** | Tailwind CSS, PostCSS, Autoprefixer | MIT |
| **Data** | `@supabase/supabase-js` and its `postgrest`, `realtime`, `storage` and `gotrue` clients | MIT |
| **Testing** | Vitest and its Vite toolchain | MIT |
| **Linting and formatting** | ESLint, Prettier and plugins | MIT |
| **Validation** | Runtime schema validation for LLM output and webhook payloads | MIT |
| **Typefaces** | Space Grotesk, Geist Sans, Geist Mono | SIL Open Font License 1.1 |
| **Worker** | Node 20+ standard library, the Supabase client, LM Studio's OpenAI-compatible HTTP API | MIT |

The engine package itself has **no runtime dependencies at all**. That is deliberate: it is pure TypeScript with no I/O, which is what makes it testable, auditable and immune to a supply-chain surprise in the one place where a surprise would rewrite someone's training.

Nothing in this project uses a GPL or AGPL dependency. If one is ever proposed, it is a decision for Seth, not a `npm install`.

---

## This project

Code: **MIT**, see [`LICENSE`](../LICENSE), with the exercise-media carve-out described above.

Seth's personal data — Oura exports, Strava activities, training logs, body metrics, injury notes, KOT spreadsheets, CSV imports — is his, lives in his Supabase project, and is not part of this repository under any licence. `docs/programs/kot/raw/` and `docs/imports/raw/` are gitignored for that reason.
