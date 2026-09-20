# Longevity OS — Roadmap

The eight build phases from PRD §11. Each one: the goal in a line, what Seth has to supply before it can start, and what "done" means. Phases run roughly in order because each leans on the one before it, but 5, 6 and 7 can be reordered around whichever credential arrives first.

**Where the first build landed:** the contract, the research base, the documentation and the model routing are done. Phase 2 is essentially complete, Phase 1 and Phase 3 are most of the way there, and Phases 4–8 are partly written as libraries with no runtime around them. Per-phase status is at the bottom of each section, and the honest ledger is at the end.

---

## Phase 1 — Foundation

**Goal:** a deployed, installable, empty app with a real database behind it.

**Seth supplies:** nothing. This phase is why the others can start without him.

**Scope:** monorepo and workspaces · Next.js App Router + TypeScript + Tailwind · Supabase project, the full PRD §10 schema, RLS policies on every table from the first migration · single-user magic-link auth · Vercel deploy with the root directory set to `longevity-os` · PWA manifest and service worker · design tokens from `docs/DESIGN.md` · `npm run check` wired.

**Done when:** Seth adds the app to his home screen, it opens full-bleed with correct safe areas, he is signed in, a row can be written to Supabase and read back under RLS, and `npm run check` passes in CI.

**Status:** *mostly done.* Workspaces, the Next.js app, Tailwind, design tokens, and migrations `0001_init` through `0005_cron` (schema, RLS, equipment catalog, location presets, cron) are in place. **Remaining:** auth, the PWA manifest and service worker, and the Vercel deploy — and none of it has been run against a real Supabase project.

---

## Phase 2 — Library

**Goal:** every exercise the engine could ever prescribe, with media and equipment, in the database.

**Seth supplies:** nothing required. Optionally, photos of his Planet Fitness clubs to speed up the checklists.

**Scope:** ingest `yuhonas/free-exercise-db` as the metadata spine · join the Gym Visual media set on normalized name · normalize equipment into the engine's vocabulary · tag `region_loads`, `pattern`, `barbell_free`, `eccentric_dominant`, `plyo_contacts_per_rep` · convert GIFs to WebP/MP4 loops and lazy-load · equipment catalog with images · location presets: Home (seeded), Planet Fitness — standard, CrossFit box — typical, Bodyweight only · **media coverage report** plus the KOT gap list.

**Done when:** `npm run ingest:exercises` runs clean, the coverage percentage is reported, the KOT gaps are listed, Home is seeded with the Bowflex dumbbells to 52.5 lb / adjustable bench with Nordic support / pull-up bar / bands, and a Planet Fitness location can be cloned and edited in under a minute.

**Status:** *done, pending review.* The merged library is **1,908 exercises, 69.4% with an animated GIF**, 30.5% static images only, 3 with no media — `data/reports/media-coverage.md` has the breakdown. Equipment catalog and location presets are seeded by migrations `0003` and `0004`. **Remaining:** a human eye over the 37 fuzzy joins, GIF → WebP/MP4 conversion, and confirming the Home and Planet Fitness presets against reality.

---

## Phase 3 — Engine v1

**Goal:** given inputs, the correct session comes out — every time, provably.

**Seth supplies:** nothing. Sliders stand in for Oura, so this phase needs no credentials at all. This is why it can run in parallel with everything else.

**Scope:** weekly template with the §6.1 evidence defaults · readiness modulation and the four bands · regional load ledger and ACWR · pairing exclusions · progression, e1RM and prediction bands · autoregulated deload triggers and the 8–10 week cap · session assembly within a time budget · Same/Easier/Harder swap ranking · week projection and the carousel re-solve · the five fixture days (high readiness, low readiness, injury flare, 15-minute home, 90-minute PF) · golden-file tests · invariant assertions.

**Done when:** the engine is pure with no I/O, the five fixtures pass, the golden files are committed, the invariant assertions run against every fixture, the same input yields the same `signature` twice, and `docs/ENGINE.md`'s worked example reproduces exactly.

