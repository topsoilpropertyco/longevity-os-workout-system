# Longevity OS Workout System — Product Requirements Document

Version 1.0 · 2026-09-20 · Owner: Seth · Status: approved for tactical planning in Claude Code

---

## 1. One-line

A personal, always-on training brain that decides what Seth should do today — lift, sprint, Zone 2, KOT, yoga, or rest — from his Oura data, his time, his location, and his history, so that he never has to be the air-traffic controller of his own fitness.

## 2. Problem

Ten paid apps, each with one specialty, none holistic. Every one of them left Seth to coordinate strength vs. cardio vs. mobility vs. recovery himself. With two small kids and several businesses, that coordination overhead is the reason consistency fails. The app's entire value is: **hit Open, show up, do what it says, get healthier.**

## 3. Goals (in priority order)

1. **Longevity and health** — every measurable marker Seth already collects trends the right way.
2. **Something physical every day** — 7/7, with active recovery as a first-class session type.
3. **Never tear down** — injury prevention via regional load management; rehabilitate knees and low back, don't just avoid them.
4. **Knees Over Toes** as the current program, run twice through; vertical jump / dunk as the athletic north star.
5. **Zero mental overhead** — the app decides; Seth can override anything in one or two taps.

## 4. Non-goals (v1)

Native iOS app · HealthKit / Apple Watch · multi-user · live in-app heart rate · nutrition · social · Wyze API integration · custom GIF production · voice · payments.

## 5. Users & context

