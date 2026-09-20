# Longevity OS — Operations

Running it day to day. What the scheduled jobs do, how to tell whether the Mac mini is alive, what to do when something breaks, and how to rotate every credential without downtime.

**The 30-second version:** if something looks wrong, open **Settings → Integrations**. Every row has a status dot and a last-seen time. That page answers most of this document.

---

## 1. The nightly jobs

Vercel Hobby cron is limited to roughly **2 jobs, once per day, with imprecise timing** ⚠️ (RESEARCH §8) — a daily job fires inside a window, not on the minute. So the schedule lives in Supabase `pg_cron`, which is on the free tier and has neither limit, and Vercel cron is held in reserve as a backstop within its two-job budget.

### On Supabase `pg_cron` (`supabase/migrations/0005_cron.sql`)

| Job | When | What it does | If it fails |
| --- | --- | --- | --- |
| **Oura sync** | Nightly | Pulls yesterday's `daily_readiness`, `daily_sleep`, `sleep` (for `average_hrv`), `daily_activity`, `daily_stress`, `daily_resilience`, `vO2_max` and `daily_cardiovascular_age` into `oura_daily`, and backfills any missing day in the last 28. | The on-open pull catches it when Seth opens the app. Missing entirely → sliders. Nothing blocks. |
| **Strava reconcile** | Nightly | Lists activities since the last sync, fetches detail and HR streams for anything new, computes zone minutes, matches to prescriptions, scores compliance. Catches whatever the webhook dropped. | The webhook usually got there first. Worst case the activity appears a day late. |
| **Weekly rollup** | Weekly | Aggregates the week — dose against targets, tonnage, PRs — for the Sunday report and the dashboard's weekly card. | The dashboard computes live; only the bot report is late. |
| **Keep-alive** | Frequent | Writes a row so the free project never idles toward its ~7-day pause. Independent of the Mac mini's own keep-alive. | See §3. |

Every run is recorded in `cron_runs`, which is the first table to look at when something did not happen.

### Bot messages

The 06:30 daily brief, the Sunday report, the weekly scale prompt and the weekly injury check-in are scheduled here too, not on Vercel — precisely because Hobby cron cannot promise 06:30.

### On Vercel cron (the backstop)

The same sync work is exposed as `/api/oura/sync` and `/api/strava/sync`, guarded by `Authorization: Bearer $CRON_SECRET` so they are not publicly triggerable. They exist so a sync can be re-run by hand, and so up to two of them can be scheduled on Vercel if `pg_cron` is ever unavailable.

### On the Mac mini (continuous)

The worker polls `llm_jobs` every 15 seconds, calls LM Studio, writes results back, and updates its keep-alive row on every poll.

### Manual

```bash
npm run ingest:exercises   # re-run after a dataset update; prints the media coverage report
npm run ingest:kot         # after Seth drops new spreadsheets in docs/programs/kot/raw/
```

---

## 2. Is the Mac mini worker alive?

Three ways, in order of effort.

**1. In the app.** **Settings → Integrations → Worker** shows the last keep-alive time. Under a minute is healthy. Over five minutes means the worker is down or the mini is asleep.

**2. In the data.** Look at `llm_jobs`: healthy is jobs moving `queued → claimed → done` within a second or two of the poll interval, and `claimed_by` naming the mini. Unhealthy is a pile of rows that went straight from `queued` to Gemini at 60 seconds.

**3. On the mini itself.**

```bash
# Is the worker process running under launchd?
launchctl list | grep longevity

# Is LM Studio actually serving?
curl http://localhost:1234/v1/models

# Is it bound to loopback only? (It must be.)
lsof -i :1234

# Recent worker log
tail -50 ~/Library/Logs/longevity-worker.log
```

**If it is down:** reload the launchd agent. If it comes back and dies again, the usual causes are LM Studio not running (the server does not auto-start with the machine unless you told it to), a model that was unloaded, an expired or rotated Supabase service-role key, or the mini having gone to sleep despite `caffeinate`.