**Status:** *substantially built.* `packages/engine/src/` holds readiness, ledger, exclusions, template, progression, deload, assembly, swaps, cardio, weekly dose and why-copy, with unit tests beside each and fixture days in `fixtures/`. **Remaining:** golden-file tests on full session assembly, the five named fixture days as a complete set, the invariant assertions running across all of them, and a signature-stability test.

---

## Phase 4 — Runtime

**Goal:** he can actually do the session and log it, one-handed.

**Seth supplies:** an iPhone and 20 minutes to test on the real device.

**Scope:** session runtime screen · set logging with clear-on-focus and the custom numeric keypad · prediction bands on the card · rest timer, EMOM, AMRAP, interval/Tabata, for-time stopwatch, with audio, haptics and keep-awake · swap carousel · total-load convention explained inline once · end-of-session summary with tonnage, PRs, duration and next-day preview · offline logging that queues and flushes.

**Done when:** a full session is logged on an actual iPhone without a mis-tap, a swap completes in one tap and re-times the session, the timers hold accuracy with the screen locked, and everything works in airplane mode.

**Status:** *components only.* Clocks, rest timer, sliders, minutes picker, difficulty chips, sheets and toasts exist under `apps/web/src/components/`. The runtime screen itself, the keypad, the swap carousel and the summary remain — as does testing any of it on a real iPhone.

---

## Phase 5 — Oura + Strava

**Goal:** the plan stops asking and starts knowing.

**Seth supplies:** the **Oura PAT** (check for an existing one first) · the **Strava** client ID, client secret and redirect URI · the **chest strap**, found and paired.

**Scope:** nightly and on-open Oura pull · HRV-versus-28-day-baseline · VO2max and cardiovascular age on the dashboard · Strava OAuth with refresh-token rotation · webhook subscription and the GET challenge handshake · nightly reconcile · **zone minutes computed from the HR stream** (never the paid `/zones` endpoint) · HRmax precedence chain (ADR 0004) · cardio prescription cards and compliance scoring.

**Done when:** last night's readiness drives this morning's plan without a tap, a run recorded on the strap appears with correct zone minutes within minutes of finishing, and pulling the Oura token out degrades cleanly to sliders.

**Status:** *clients written, nothing wired.* `packages/integrations/src/oura/` (client, schema, normalize) and `strava/` (client, webhook, zones-from-HR-stream, normalize) exist over result-typed HTTP. **Remaining:** the API route handlers, OAuth round trip, the webhook subscription, the nightly crons, and a single real activity proving the zone maths (RESEARCH §10.4).

---

## Phase 6 — Telegram + LLM

**Goal:** the app speaks, and it does it from the Mac mini for free.

**Seth supplies:** the **Telegram bot token** and his **chat ID** · **LM Studio** running on port 1234 with a text model and a vision model installed, and the model names confirmed · the **Gemini** free-tier key.

**Scope:** Telegram webhook with the secret header · 06:30 brief with quick buttons, post-session summary, Sunday report, scale prompt, injury check-in · rules-first intent routing, then LLM with the engine tool schema · `llm_jobs` table and the mini worker under launchd with `caffeinate` · keep-alive ping · 60-second Gemini fallback with an identical output schema · photo → structured log via the vision model, with strict JSON validation and follow-up questions for ambiguity · "why" copy with the deterministic template floor.

**Done when:** the 06:30 brief arrives with real quick buttons, a whiteboard photo becomes a logged session, unplugging the mini costs 60 seconds and nothing else, and removing the Gemini key still yields a correct prescription with template copy.

**Status:** *library written, no runtime.* `packages/integrations/src/telegram/` (client, keyboards, router) and `llm/` (provider, jobs, prompts, tools, fallback copy) exist. **Remaining:** the `/api/telegram` route, the scheduled messages, the mini worker under launchd, the keep-alive, and the 60-second Gemini sweep.

---

## Phase 7 — Programs + Injuries

**Goal:** KOT becomes the actual program rather than a plan to have one, and the knees and back get managed rather than avoided.

**Seth supplies:** the **KOT spreadsheets and links** in `docs/programs/kot/raw/` — this phase cannot start without them.

