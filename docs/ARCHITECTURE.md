# Longevity OS — Architecture

How the pieces fit, what happens on a normal Tuesday, and what happens when any one of them is missing. The short version: **a deterministic engine decides, an LLM narrates, and nothing in the second half can block the first.**

---

## 1. The system, as drawn in PRD §7

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

### Reading the diagram

**The phone** is the only client. It is Safari, installed to the home screen, and it is treated as the platform rather than as a small desktop. It holds no logic worth losing: it reads and writes Supabase, calls server actions for mutations, and caches today's plan in a service worker so the card renders on the subway.

**Vercel** is stateless glue. Server actions serve the app's own mutations; route handlers exist only where an outside system needs a public URL to POST to — Telegram, Strava, cron, and the Gemini fallback. That split is ADR 0001.

**Supabase** is the only thing that is ever the truth. Postgres holds every table in PRD §10, RLS is on from the first migration, Storage holds media, and `pg_cron` runs anything that needs a schedule tighter than Vercel Hobby's roughly-daily cron. It is also the message bus: `llm_jobs` is a table, not a queue service, and that is deliberate.

**Telegram** is the second front door. Everything the app can do, the bot can do: brief, start, swap, log, report. It costs nothing and it reaches Seth where he already is.

**The Mac mini** is a peer that only ever dials out. It polls `llm_jobs`, calls LM Studio over loopback, and writes results back. It has no public address and no inbound ports. It also pings a keep-alive row, which is what stops the Supabase project idling into a pause during a holiday.

**What is deliberately absent:** no queue service, no Redis, no separate API server, no tunnel into the house, no live heart-rate connection to the phone (mobile Safari has no Web Bluetooth — the strap talks to the Strava app and we read the stream afterwards).

---

## 2. The brain split

Two halves, and the boundary between them is the single most important line in the system.

### The rules engine — deterministic, pure TypeScript, unit-tested

Lives in `packages/engine/`. Owns:

- the weekly template and its evidence defaults
- program-slot placement (KOT first, ground-up)
- the regional load ledger and ACWR
- pairing exclusions
- progression and prediction bands
- readiness modulation
- deload triggers
- session assembly within a time budget
- Same / Easier / Harder swap ranking

It performs no I/O. Its input is one `PlanInput` object assembled by the caller; its output is one `PlanResult`. Same input, same output, forever — there is a `seed` field for anything that would otherwise be arbitrary, and a `signature` hash on the result so two plans can be diffed. `docs/ENGINE.md` walks through how it thinks.

### The LLM layer — local first, cloud fallback, templates underneath

Runs on LM Studio on the Mac mini, falling back to Gemini's free tier. Owns:

- the "why" line on a session and on each exercise
- Telegram conversation
- photo → structured log (whiteboard, scale screenshot)
- ambiguous-input resolution ("did a class, hard, 60 min")
- the weekly narrative

It calls engine functions through a typed tool schema. **It may explain, converse, parse, and request engine actions. It may never write a prescription the engine did not produce.**

### Why the line is drawn there

A prescription is a claim about someone's knees. It has to be reproducible, testable against fixture days, and explainable by pointing at a rule and a number. Language models are excellent at the sentence "backing off today because your HRV is 12% below baseline" and unsuitable for choosing the 10% itself. So the engine decides and the model narrates, and if the model is unreachable the narration falls back to a template while the decision is unchanged.

---

## 3. Request lifecycle: Seth opens the app on a Tuesday