- Single user (Seth, 34, 6'3", Detroit). Schema carries `user_id` from day one for future profiles.
- Devices: iPhone (mobile Safari, home-screen install), Mac mini (LM Studio, worker), chest strap → Strava app.
- Locations: **Home** (Bowflex adjustable DBs to 52.5 lb, adjustable flat/incline bench with Nordic support, pull-up bar, resistance bands), **Planet Fitness** (one or more; per-club checklist; Smith bar ≈15–20 lb effective), occasional **CrossFit box** (logged as external session).
- Realistic rhythm: ≥4 days/week at 30–45 min; other days 15–20 min or recovery. Many days are home-only.

## 6. Success metrics

- 30 days: ≥26/30 days with a logged session (any type); zero missed weeks; back and knee pain sliders flat or down.
- 90 days: Zone 2 minutes/week trending toward 150+; Oura VO2max and cardiovascular age moving favorably; weekly tonnage up; first vertical retest ≥ baseline + 1"; body-fat trend down if six-pack mode is on.
- Ongoing: the "why" is visible on every prescription; Seth overrides <20% of prescribed sessions (the plan matches reality).

---

## 7. System architecture

```
┌──────────────── iPhone (Safari, installed) ────────────────┐
│  Next.js PWA  — today card · week carousel · session runtime │
│  · swap carousel · clocks · dashboard · settings              │
└───────────────┬────────────────────────────────┬────────────┘
                │                                 │
        Vercel (free)                     Telegram (BotFather)
  ┌──────────────────────────┐           webhook → /api/telegram
  │ API routes / server acts │◄──────────────────────────────────┐
  │ /api/oura/sync (nightly) │                                    │
  │ /api/strava/webhook      │◄── Strava push events              │
  │ /api/telegram            │◄── messages, photos, button taps   │
  │ /api/llm/fallback (Gemini free)                               │
  └───────────┬──────────────┘                                    │
              │                                                   │
      Supabase (free) — Postgres + RLS + Storage + pg_cron        │
      tables: users, locations, equipment, exercises, media,      │
      sessions, sets, cardio_logs, oura_daily, strava_activities, │
      injuries, injury_checkins, programs, program_progress,      │
      plans, plan_days, body_metrics, llm_jobs, bot_messages      │
              ▲
              │ poll / realtime (outbound only — no inbound ports)
      Mac mini worker (Node/Python, launchd)
      → LM Studio  http://localhost:1234/v1  (text + vision)
      → writes llm_jobs results; keep-alive ping to Supabase
```

**Brain split**
- **Rules engine (deterministic, TypeScript, unit-tested)** owns: weekly template, program-slot placement, regional load ledger, pairing exclusions, progression + prediction, readiness modulation, deload triggers, session assembly within a time budget, Same/Easier/Harder ranking.
- **LLM layer (local LM Studio → Gemini free fallback)** owns: the "why" copy, Telegram conversation, photo → structured log, ambiguous-input resolution, weekly narrative. It **calls engine functions via tool schema**; it never invents a prescription outside engine output.

---

## 8. Functional requirements

### 8.1 Daily planning engine
- **Inputs**: Oura (readiness, sleep score, HRV vs 28-day baseline, RHR, activity, VO2max, cardiovascular age), three sliders (soreness, energy, stress; 1–5, tappable), minutes (15/20/30/45/60/90), location (sticky = last used), warm-up/cooldown defaults (on/off + minutes, on top of budget), injury register, active program, goal mode, last 28 days of logs and Strava.
- **Weekly template (evidence defaults, editable)**: 2–3 strength (60–120 min/wk total), KOT 2–3 (program slot, placed first), 1 VO2 session, Zone 2 accumulating toward 150–240 min/wk on a ≤10%/wk ramp from baseline, 1–2 power/plyo blocks (fresh, first in session), yoga/mobility ≥2, NEAT floor daily.
- **Readiness modulation**: ≥85 push · 70–84 as planned · 55–69 −10% load / RPE cap 7 · <55 or HRV −10% vs baseline → recovery day (mobility, Zone 1 walk, breathwork).
- **Regional load ledger**: rolling 7-day load per region; ≥48 h between hard hits, ≥72 h after eccentric-dominant; ACWR 0.8–1.3 on running distance, plyo contacts, tonnage.
- **Session assembly**: fill the minutes budget in priority order (power → strength → conditioning → Zone 2 → mobility), respecting equipment at the chosen location, exclusions, and the program's internal ordering (KOT ground-up).
- **Re-plan on every open** and on any input change. **Week carousel**: today + next 6 days; selecting another day's session for today rearranges the rest of the week (engine re-solves under constraints; shows a one-line diff).
- **Auto-deload**: triggered, not scheduled (see research §6.4); hard cap every 8–10 weeks.
- **"Why" line** on every session and on demand per exercise.

### 8.2 Session runtime
- Exercise card: GIF/loop, name, target (sets × reps × **total load**), prediction band (normal / probable / max), rest timer, cue text, "why".
- Logging: tapping a value **clears it and opens the numeric keypad**; prescribed values pre-filled; edits persist per set; RPE optional (1–10 buttons).
- **Weight convention**: total load everywhere. Dumbbell pairs sum both hands; barbell logs bar + plates with per-location bar weight (Smith default 20 lb, editable); bodyweight moves log added load only, with BW pulled from latest body metric. Convention explained inline once and in settings.
- **Swap**: horizontal carousel of alternatives, each tagged **Same / Easier / Harder**, filtered to location equipment, ranked by movement-pattern match, region, and equipment; one tap replaces and re-times the session.
- **Clocks**: rest countdown (auto-start after set), EMOM, AMRAP, interval/Tabata, for-time stopwatch; audible + haptic cues; keep-awake.
- Cardio prescription card: type (walk-run, Zone 2, 4×4, sprints, ruck), duration, target zone (bpm range from HRmax), structure; "Open Strava" button; completes when the matching Strava activity arrives or on manual entry.
- End-of-session summary: tonnage, PRs, duration, next-day preview.

### 8.3 Locations & equipment
- Unlimited locations; each a checklist over the **equipment catalog** (name, category, image, notes like "Smith bar 20 lb", "DBs to 75").
- Presets: **Home** (seeded), **Planet Fitness — standard** (clone per club), **CrossFit box — typical**, **Bodyweight only** (travel).
- Equipment images: manufacturer or generic; every item tappable.

### 8.4 Programs
- Program = ordered steps with standards, progression rules, session templates, equipment substitutions. `programs/kot/` ingested from Seth's spreadsheets; public scaffold in research §7.
- Program progress screen: step, standards met, cycle count (target: 2 full cycles).
- Programs are swappable; the longevity engine always fills around the active one.

### 8.5 Injury & rehab register
- Entries: region, onset, type (recent / longstanding), current pain 0–10, aggravators, notes. Seeded: knees, low back.
- Weekly check-in via bot (pain slider + free text). Rehab-oriented programming: KOT for knees; McGill Big 3 + hinge progression for back; pain-response rule (≥2-point rise in 24 h → regress one step).
- Injuries never disappear silently; Seth resolves them.

### 8.6 Goal modes
Primary buttons: **Maintain · Tone · Bulk · Six-pack**. "More" reveals Strength, Power, Endurance, Rehab, VO2 focus, Fat loss. Changing mode re-solves the week and adjusts rep/load bands and core volume.

### 8.7 Cardio logging
- Primary: **Strava sync** (webhook + nightly reconcile); compute Zone minutes from HR stream; match to prescription; compliance score.
- Manual: any single field suffices (minutes, miles, type, RPE, avg HR); never blocks.
- External sessions (CrossFit class): text ("did a class, hard, 60 min") or **photo of the whiteboard** → vision parse → follow-up questions → log.

### 8.8 Telegram bot
- Daily brief 06:30 (adjustable): readiness, today's session (type, minutes, location), one-line why, quick buttons (Start · 20 min instead · Home instead · Skip).
- Post-session summary; Sunday weekly report; weekly scale prompt; weekly injury check-in.
- Free-form chat routed rules-first, then LLM with engine tools. Photo intake for logs and scale screenshots.

### 8.9 Dashboard
- **Top row (fixed)**: Zone 2 min/wk · sessions this week + streak · weekly tonnage · Oura VO2max & cardiovascular age · vertical (latest / baseline) · weight & body-fat trend · knee & back pain trend.
- Explore: per-exercise e1RM trend with plateau detection, PR feed, weekly minutes by bucket, readiness vs performance overlay, program progress, Zone distribution per week, ACWR gauges.
- Weekly summary card mirrors the bot report.

### 8.10 Data import
Generic CSV importer (Fitbod, Strong, Hevy, others) → fuzzy exercise match → review screen → seeds history and predictions.

### 8.11 Settings
Goal mode · warm-up/cooldown defaults · units (lb/mi) · HRmax and zones · bar weights per location · bot schedule · Oura/Strava/Telegram credentials · data export (CSV/JSON) · credits/attribution.

---

## 9. Non-functional requirements
- **Mobile Safari first**: viewport-fit cover, safe-area insets, 100% height (not 100vh), no horizontal scroll, dark-mode aware, thumb-zone controls, tap targets ≥44 px, zero layout shift on data load.
- **Performance**: today card interactive <1.5 s on LTE; media lazy-loaded; offline read of today's plan (service worker cache).
- **Reliability**: every integration degrades gracefully — no Oura → sliders only; no LM Studio → Gemini; no Gemini → deterministic "why" templates; no Strava → manual entry.
- **Security**: secrets in env only; Supabase RLS on; Telegram webhook secret; Strava/Oura tokens encrypted at rest.
- **Testing**: rules engine 100% unit-tested with fixture days (high readiness / low readiness / injury flare / 15-min home / 90-min PF); golden-file tests for session assembly.
- **Cost**: $0/month target. Any paid dependency requires Seth's explicit yes.

---

## 10. Data model (high level)
`users` · `locations` · `equipment_catalog` · `location_equipment` · `exercises` (pattern, region loads, equipment, level, kot_step?, barbell_free alternatives) · `exercise_media` · `plans` / `plan_days` / `plan_blocks` · `sessions` / `session_exercises` / `sets` · `cardio_logs` · `strava_activities` (+ streams summary) · `oura_daily` · `body_metrics` · `injuries` / `injury_checkins` · `programs` / `program_steps` / `program_progress` · `goal_settings` · `llm_jobs` · `bot_messages` · `imports`.

---

## 11. Build phases (suggested for Claude Code to refine)
1. **Foundation** — repo, Next.js + Supabase + Vercel, schema, auth (single-user magic link), PWA shell, design tokens.
2. **Library** — exercise/media ingestion + coverage report; equipment catalog + presets; Home seeded.
3. **Engine v1** — weekly template, session assembly, readiness modulation, ledger, swaps; fixtures + tests. Sliders-only inputs.
4. **Runtime** — session screen, logging, keypad, clocks, swap carousel, summary.
5. **Oura + Strava** — sync, zones, prescriptions, compliance.
6. **Telegram + LLM** — bot, worker on mini, Gemini fallback, photo logging, "why" copy.
7. **Programs + Injuries** — KOT ingestion, program progress, rehab register, check-ins.
8. **Dashboard + Import + Polish** — top row, explore charts, CSV import, settings, attribution.

---

## 12. Handoff checklist (Seth)
- [ ] Oura personal access token (check existing Claude Code env first)
- [ ] Strava developer app: client ID/secret, redirect URI (walk-through at build)
- [ ] Telegram: new bot via BotFather → token; your chat ID
- [ ] KOT spreadsheets + links → `docs/programs/kot/raw/`
- [ ] Old-app CSV exports (Fitbod, Strong, Hevy, others) → `docs/imports/raw/`
- [ ] Wyze scale screenshot (for parser shape) + current weight
- [ ] Confirm LM Studio server port and installed models (text + vision)
- [ ] Find the chest strap; pair with Strava app
- [ ] Vertical baseline: chalk, wall, 10 minutes — the app will prompt

---

## 13. Open decisions deferred to tactical planning
- Next.js App Router + server actions vs. separate API layer.
- Supabase Realtime vs. polling for the mini worker (default: poll every 15 s).
- Whether the week carousel re-solve is server-side (consistent) or client-side (instant) — default server, optimistic UI.
- Exact HRmax source precedence: measured (Strava max over 90 days) > Oura > 220−age.
- "One set" (unresolved feature memory from a past app) — parked.
