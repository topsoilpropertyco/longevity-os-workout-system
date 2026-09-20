# Longevity OS — Setup Walkthrough

Everything, in order, from an empty machine to a working app on the iPhone home screen. Each step says how long it takes. **You can stop after Step 6** — the app runs locally with sliders only. Everything after that adds an integration, and every integration is optional by design.

**Total if you do all of it: about 2 hours**, most of it waiting on Supabase and Vercel.

Anything marked ⚠️ is something the research foundation says to verify on the day, because free tiers and APIs move.

---

## The short version

| # | Step | Minutes | Needed for |
| --- | --- | --- | --- |
| 1 | Prerequisites | 10 | Everything |
| 2 | `npm install` | 3 | Everything |
| 3 | Supabase project | 10 | Everything |
| 4 | Run the migrations | 5 | Everything |
| 5 | `.env.local` | 5 | Everything |
| 6 | Dev server | 2 | Everything |
| 7 | Install the PWA on the iPhone | 3 | Daily use |
| 8 | Oura PAT | 5 | Readiness |
| 9 | Strava app + webhook | 20 | Cardio, Zone 2 |
| 10 | Telegram bot | 10 | Daily brief |
| 11 | LM Studio on the Mac mini | 25 | "Why" copy, chat, photo logs |
| 12 | Gemini fallback | 5 | LLM when the mini is asleep |
| 13 | Deploy to Vercel | 15 | Real URL, webhooks, cron |
| 14 | Chest strap | 5 | HR zones |
| 15 | Vertical baseline | 10 | The north star |

---

## 1. Prerequisites — 10 min

1. **Node 20 or newer.** Check with `node -v`. If it is older, install Node 20+ (nvm, Homebrew, or the installer from nodejs.org).
2. **Git**, and a clone of this repository.
3. **A Supabase account** — free, GitHub sign-in is fastest.
4. **A Vercel account** — free Hobby tier. Sign in with the same GitHub account.
5. **An iPhone with Safari.** This is the platform; every screen gets tested on the real device before it is called done.
6. Optional, for the LLM layer: **the Mac mini**, awake, on the same power outlet forever, with LM Studio installed.

You do **not** need Docker, the Supabase CLI, or a paid anything.

---

## 2. Install dependencies — 3 min

```bash
cd longevity-os
npm install
```

Then confirm the toolchain is healthy:

```bash
npm run check
```

That runs the typechecker across all workspaces and then the engine tests. If it fails before you have changed anything, fix that first — nothing downstream is trustworthy otherwise.

---

## 3. Create the Supabase project — 10 min

1. Go to the Supabase dashboard and click **New project**.
2. Name it `longevity-os`. Choose the region closest to Detroit.
3. **Copy the database password into your password manager now.** Supabase shows it once.
4. Wait for provisioning — usually 2–3 minutes.
5. Open **Project Settings → API**. You need three values:
   - **Project URL** → `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`
6. The `service_role` key bypasses row-level security. It goes in server-side env only. It never goes in a `NEXT_PUBLIC_` variable, never in client code, never in a Telegram message, never in a screenshot.

⚠️ **Free projects pause after about 7 days of inactivity** (RESEARCH §8). Daily use of the app prevents this on its own; the Mac mini's keep-alive ping is the insurance policy for holidays. See `docs/OPERATIONS.md`.

---

## 4. Run the migrations — 5 min

Every schema change lives in `supabase/migrations/`, numbered, in order. Row-level security is on from the very first one (see `docs/decisions/0009-rls-from-first-migration.md`).

There are five: `0001_init` (tables, enums, indexes, triggers), `0002_rls` (RLS on every table), `0003_seed_equipment`, `0004_seed_presets` (Home, Planet Fitness — standard, CrossFit box — typical, Bodyweight only), `0005_cron` (the scheduled jobs). They are idempotent, so re-running one is harmless. `supabase/README.md` has the full per-file detail and the local CLI loop.