1. **Tap.** The installed PWA launches. The service worker paints last night's cached today-card immediately — no spinner, no layout shift.
2. **Session.** Supabase auth resolves the single-user session from the stored token. Every subsequent query is RLS-scoped to his `user_id`.
3. **Gather.** One server action assembles `PlanInput`: today's date, athlete profile, goal settings, the minute budget (last used, or what he taps), the sticky location, today's Oura row plus 28 days of history, today's self-report if given plus recent ones, 28+ days of sessions and cardio, the injury register, body metrics, the active program and its progress, and the exercise library filtered to the location's equipment.
4. **Oura freshness.** If last night's Oura row is missing, an on-open pull fetches it. This is time-boxed. If it does not return, the engine proceeds without it and the readiness assessment switches source to `sliders` or `default` — the card is never blocked on a network call other than Supabase.
5. **Solve.** The engine runs the pipeline and returns a `PlanResult`: today's `PrescribedSession`, the seven-day week, the ledger, deload state, weekly dose, warnings, signature.
6. **Persist for audit.** The plan is written to `plans` / `plan_days` with its signature. This is a record of what was decided, not a cache to read back — invariant 4 says re-plan on every open (ADR 0006).
7. **Render.** Today's card shows type, minutes, location, and the one-line why. Below it the week carousel, then Start.
8. **Copy.** If the persisted "why" is stale relative to the new signature, the app inserts an `llm_jobs` row and renders the deterministic template in the meantime. The mini claims it within ~15 seconds and the line quietly upgrades itself in place. If the mini never claims it, Gemini answers at 60 seconds. If Gemini is unavailable, the template was already correct and nothing visibly failed.
9. **Start.** The runtime screen opens the first block. Each set card shows the GIF, target sets × reps × **total load**, the prediction band, and rest. Tapping a value clears it and opens the numeric keypad.
10. **Swap.** He does not like the prescribed row. The swap carousel shows alternatives tagged Same / Easier / Harder, filtered to the location's equipment, ranked by pattern match, region and equipment fit. One tap replaces it and re-times the session.
11. **Log.** Each set writes through to `sets` as it completes. Offline writes queue and flush on reconnect.
12. **Finish.** End-of-session summary: tonnage, PRs, duration, next-day preview. A `bot_messages` row goes out through Telegram.
13. **Wednesday.** No nightly job is responsible for "making tomorrow's plan". Wednesday's plan reflects Tuesday because the plan is a derived view: Tuesday's sets moved the ledger, the ACWR and the weekly dose, and Wednesday's solve reads them. Opening the app is what produces the plan.

---

## 4. The `llm_jobs` worker-pull pattern

The Mac mini is behind a home router. Exposing it would mean a tunnel, a dynamic-DNS name and an attack surface, for a machine that generates sentences. So it dials out instead.

```
Vercel / server action          Supabase `llm_jobs`              Mac mini worker
────────────────────           ───────────────────              ───────────────
insert job                ──►   status: queued
                                claimed_by: null                 poll every 15 s
                                                            ◄──  claim (conditional
                                                                 update: queued → claimed,
                                                                 only if still unclaimed)
                                status: claimed                  call LM Studio
                                                                 localhost:1234/v1
                                                            ◄──  write result,
                                status: done                     status: done
read result / realtime    ◄──
```

- **The claim is atomic.** A conditional update — set `claimed` only where the row is still `queued` — means the worker and the fallback can race safely and exactly one wins.
- **Poll, not Realtime**, at 15 seconds, which is PRD §13's default. The reasoning and the conditions under which we would switch are in ADR 0002.
- **The 60-second fallback:** a Vercel function sweeps for jobs still `queued` past 60 seconds and runs the same prompt against Gemini, producing the same output schema. The consumer cannot tell which engine answered, and does not care.
- **Vision jobs** — whiteboard photo, scale screenshot — go the same route, to a local vision model (Qwen2.5-VL / Llama 3.2 Vision class) or Gemini Flash vision. Output is strict JSON validated against the workout-log schema; ambiguous fields become bot follow-up questions rather than guesses.
- **Keep-alive.** Each poll is also a write to Supabase, which is how a project that would otherwise pause after ~7 days of inactivity stays awake, and how `Settings → Worker` knows the mini is alive.

---

## 5. Graceful degradation matrix

Invariant 2. Every row here is a designed behaviour with a test, not a hope.

