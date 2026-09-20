# CLAUDE.md — Longevity OS Workout System

You are building Seth's personal training brain. Read `docs/PRD.md` and `docs/RESEARCH_FOUNDATION.md` before planning anything. The PRD is the contract; the research doc is the evidence and the integration facts. When they conflict with your instincts, follow them and flag the conflict.

## The one rule that governs every decision
**Seth should never have to think.** If a design choice adds a tap, a decision, or a mental model he has to hold, find another way. The app decides; he shows up.

## Project shape
- **Stack**: Next.js (App Router, TypeScript), Tailwind, Supabase (Postgres + RLS + Storage + pg_cron), Vercel Hobby, Telegram Bot API, LM Studio on a Mac mini (OpenAI-compatible at `http://localhost:1234/v1`) with Gemini free tier as fallback.
- **Cost ceiling: $0/month.** Never add a paid dependency, API, or tier without asking Seth explicitly.
- **Single user now**, `user_id` on every table, RLS on from the first migration.
- **Units**: pounds and miles in UI; store weight as `load_lb` numeric. Total-load convention everywhere (see PRD §8.2).

## Architecture invariants
1. **Rules engine is deterministic and owns all prescriptions.** Lives in `packages/engine/` (or `src/engine/`), pure TypeScript, no I/O, 100% unit-tested against fixture days in `engine/fixtures/`. The LLM may explain, converse, parse, and *request* engine actions through typed tools — it may never write a prescription the engine didn't produce.
2. **Every integration degrades gracefully**: no Oura → sliders; no LM Studio → Gemini; no Gemini → template copy; no Strava → manual. Never block the today card on a network call other than Supabase.
3. **Mac mini is outbound-only.** Worker polls/subscribes to Supabase `llm_jobs`; no tunnels, no inbound ports. Unclaimed job >60 s → Vercel Gemini fallback.
4. **Re-plan on every open.** The plan is a derived view over inputs + history, never a stored truth that goes stale. Persist plans for audit/diff, but recompute.
5. **Regional load ledger and pairing exclusions are hard constraints**, not scores. A session that violates them is a bug.

## Mobile Safari is the platform
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; `env(safe-area-inset-*)` padding; `height: 100%` on html/body, never `100vh`.
- Dark-mode aware via tokens on `:root`; thumb-zone primary actions; tap targets ≥44 px; no horizontal page scroll (wide content scrolls inside its own container).
- Numeric inputs: `inputmode="decimal"`, clear-on-focus for prescribed values.
- PWA manifest + service worker caching today's plan and media thumbnails. Test on an actual iPhone before calling any screen done.

## Design bar
Beautiful, minimal, modern. Reference screens via Mobbin (Fitbod, Ladder, Shred, Gymverse, Ray). No templated defaults: choose a typeface pair, a restrained palette, generous spacing, and motion only where it communicates state. One idea per screen.

## Data & content
- Exercise spine: `yuhonas/free-exercise-db` (public domain). GIFs: `hasaneyldrm/exercises-dataset` (© Gym visual, attribution required in-app — keep the credit). Report media coverage after ingestion; list KOT gaps.
- KOT program data comes from Seth's spreadsheets in `docs/programs/kot/raw/`; normalize to `programs/kot/*.json` (steps, standards as %BW, progressions, equipment substitutions, ground-up ordering).
- Planet Fitness has **no barbells/racks**; Smith bar effective weight ≈15–20 lb (per-location setting). Every barbell lift ships with `barbell_free` alternatives.

## Conventions
- Conventional commits. Small PR-sized steps. Every engine change ships with a fixture or a test.
- Migrations in `supabase/migrations/`, generated types committed.
- Env via `.env.local` + `.env.example` (never commit secrets). Required keys: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OURA_PAT`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_CHAT_ID`, `GEMINI_API_KEY`, `LMSTUDIO_BASE_URL`.
- `plansDirectory` set to `./.claude/plans` so plan-mode documents live with the repo and survive.

## Model routing (set up in the first session, then never touched)
Seth should not have to switch models by hand. On first run:
1. Write `.claude/settings.json` with `"model": "opusplan"`, `"effortLevel": "high"`, `"advisorModel": "opus"`, `"plansDirectory": "./.claude/plans"`, `"fallbackModel": ["sonnet", "haiku"]`. (If Seth confirms Fable access and consents to usage credits, use `"advisorModel": "fable"`.)
2. Create subagents in `.claude/agents/`: `researcher` (model: haiku; read-only codebase and docs exploration), `engine-builder` (model: opus, effort: xhigh; rules engine, fixtures, tests), `ui-builder` (model: sonnet, effort: high; screens, components, styling). Delegate to them by default.
3. Consult the advisor before committing to any schema, engine-architecture, or integration-pattern decision, and before declaring a phase done.
- Titles on everything: every generated doc, report, bot message, and plan has a title line.

## Working with Seth
- He's on his phone most of the time. Keep status updates short, lead with what changed, and give one clear ask when you need input.
- Before starting a phase, restate the phase goal in one line and list what you need from him (tokens, files, decisions). The handoff checklist is PRD §12.
- Ask, don't assume, on anything that costs money, touches his health data outside this system, or changes the weekly template's evidence defaults.
- Spellings: Vichi, Jessabelle, Claire, Winston, Ernest.

## Definition of done (v1)
Seth taps the home-screen icon on a Tuesday morning, sees today's session with a why line, taps Start, logs sets with the keypad, swaps one exercise, finishes, gets a Telegram summary — and Wednesday's plan already reflects it. Zero configuration on the day. Zero dollars.