**The simple way, no CLI, no Docker:**

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Open `supabase/migrations/0001_init.sql`, paste the whole thing, click **Run**.
3. Repeat for each file **in filename order**. Do not skip one, and do not reorder them.
4. Open **Table Editor** and confirm the tables exist: `users`, `locations`, `equipment_catalog`, `exercises`, `sessions`, `sets`, `oura_daily`, `llm_jobs` and the rest of PRD §10.
5. Open **Authentication → Policies** and confirm every table shows RLS enabled. `0002_rls.sql` fails loudly if a table slipped through, so a clean run is itself the check.
6. Apply a location preset to create Home: `0004_seed_presets.sql` installs `apply_location_preset()` for exactly this.

**With the CLI** (needs Docker): `npx supabase start` then `npx supabase db reset` applies all five to a clean local database. See `supabase/README.md`.

**Then seed the library:**

```bash
npm run ingest:exercises
```

This joins `yuhonas/free-exercise-db` (metadata spine) with the Gym Visual media set, normalizes equipment into the engine's vocabulary, and prints a **media coverage report** plus a list of KOT movements with no GIF. Expect gaps on tibialis raise, Patrick step, Poliquin step, ATG split squat, backward sled, reverse Nordic, QL extension and seated good morning — those fall back to a static image plus written cues (RESEARCH §1).

---

## 5. Create `.env.local` — 5 min

```bash
cp .env.example .env.local
```

Fill in the five Supabase values from Step 3 and set `APP_URL=http://localhost:3000`. Leave everything else at its placeholder for now — each integration section below tells you which key it fills.

`.env.local` is gitignored. Keep it that way. If a key ever lands in a commit, treat it as burned and rotate it (`docs/OPERATIONS.md`).

---

## 6. Run the dev server — 2 min

```bash
npm run dev
```

Open http://localhost:3000. You should see today's card. With no Oura token connected it asks for the three sliders — soreness, energy, stress — and plans from those. That is the designed fallback, not a degraded mode you need to fix.

**This is a legitimate stopping point.** Everything below adds a source of truth; none of it is required to train tomorrow.

---

## 7. Install the PWA on the iPhone home screen — 3 min

Do this against the deployed URL once Step 13 is done; until then, your Mac's LAN address works if the phone is on the same Wi-Fi.

1. Open the URL in **Safari** (not Chrome — only Safari can install to the home screen on iOS).
2. Tap the **Share** button.
3. Scroll and tap **Add to Home Screen**.
4. Name it **Longevity** and tap **Add**.
5. Open it from the home screen. It should run full-bleed with no Safari chrome, respect the notch and the home indicator, and not scroll horizontally anywhere.
6. Turn on airplane mode and reopen it. Today's plan should still render from the service-worker cache.

If the status bar overlaps content or the bottom button sits under the home indicator, that is a safe-area bug — see the checklist in `docs/DESIGN.md`.

---

## 8. Oura personal access token — 5 min

**Check for an existing token first.** PRD §12 says so explicitly: Seth may already have an Oura PAT from other Claude Code work. Look in existing `.env` files and the keychain before creating a second one.

1. Go to **https://cloud.ouraring.com/personal-access-tokens**.
2. Sign in with the Oura account tied to the ring.
3. Create a token, name it `longevity-os`, and copy it — it is shown once.
4. Put it in `.env.local` as `OURA_PAT`.
5. Restart the dev server and open **Settings → Integrations**. It should show today's readiness.

Notes worth knowing:
- **PATs do not expire.** They are revocable, but there is no refresh dance and no OAuth flow. That is why we use one (RESEARCH §3).
- Base URL is `https://api.ouraring.com/v2/usercollection/…` with Bearer auth.
- We pull `daily_readiness`, `daily_sleep`, `sleep` (for `average_hrv`), `daily_activity`, `daily_stress`, `daily_resilience`, `vO2_max`, `daily_cardiovascular_age` and `personal_info`. VO2max and cardiovascular age are free and are the two best longevity markers on the dashboard.
- Rate limit is reported as 5,000 requests per 5 minutes per token — irrelevant for one user.
- There is a sandbox at `/v2/sandbox/usercollection/*` that returns canned data. Tests use it; nothing at runtime depends on it.
- ⚠️ Confirm the actual payload shape of `vO2_max` and `daily_cardiovascular_age` against the sandbox before wiring the dashboard tiles (RESEARCH §10.3).
- ⚠️ Oura's blood-work ingestion is **not** exposed via the API as of the research date. Lab PDFs are a v1.5 parser, not an integration.

---