**Nothing breaks while it is down.** Every LLM job falls through to Gemini at 60 seconds, and then to template copy. The only visible symptom is slightly slower, slightly plainer "why" lines. Fix it when convenient.

---

## 3. Supabase pausing

⚠️ **Free Supabase projects pause after about 7 days of inactivity** (RESEARCH §8). A paused project does not answer queries, which means the today card does not render — the one dependency with no fallback.

**What prevents it:**

1. **Daily use.** Seth opening the app is activity. In normal operation this alone is enough.
2. **The keep-alive ping.** Every worker poll writes to Supabase — that is 5,760 touches a day from the mini, and it is the actual insurance. It is the reason the worker keeps polling even when there are no jobs.
3. **The nightly crons.** Two more writes a day from Vercel, independent of the mini.

The risk window is a holiday where the app goes unused **and** the mini is unplugged or offline. Both have to fail together.

**If it does pause:** open the Supabase dashboard and resume the project. It takes a minute or two and no data is lost. Then work out which of the three keep-alives stopped — usually the mini.

---

## 4. Rotating credentials

Rotate when a value has been exposed, when a device is lost, or on a whim. Do them one at a time and verify in between.

| Credential | How to rotate | Downtime |
| --- | --- | --- |
| **Supabase `anon` key** | Dashboard → Project Settings → API → rotate. Update `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` and in Vercel, then redeploy. | Seconds, between rotation and redeploy. |
| **Supabase `service_role` key** | Same page. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel **and in the worker's config on the mini**, then redeploy and restart the worker. Missing the mini is the classic mistake — it goes quiet and everything silently falls through to Gemini. | Seconds for the web, until the worker restarts for the mini. |
| **Supabase DB password** | Dashboard → Database → reset. Only matters if you connect directly with `psql`. | None. |
| **Oura PAT** | Revoke at https://cloud.ouraring.com/personal-access-tokens, create a new one, update `OURA_PAT`, redeploy. | One nightly sync at most; the next run backfills. |
| **Strava client secret** | strava.com/settings/api → your app. Update `STRAVA_CLIENT_SECRET` and redeploy. **The existing refresh token keeps working**, so nothing needs reconnecting. | None. |
| **Strava refresh token** | Revoke the app's access in Strava's settings, then reconnect from Settings → Integrations. | Until reconnected; the reconcile backfills. |
| **Strava webhook verify token** | Change `STRAVA_WEBHOOK_VERIFY_TOKEN`, delete the existing subscription, create a new one, complete the GET challenge again. | Webhook only; the nightly reconcile covers the gap. |
| **Telegram bot token** | @BotFather → `/revoke` → new token. Update `TELEGRAM_BOT_TOKEN`, redeploy, and **re-register the webhook** — the old registration dies with the old token. | Until the webhook is re-registered. |
| **Telegram webhook secret** | Change `TELEGRAM_WEBHOOK_SECRET`, redeploy, re-register the webhook with the new secret. Order matters: deploy first, or every incoming update is rejected. | Seconds if ordered correctly. |
| **Gemini API key** | Revoke in Google AI Studio, create a new one, update `GEMINI_API_KEY`, redeploy. | None — the mini is handling jobs anyway. |
| **`CRON_SECRET`** | Invent a new one, update in Vercel, redeploy. | One cron window at most. |

**After any rotation:** confirm no old value survives in `.env.local`, in Vercel's environment variables, in the worker's config on the mini, or in a plan document under `.claude/plans/`. And if a secret ever reaches a git commit, rotate it — rewriting history does not un-publish it.

---

## 5. Exporting the data

PRD §8.11: **Settings → Data export**, CSV or JSON. It is Seth's data and it leaves whenever he wants.