| When this is missing | The system does this | Seth sees | What is lost |
| --- | --- | --- | --- |
| **Oura** (token absent, API down, no row yet) | Readiness comes from the three sliders — soreness, energy, stress — mapped to the same 0–100 band scale. `ReadinessAssessment.source` becomes `sliders`. | A three-tap slider row above the today card. | HRV-vs-baseline trend, VO2max and cardiovascular-age tiles. Band logic is unchanged. |
| **Oura and the sliders** (he skipped them) | `source: 'default'`, band `as_planned`, load multiplier 1.0. | Today's card, planned normally. | Readiness modulation for the day. The plan is still correct, just unmodulated. |
| **LM Studio / the mini** | Job sits `queued`; at 60 s the Vercel fallback runs the same prompt on Gemini. | Nothing, beyond a slightly later "why" line. | Local-only privacy for that one job. |
| **Gemini too** | Deterministic template copy, composed from the same engine facts that would have been in the prompt. | A plainer why line: "KOT first — knees are the program, and they are 62 hours fresh." | Prose quality. Not information. |
| **Strava** (not connected, webhook broken) | Manual cardio entry. Any single field is enough — minutes, or miles, or type, or RPE, or average HR. | An "Open Strava" button becomes a manual entry row. | Automatic zone minutes from the HR stream, and compliance scoring. |
| **The chest strap** | Cardio logs without a HR stream; zone minutes are estimated from pace and duration and flagged as estimated. | Same cards. | Accurate Zone 2 accounting and VO2 session compliance. |
| **Telegram** | The app is complete on its own. | No 06:30 brief. | The nudge. |
| **Network entirely** | The service worker serves today's cached plan and media thumbnails; set logs queue locally and flush on reconnect. | Today's card, fully usable. | Re-planning, swaps that need uncached alternatives, live sync. |
| **Supabase** | This is the one dependency with no fallback. The cached today-card still renders read-only. | Today's plan, and an honest banner. | Everything else. |
| **Everything at once** | **Today's card still renders.** | Today's card. | Everything else. |

The bottom row is the invariant that matters: never block the today card on a network call other than Supabase.

---

## 6. The five architecture invariants

From `CLAUDE.md`. These are not preferences.

### 1. The rules engine is deterministic and owns all prescriptions

Pure TypeScript in `packages/engine/`, no I/O, unit-tested against fixture days. The LLM may explain, converse, parse and request engine actions through typed tools; it may never write a prescription the engine did not produce.

*Why it exists:* prescriptions are claims about a body with two injured regions. They have to be reproducible, diffable and defensible by pointing at a rule and a number — and a probabilistic text generator can be none of those things.

### 2. Every integration degrades gracefully

No Oura → sliders. No LM Studio → Gemini. No Gemini → template copy. No Strava → manual. Never block the today card on a network call other than Supabase.

*Why it exists:* the entire product is "hit Open, show up". An app that cannot answer on a bad LTE connection has broken its only promise, and one dead integration must never become a missed session.

### 3. The Mac mini is outbound-only

The worker polls or subscribes to Supabase `llm_jobs`. No tunnels, no inbound ports. A job unclaimed past 60 seconds goes to the Vercel Gemini fallback.

*Why it exists:* a home machine holding health data should not be reachable from the internet, and a tunnel is a permanent hole plus a service to maintain. Dialling out gets the same capability with no attack surface. ADR 0010.

### 4. Re-plan on every open

The plan is a derived view over inputs and history, never a stored truth that goes stale. Persist plans for audit and diff, but always recompute.

*Why it exists:* a stored plan is wrong the moment readiness, minutes, location or an injury changes — and those change constantly. Recomputing means there is no staleness class of bug at all, and the week carousel's "pull Thursday to today" re-solve is the same code path as the ordinary open.

### 5. The regional load ledger and pairing exclusions are hard constraints

Not scores. A session that violates them is a bug.

*Why it exists:* goal three is "never tear down". A constraint that can be outvoted by a good-looking score will eventually be outvoted on exactly the day it mattered — the day after heavy eccentrics, when he feels great. The ledger and the exclusion list are the only things standing between an enthusiastic engine and an injury.

---

## 7. Where to read next

- How the engine reasons, stage by stage, with a worked example → [`ENGINE.md`](ENGINE.md)
- Screens, tokens and the mobile-Safari rules → [`DESIGN.md`](DESIGN.md)
- Crons, keep-alive, rotation, troubleshooting → [`OPERATIONS.md`](OPERATIONS.md)
- Why each of these choices went the way it did → [`decisions/`](decisions/)