## 9. Strava — 20 min

This is the longest integration. Split it into three: register the app, connect the account, subscribe to the webhook.

### 9a. Register the developer app — 6 min

1. Go to **strava.com/settings/api**.
2. Create an application. Category and club can be anything; icon is required, any image will do.
3. **Authorization Callback Domain**: `localhost` while developing. Change it to your Vercel domain after Step 13. Strava accepts one domain, so you will come back and edit this.
4. Copy **Client ID** → `STRAVA_CLIENT_ID` and **Client Secret** → `STRAVA_CLIENT_SECRET`.
5. Set `STRAVA_REDIRECT_URI=http://localhost:3000/api/strava/callback` (and the production equivalent later). It must sit under the callback domain you just registered.

### 9b. Connect the account — 4 min

1. Restart the dev server and open **Settings → Integrations → Connect Strava**.
2. The consent screen must request scopes **`read_all`** and **`activity:read_all`**. Without `activity:read_all` you cannot read the heart-rate stream, and without the stream there are no Zone 2 minutes.
3. Approve. The callback stores the refresh token.
4. **Access tokens expire in about 6 hours.** We store the refresh token and rotate on demand; you never touch this again.

### 9c. Subscribe to the webhook — 10 min

This only works against a public HTTPS URL, so do it after the Vercel deploy in Step 13.

1. Invent a verify token and put it in `STRAVA_WEBHOOK_VERIFY_TOKEN`.
2. Create the subscription, pointing the callback at `https://<your-app>/api/strava/webhook`.
3. **The handshake:** Strava immediately sends a `GET` to that callback with a challenge. The route must echo the challenge back **and** confirm the verify token matches. Only then is the subscription created.
4. After that, Strava `POST`s `activity create / update / delete` events. **The route must respond 200 within 2 seconds** — so it acknowledges first and does the fetching and zone maths afterwards.
5. Test it: record a 2-minute walk in the Strava app, stop it, and watch the activity appear in the app's cardio log.

If the webhook dies, the nightly reconcile still catches everything. The webhook is a latency optimization, not a correctness requirement.

### Why we never call `/zones`

`activities/{id}/zones` requires a paid Strava subscription ⚠️. We compute zone minutes ourselves from `activities/{id}/streams` (`time`, `heartrate`, `distance`, `velocity_smooth`) against Seth's HRmax. That keeps the $0 ceiling intact and means our zone boundaries match the ones the engine prescribed against, rather than Strava's. Rate limits are 200 requests / 15 min and 2,000 / day (100 / 1,000 for non-upload reads) — we cache aggressively anyway.

---

## 10. Telegram bot — 10 min

1. In Telegram, open a chat with **@BotFather**.
2. Send `/newbot`. Give it a display name (`Longevity OS`) and a username ending in `bot` (e.g. `seth_longevity_bot`).
3. BotFather replies with the **token**. Copy it to `TELEGRAM_BOT_TOKEN`. Treat it like a password — anyone with it owns the bot.
4. **Find your chat ID:** send any message to your new bot first (a bot cannot message you until you have messaged it), then fetch the update list for your token from the Bot API and read `message.chat.id` out of the result. Put that number in `TELEGRAM_CHAT_ID`.
5. Invent a webhook secret and put it in `TELEGRAM_WEBHOOK_SECRET`.
6. **Register the webhook** to `https://<your-app>/api/telegram`, passing the secret as the webhook secret token. Telegram then sends that secret in the `X-Telegram-Bot-Api-Secret-Token` header on every request, and the route rejects anything that does not match. Without this, anyone who guesses your URL can drive your bot.
7. Test it: message the bot `today`. It should reply with today's session.

What the bot does once it is live: 06:30 daily brief with quick buttons (Start · 20 min instead · Home instead · Skip), post-session summary, Sunday weekly report, weekly scale prompt, weekly injury check-in, and free-form chat routed rules-first then to the LLM.

---

## 11. LM Studio on the Mac mini — 25 min

The mini is the brain's voice. It is **outbound-only**: it reaches out to Supabase, claims jobs, and writes results back. Nothing on the internet can reach it. No tunnel, no port forward, no dynamic DNS. See `docs/decisions/0010-mac-mini-outbound-only.md`.

### 11a. LM Studio server — 8 min