**Scope:** `npm run ingest:kot` → `programs/kot/*.json` with steps, %BW standards, progressions, equipment substitutions and ground-up ordering · program progress screen with cycle count toward two full cycles · injury register seeded with knees and low back · weekly bot check-ins · rehab programming (KOT for knees, McGill Big 3 plus hinge progression for the back) · the pain-response rule: a ≥2-point rise in 24 h regresses one step · explicit resolution only.

**Done when:** KOT sessions come out of the engine in ground-up order with standards expressed in pounds at his current bodyweight, progress is visible, the check-in arrives weekly, and a simulated pain spike demonstrably regresses the step.

**Status:** *scaffold ingested, Seth's sheets pending.* `programs/kot/program.json` holds 26 normalized steps, and `data/reports/kot-reconciliation.md` already names exactly where the public scaffold and a sample sheet disagree — one step in the sheet and not the scaffold, and a set of scaffold steps we invented. **Remaining:** everything downstream, plus Seth's actual spreadsheets, which are the source of truth where the two disagree.

---

## Phase 8 — Dashboard + Import + Polish

**Goal:** he can see that it is working, and his history from the ten paid apps comes with him.

**Seth supplies:** **CSV exports** from Fitbod, Strong, Hevy and anything else in `docs/imports/raw/` · a **Wyze scale screenshot** and his current weight · the **vertical baseline** (chalk, wall, 10 minutes).

**Scope:** fixed dashboard top row (PRD §8.9) · explore charts: e1RM with plateau detection, PR feed, weekly minutes by bucket, readiness vs performance, program progress, zone distribution, ACWR gauges · generic CSV importer with fuzzy exercise matching and a review screen · full settings including HRmax, bar weights, bot schedule, data export and credits · Gym Visual attribution in place · accessibility and performance pass against the 1.5 s LTE budget.

**Done when:** the top row is populated with real numbers, imported history improves the prediction bands measurably, CSV and JSON export both round-trip, the Gym Visual attribution is visible under Settings → Credits, and PRD §6's 30-day metrics can actually be measured.

**Status:** *not started.*

---

## Honest ledger

**Delivered in this first build:**
- `docs/PRD.md` and `docs/RESEARCH_FOUNDATION.md` — the contract and the evidence base.
- `CLAUDE.md` — the governing rules.
- The complete domain vocabulary in `packages/engine/src/types.ts`, and an engine pipeline built against it with unit tests.
- The Supabase schema across five migrations, with RLS from the first one.
- Oura, Strava, Telegram and LLM clients over result-typed HTTP plumbing.
- A 1,908-exercise library at 69.4% GIF coverage, with the coverage report and the KOT reconciliation report committed.
- The KOT public scaffold normalized to 26 steps.
- A today card and the component set behind it.
- The documentation set: README, SETUP, ARCHITECTURE, ENGINE, DESIGN, CREDITS, OPERATIONS, this file, ten ADRs, two drop-zone notes, CONTRIBUTING and LICENSE.
- Model routing and the three subagents in `.claude/`.

**Not delivered, and not pretended otherwise:** auth · the PWA manifest and service worker · the Vercel deploy · every screen except the today card · every API route handler · the Mac mini worker · golden-file tests on session assembly · the dashboard · the CSV importer. **Nothing has been run against a real Supabase project, a real Oura token, a real Strava activity, or a real iPhone** — and that last one is the gap that matters most, because `CLAUDE.md` says a screen is not done until it has been.

**The critical path to the definition of done** — Seth taps the icon on a Tuesday, sees a session with a why line, logs it, swaps one exercise, finishes, gets a Telegram summary, and Wednesday reflects it — now runs through: finishing Phase 1 (auth, PWA, deploy), the runtime screen in Phase 4, and the bot plus worker in Phase 6. The engine underneath it is largely there.

**What is blocked on Seth right now:** Phase 7's real content (KOT spreadsheets), Phase 5 (Oura, Strava, strap), Phase 6 (Telegram, LM Studio confirmation, Gemini), and the import half of Phase 8 (CSVs, scale screenshot, vertical baseline). The full list with instructions is at the end of [`SETUP.md`](SETUP.md).