| Export | Format | Contents |
| --- | --- | --- |
| **Sessions and sets** | CSV | date, session type, location, exercise, set index, reps, `load_lb` (total load), RPE, completed, duration, distance |
| **Cardio** | CSV | date, modality, minutes, miles, avg HR, max HR, zone minutes z1–z5, source, Strava activity id |
| **Oura daily** | CSV | date, readiness, sleep score, HRV, RHR, steps, MET minutes, VO2max, cardiovascular age |
| **Body metrics** | CSV | date, weight, body-fat %, source |
| **Injuries and check-ins** | CSV | region, onset, kind, pain over time, notes |
| **Everything** | JSON | Full relational dump including plans, program progress, prediction history and the engine signature for each plan — the version to keep if you ever want to replay a decision. |

Notes: weight is always **total load in pounds** and distance is always **miles**, matching what is stored (ADR 0008). Exports are generated on demand and streamed; nothing is staged in Storage, so there is no stale export to leak. The JSON export is the one that can rebuild the app's state from scratch.

---

## 6. Troubleshooting

The ten most likely failures.

| # | Symptom | Most likely cause | Fix |
| --- | --- | --- | --- |
| 1 | **Today card will not load; everything else is fine** | Supabase project paused after ~7 days idle ⚠️ | Resume it in the dashboard. Then find out why the keep-alive stopped — usually the mini is off (§3). |
| 2 | **Readiness shows sliders instead of Oura** | PAT revoked, or the nightly sync did not run | Check `oura_daily` for last night's row. Re-run the sync by hand. If it 401s, the PAT is dead — make a new one (§4). Meanwhile the sliders are a correct fallback, not an error. |
| 3 | **"Why" lines are plain and appear late** | The mini is not claiming jobs; Gemini is answering at 60 s | Check the worker (§2). Reload the launchd agent, confirm LM Studio is serving on 1234, confirm the mini is not asleep. Not urgent. |
| 4 | **No "why" line at all, just template copy** | Mini **and** Gemini both unavailable | Check `GEMINI_API_KEY` and ⚠️ whether the free-tier quota changed or was exhausted. This is the designed floor — the prescription is unaffected. |
| 5 | **A run finished but never appeared** | Strava webhook subscription dead, or the callback did not answer within 2 s | Verify the subscription exists and the callback URL matches the current deployment. The nightly reconcile will catch it regardless — confirm it appears tomorrow before debugging further. |
| 6 | **Cardio appears but zone minutes are empty** | No HR stream — the chest strap was not worn, was not paired, or its battery is dead | Fresh coin cell, re-pair with the Strava app, wet the electrodes. Zone minutes cannot be recovered for that activity; log it manually if it mattered. |
| 7 | **Bot has gone silent** | Webhook not registered after a deploy or a token rotation; or the secret header no longer matches | Check the webhook's registered URL and error count. Re-register with the current `TELEGRAM_WEBHOOK_SECRET`. If you rotated the token, the old registration is gone (§4). |
| 8 | **06:30 brief arrives at a random hour, or not at all** | It was scheduled on Vercel Hobby cron, which is imprecise ⚠️, rather than on `pg_cron` | Check `cron_runs` for the firing time. Schedule it in `pg_cron` (§1) — that is the documented reason those jobs live there. |
| 9 | **Prescribed load is not achievable at this location** | Location increment or bar weight is wrong — most often a Planet Fitness Smith bar left at 45 lb when its effective weight is ≈15–20 lb | Fix it in Settings → Locations. Then check tonnage for the affected sessions, because every number downstream was computed from the wrong bar. |
| 10 | **Vercel build fails immediately, "no package.json"** | Root Directory not set to `longevity-os` | Vercel → Settings → General → Root Directory → `longevity-os`. Redeploy. (SETUP Step 13.) |

**Two more worth knowing:**

- **A session violates the ledger or a pairing exclusion.** That is a **bug**, not a tuning issue (invariant 5). Capture the exact `PlanInput`, add it to `packages/engine/fixtures/` as a failing fixture, and fix the engine. Do not fix it in the UI.
- **The plan changed between two opens on the same day with no new input.** Also a bug. The engine is deterministic; identical input yields an identical `signature`. Diff the two signatures and the two inputs — something in the gathering layer is non-deterministic, and that is where to look.