1. Install LM Studio on the mini and open it.
2. Go to the **Developer / Local Server** tab and start the server on **port 1234**. The OpenAI-compatible base URL is `http://localhost:1234/v1` and chat completions are at `http://localhost:1234/v1/chat/completions`.
3. Set it to start automatically, and confirm the port has not drifted — PRD §12 asks Seth to confirm the port and the installed models.
4. Verify from the mini itself:
   ```bash
   curl http://localhost:1234/v1/models
   ```
   You should get JSON listing whatever is loaded.

### 11b. Which models to install — 7 min

Two classes, both local, both free:

- **A text model** for "why" copy, Telegram conversation, intent resolution and the weekly narrative. Instruction-tuned, whatever size the mini runs comfortably. These are short, structured generations — do not reach for the biggest model you can fit; reach for the one that answers in under a couple of seconds.
- **A vision model** for whiteboard photos and scale screenshots — the **Qwen2.5-VL / Llama 3.2 Vision class** named in RESEARCH §8. Output must be strict JSON validated against the workout-log schema; anything ambiguous becomes a bot follow-up question rather than a guess.

Write the exact model identifiers down — the worker names them in its config, and PRD §12 asks Seth to confirm them.

### 11c. The launchd worker — 7 min

The worker lives in `worker/`. It polls Supabase for unclaimed `llm_jobs` every 15 seconds (see `docs/decisions/0002-worker-poll-vs-realtime.md`), calls LM Studio, writes the result back, and pings a keep-alive row so Supabase never idles into a pause.

1. Configure the worker with the Supabase URL, the service-role key, and `LMSTUDIO_BASE_URL=http://localhost:1234/v1`.
2. Install it as a **launchd** agent so it starts at login and restarts if it dies. Give it `KeepAlive` and `RunAtLoad`.
3. Load it, then confirm it is claiming jobs — the app's **Settings → Worker** row should read "alive, last seen <a minute ago>".

### 11d. `caffeinate` — 3 min

A sleeping mini is an offline mini, and every LLM job then costs you a 60-second wait before Gemini takes over.

1. In **System Settings → Displays → Advanced**, prevent automatic sleeping when the display is off (or set Energy Saver to never sleep).
2. Belt and braces: run the worker under `caffeinate`, e.g. wrap the launchd program in `caffeinate -i` so the machine stays awake for as long as the worker is running.
3. Test it: let the mini sit for an hour untouched, then trigger a "why" regeneration from the app and confirm the mini — not Gemini — answered.

### 11e. Verify the outbound-only design — 2 min

This is the one security property of the whole system worth checking by hand.

1. There should be **no** port-forwarding rule on the router for the mini, no ngrok/Cloudflare tunnel running, no LM Studio "serve on network" toggle enabled — bind to loopback only.
2. From outside the house, on cellular, try to reach the mini. You should get nothing.
3. LM Studio's server should be listening on `127.0.0.1:1234`, not `0.0.0.0:1234`. Check with `lsof -i :1234` on the mini.

---

## 12. Gemini free tier as fallback — 5 min

When a job sits unclaimed for more than 60 seconds — mini asleep, updating, or unplugged by a toddler — a Vercel function picks it up and runs the same prompt against Gemini's free tier, expecting the same output schema.

1. Create an API key in **Google AI Studio** and put it in `GEMINI_API_KEY`.
2. The model is from the **`gemini-2.x-flash` family** (RESEARCH §8). Flash, not Pro — the jobs are short and latency matters.
3. ⚠️ **Verify the free-tier RPM and RPD limits today, before you rely on them.** The research foundation flags this explicitly: free-tier quotas change. Check the current limits, and make sure our expected volume — a handful of short jobs a day — sits comfortably inside them. If it does not, the correct move is to lean harder on the mini, not to start paying.
4. Test it: stop the worker on the mini, request a "why" regeneration, wait 60 seconds, and confirm the copy still appears.
5. Test the bottom of the ladder too: remove `GEMINI_API_KEY` and confirm you get the deterministic template copy rather than an error. No LLM must ever block a prescription.

---

## 13. Deploy to Vercel — 15 min

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project**, and import the repo.
3. **Set the Root Directory to `longevity-os`.** This is the step everyone forgets. If the repository root is one level above this folder, Vercel will not find `package.json` and the build fails immediately.
4. Framework preset: Next.js. Leave the build command alone.
5. Add every variable from `.env.local` to **Settings → Environment Variables**. Change `APP_URL` and `STRAVA_REDIRECT_URI` to the production origin.
6. Deploy. Copy the production URL.
7. Go back and update: the **Strava** Authorization Callback Domain (Step 9a), the **Strava webhook** subscription (Step 9c), and the **Telegram** webhook URL (Step 10.6).
8. Re-install the PWA on the phone from the production URL (Step 7).

### Hobby cron limits ⚠️

RESEARCH §8: Vercel Hobby cron is limited to roughly **2 jobs, once per day, with imprecise timing** — a "daily" job fires within a window, not on the minute. Verify the current limits when you configure them.

What this means for the design, and it is a design constraint rather than an annoyance:

- The **nightly Oura sync and Strava reconcile** live on Vercel cron. They are daily and they tolerate drift.
- **Everything more frequent lives elsewhere:** the 15-second `llm_jobs` poll runs on the Mac mini; anything needing tighter scheduling runs on Supabase `pg_cron`.
- The **06:30 Telegram brief** cannot depend on precise Vercel cron timing. Schedule it via Supabase `pg_cron`, which is on the free tier, and treat Vercel cron as the backstop.
- Hobby is **non-commercial only**. This is a personal project; keep it that way.

---

## 14. The chest strap — 5 min

1. Find it. PRD §12 says it is "somewhere".
2. Put in a fresh coin cell — a dead strap looks exactly like a pairing problem.
3. Wet the electrodes, strap it on, and pair it **with the Strava app** on the iPhone.
4. Record 2 minutes and confirm the activity carries a heart-rate stream in Strava.

Any BLE strap works. If it is missing or dead: the Polar H10 (~$90) is the reference-grade option, the Coospo H6 / H808S (~$30–40) are the budget ones, and the Wahoo TICKR and Garmin HRM-Dual are both fine (RESEARCH §5). **That is a purchase — ask before buying.**

Our app never reads live heart rate. Mobile Safari has no Web Bluetooth, so the strap talks to the Strava app during the session and we read the stream afterwards. That is the whole design.

---

## 15. Vertical jump baseline — 10 min

The athletic north star. Do it once, properly, then retest monthly — the app will prompt.

1. **Standing reach:** stand flat-footed against a wall, reach up with the dominant hand, mark the highest point with chalk. Measure from the floor. Write it down — it goes in Settings and the engine uses it for the dunk gap.
2. Chalk the fingertips again.
3. **Max touch:** from a standing start with a countermovement, jump and touch the wall as high as you can. Three attempts, full recovery between.
4. Measure the highest chalk mark from the floor.
5. **Vertical = max touch − standing reach.** Enter both numbers in the app.
6. Optional but useful: a broad jump for horizontal power.

Context: at 6'3" with roughly an 8'3" standing reach, dunking a 10' rim needs about **30–33"** including ball clearance (RESEARCH §6.5). The estimate stands until the reach is actually measured — which is what you just did.

Warm up first. This is a maximal effort, and it comes fresh — never after a leg session.

---

## PRD §12 — Seth's handoff checklist

Live copy. Tick these off as you go.

- [ ] **Oura personal access token** (check existing Claude Code env first) → Step 8
- [ ] **Strava developer app**: client ID/secret, redirect URI → Step 9
- [ ] **Telegram**: new bot via BotFather → token; your chat ID → Step 10
- [ ] **KOT spreadsheets + links** → `docs/programs/kot/raw/` — see the README in that folder
- [ ] **Old-app CSV exports** (Fitbod, Strong, Hevy, others) → `docs/imports/raw/` — see the README in that folder
- [ ] **Wyze scale screenshot** (for parser shape) + current weight
- [ ] **Confirm LM Studio server port and installed models** (text + vision) → Step 11
- [ ] **Find the chest strap**; pair with Strava app → Step 14
- [ ] **Vertical baseline**: chalk, wall, 10 minutes — the app will prompt → Step 15

---

## If something is wrong

Ten most likely failures and their fixes are in [`docs/OPERATIONS.md`](OPERATIONS.md). Credential rotation is in there too.
