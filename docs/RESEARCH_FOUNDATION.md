# Longevity OS Workout System — Research Foundation

Compiled 2026-09-20 in the strategic planning session. Each section gives a **starting point** (use this), **alternatives** (look here if the starting point fails), and **open questions** Claude Code should resolve during tactical planning. Verify anything marked ⚠️ at build time — APIs and free tiers move.

---

## 1. Exercise media (GIFs, images, metadata)

### Starting point
Use two datasets together, joined on normalized exercise name:

1. **`yuhonas/free-exercise-db`** — 800+ exercises, JSON per exercise, **Unlicense (public domain)**. Fields: force, level, mechanic, equipment, primaryMuscles, secondaryMuscles, instructions, static images. This is the *canonical metadata spine* — no licensing risk, clean schema.
   - https://github.com/yuhonas/free-exercise-db
2. **`hasaneyldrm/exercises-dataset`** — 1,324 exercises with animated GIFs + 180×180 thumbnails, media © Gym visual, redistributed with permission and attribution required. Instructions in 10 languages. Includes JSON Schema and SQL import generators.
   - https://github.com/hasaneyldrm/exercises-dataset
   - Keep the `© Gym visual — https://gymvisual.com/` attribution intact in-app (settings → credits).

### Alternatives
- **`mfortini/exercise-library`** — 1,112 GIFs, CDN-ready via GitHub raw URLs. License provenance unclear; likely derived from ExerciseDB. Use only if the Gym visual set has gaps, and treat as personal-use.
- **ExerciseDB / AscendAPI** — 1,500 exercises, open-source tier at 180p; paid one-time tiers for higher resolution. Also on Kaggle. Good fallback for gap-filling.
- **`sergei-argutin/exercise-dataset` (RepDB)** — 250 exercises, 512px WebP, attribution license, quarterly snapshots. Cleaner imagery, smaller set.
- **WorkoutX** — 1,321 GIFs, free tier API.
- **Stronger by Science / ExRx** — not open; do not scrape.

### Open questions
- Expect gaps for KOT-specific movements (tibialis raise, Patrick step, Poliquin step, ATG split squat, backward sled/deadmill, reverse Nordic, QL extension, seated good morning). Plan: static image + written cues for gaps; flag them in a `media_missing` report so Seth can decide whether to record his own clips later.
- Match-rate audit: after joining datasets, report % of the active exercise library with a GIF.
- GIFs are heavy. Convert to WebP/MP4 loops at build time and lazy-load; the swap carousel should render thumbnails first.

---

## 2. Planet Fitness equipment reality

### Findings (multiple sources, 2025–2026)
- **No Olympic barbells, power racks, squat racks, platforms, bumper plates, GHDs, or chalk** at standard clubs. This corrects the assumption that CrossFit gear is "mostly there."
- **Smith machines** at every club (often 2–3). Bar is counterbalanced: **effective bar weight ≈ 15–20 lb, not 45**. Per-location setting required.
- **Dumbbells** typically 5–75 lb (some clubs cap at 60, some Black Card clubs go to 80).
- **Fixed-weight barbells** (straight and EZ) 20–60/70 lb.
- **Cable towers / dual adjustable pulleys / functional trainers.**
- **Full selectorized line** — Life Fitness, Hammer Strength, Cybex, Precor: chest press, shoulder press, lat pulldown, seated row, leg press, leg extension, leg curl, hip abductor/adductor, calf, ab crunch, back extension, assisted dip/pull-up, pec fly/rear delt.
- **Cardio**: treadmills, ellipticals, Arc trainers, stair climbers, upright/recumbent bikes, rowers at many clubs.
- **30-minute express circuit** (10 machines + 10 step stations, traffic-light timer).
- Stretching/abs area, mats, medicine balls, stability balls, hydromassage (Black Card).
- Traditional floor deadlifts not permitted; RDLs with fixed bars/dumbbells/Smith are.
- Equipment varies by franchise — hence per-location checklists.

### Implications for the engine
- "CrossFit at PF" = **barbell-free metcons**: dumbbell thrusters, DB snatches, DB cleans, kettlebell-style swings with a DB, box-less step-ups on benches, rowing/bike/treadmill intervals, burpees, wall balls substituted with med-ball slams (if allowed) or DB push press.
- Backward-sled substitute at PF: **powered-off treadmill backward walking** or backward walking on the floor; at home: backward walking outdoors/hallway.
- Every technical barbell lift needs Same / Easier / Harder alternatives tagged `barbell_free: true`.

### Open questions
- Build the equipment DB with images from manufacturer product pages (Life Fitness, Hammer Strength, Cybex, Precor, Matrix) — check terms; fall back to generic line drawings or Seth's own photos.
- Ship a **"Planet Fitness — standard"** preset checklist Seth clones per location, then edits.

---

## 3. Oura API v2

### Starting point
- **Personal Access Token** is all a single user needs; PATs don't expire (revocable). Create at `https://cloud.ouraring.com/personal-access-tokens`. OAuth only needed for multi-user later.
- Base: `https://api.ouraring.com/v2/usercollection/…`, Bearer auth, `start_date`/`end_date` (YYYY-MM-DD) for daily docs, `start_datetime`/`end_datetime` for time series, `next_token` pagination.
- Endpoints to use:
  - `daily_readiness` — score + contributors (HRV balance, RHR, body temp, recovery index, sleep balance, activity balance)
  - `daily_sleep` — score + contributors
  - `sleep` — detailed periods incl. **HRV (average_hrv)**, RHR, stages, respiratory rate
  - `daily_activity` — score, steps, MET minutes, active calories, training frequency/volume
  - `daily_stress`, `daily_resilience`
  - `vO2_max`, `daily_cardiovascular_age` — **dashboard-grade longevity markers, free**
  - `workout`, `session`, `tag`, `enhanced_tag`
  - `heartrate` — time series (5-min daytime granularity; not workout-grade)
  - `personal_info` — age, weight, height
- Rate limit reported as 5,000 requests / 5 min per token — irrelevant at our scale.
- Sandbox: `/v2/sandbox/usercollection/*` returns canned data — use for tests.
- Webhooks exist (OAuth apps); for v1 a **nightly + on-open pull** is simpler.

### Alternatives
- Community MCP servers (`oura-mcp`, `oura-mcp-unofficial`, `trenerok/oura-mcp-server`) — useful reference implementations for endpoint shapes and token handling; don't depend on them at runtime.

### Open questions
- Seth may already have a PAT from other Claude Code work — check env/keychain first.
- Oura's blood-work ingestion is not exposed via API as of this research ⚠️ — v1.5 parser reads Seth's lab PDFs directly.

---

## 4. Strava API

### Starting point
- Register app at `strava.com/settings/api` (free). OAuth 2.0 authorization-code flow; scopes `read_all`, `activity:read_all`. Tokens expire ~6h; store refresh token and rotate.
- Endpoints: `athlete/activities` (list), `activities/{id}` (detail: distance, moving_time, average_heartrate, max_heartrate, average_speed, sport_type), `activities/{id}/streams` with keys `time, distance, heartrate, velocity_smooth, cadence, altitude` — **heart-rate stream is what computes Zone 2 minutes and VO2 session compliance**, `activities/{id}/laps`.
- `activities/{id}/zones` requires a Strava subscription ⚠️ — compute zones ourselves from the HR stream instead (no dependency).
- **Rate limits**: 200 req / 15 min, 2,000 / day overall; 100 / 1,000 for non-upload reads. Fine for one user; still cache aggressively.
- **Webhooks**: subscribe once; Strava POSTs `activity create/update/delete` events to a callback that must 200 within 2s; validate with a GET challenge. Eliminates polling. Callback can be a Vercel function.

### Implications
- HR zones from **chest strap → Strava app** during the session. Our app never needs live HR (mobile Safari has no Web Bluetooth).
- Prescriptions live in our app; execution in Strava; compliance scoring (did the run hit the prescribed zone/duration) computed from streams.

### Open questions
- Zone boundaries: default to % of HRmax with HRmax = 220 − age (186 at 34) until Strava/Oura data supports a measured max; expose override in settings. Consider Karvonen (HR reserve) using Oura RHR.

---

## 5. Heart-rate strap

**Recommend Polar H10** (~$90): reference-grade accuracy, Bluetooth + ANT+, dual BLE, works with Strava app, Apple Watch, Polar Beat, Zwift, everything. Budget: **Coospo H6 / H808S** (~$30–40), standard BLE Heart Rate Service. Also fine: Wahoo TICKR (~$50), Garmin HRM-Dual.
Seth has a strap "somewhere"; any BLE strap works with the Strava app.

---

## 6. Training science → engine rules

Each rule below is a **rules-engine default**; the LLM layer explains, never overrides.

### 6.1 Weekly dose targets (longevity-optimized)
- **Cardiorespiratory fitness (VO2max)** has the strongest linear dose-response with all-cause mortality: ~12–15% lower risk per 1-MET gain. Moving out of the bottom fitness quintile is the largest single win.
- **Zone 2**: 180–240 min/week across 3–5 sessions is the consensus longevity target (60–70% HRmax, conversational). Start Seth far lower — he's at 0.5–1 mi/week running. Ramp aerobic volume ≤10%/week; make up early Zone 2 minutes on bike/rower/rucking/brisk walking.
- **VO2max work**: 1 session/week of 4×4 min at 85–95% HRmax with 3-min active recovery (Norwegian 4×4; ~7% VO2max gain in 8 weeks in trained subjects). Alternatives: 8×2 min, 30/30s. Work:rest ~1:1.
- **Resistance training**: mortality risk reduction is J-shaped — maximum around **60 min/week** in one meta-analysis, **90–120 min/week** optimal in a 2026 BJSM cohort; benefits diminish above ~140 min/week. Combined with aerobic activity risk reductions reach 45–58%. Engine default: **2–3 strength sessions, 60–120 min/week total**, full-body or upper/lower split.
- Total moderate-vigorous activity: **150–300 min/week** is the optimal zone; excess (>~10× guidelines) carries atrial fibrillation risk in male endurance athletes — irrelevant at Seth's volume but cap the planner anyway.
- **Steps/NEAT**: ~7,000–8,000/day plateau for mortality benefit; use as the recovery-day floor.

### 6.2 Concurrent training (strength + cardio)
- Updated meta-analyses (Schumann 2022, 43 studies): concurrent training **does not compromise hypertrophy or maximal strength**. Interference appears only in **explosive strength / rate of force development**, and only when aerobic and strength work are **in the same session (≤20 min apart)**; separated by ≥3 h the effect disappears.
- Shorter aerobic bouts (30–40 min) interfere less than 50–60+ min. Cycling may interfere less than running for lower-body gains (mixed evidence). HIIT interferes less than long continuous work.
- **Engine rules**:
  - Never program plyometrics/sprints/vertical-jump work *after* Zone 2 or a hard run in the same session; power work goes **first**, or on a separate day.
  - When a day combines strength + cardio, order = power → strength → conditioning → Zone 2 → mobility.
  - Prefer bike/rower Zone 2 within 24 h of a heavy lower-body day; running Zone 2 on upper-body or recovery days.

### 6.3 Load management & injury prevention
- **Regional load ledger**: track 7-day rolling load per region (knees/quads, posterior chain/low back, shoulders, elbows/forearms, calves/Achilles, spine). Hard stimulus to the same region requires ≥48 h; ≥72 h after very heavy or eccentric-dominant (Nordics, depth jumps).
- **Acute:chronic workload ratio** (7-day / 28-day): keep in **0.8–1.3**; >1.5 flags injury-risk spike (Gabbett). Apply to running distance, plyo contacts, and weekly tonnage separately.
- **Plyometric contacts**: 40–60 per session beginners, 80–100 intermediate, never on consecutive days; no depth jumps until double-leg landing mechanics and single-leg squat control are demonstrated.
- **Running**: 10% weekly volume rule; walk-run progression from current baseline; no two hard run days in a row.
- **Nordic hamstring curl**: ~50% reduction in hamstring injury across sports (van Dyk 2019). Program 1–2×/week — Seth's bench supports it.
- **Low back**: McGill Big 3 (curl-up, side plank, bird dog) daily or near-daily as rehab floor; avoid loaded spinal flexion under fatigue early; progress hip hinge (RDL) before any heavy pulling; Jefferson curl only once pain-free and as programmed by KOT with light load.
- **Knees**: KOT progressions (below) are the rehab pathway; monitor pain 0–10 during and 24 h after; a rise of ≥2 points triggers regression to the previous step.
- **Pairing exclusions** (same session): heavy spinal loading + max-effort sprints; Nordics + depth jumps; two max-effort grip movements back-to-back before pulling; overhead pressing right after high-volume dips/push-ups when shoulders are flagged.
- **Agonist/antagonist supersets** (push/pull) are time-efficient and don't impair performance — use them for 15–30 min sessions.

### 6.4 Progression, prediction, goal modes
- **1RM estimation**: Epley `1RM = w × (1 + r/30)`; Brzycki `w × 36/(37 − r)`. Use the average; only trust for r ≤ 10.
- **Prediction bands** per exercise from history: *normal range* (median ± IQR of recent e1RM), *probable* (linear trend + readiness adjustment), *max* (e1RM-derived rep max table). Confidence shrinks with fewer than 3 sessions.
- **Double progression** default: hit top of rep range for all sets two sessions running → +5 lb (upper) / +10 lb (lower) or next DB increment.
- **Readiness modulation**: readiness ≥85 → +1 set or +2.5% load on primary lifts; 70–84 → as planned; 55–69 → −10% load, cap RPE 7; <55 or HRV well below baseline → convert to mobility/Zone 1/recovery.
- **Goal-mode rep/load bands** (per-exercise, readiness-adjusted):
  - Maintain: 2 sets, 6–10 reps, RPE 7
  - Tone (hypertrophy-lean): 3 sets, 10–15 reps, RPE 8, shorter rest
  - Bulk (hypertrophy-strength): 3–4 sets, 6–12 reps, RPE 8–9
  - Six-pack: adds 2–3 dedicated core blocks/week (anti-extension, anti-rotation, hanging knee raises, cable crunches), pairs with body-fat trend from scale; messaging that visible abs are body-fat-driven
  - Extended list (behind a disclosure): Strength (3–5 reps), Power, Endurance, Rehab, VO2 focus, Fat loss
- **Deloads**: fixed-calendar deloads show **no advantage** over continuous training in recent RCTs (Coleman 2024; Pancar 2025 within-subject). Engine uses **autoregulated deloads** triggered by: 7-day readiness average <65, HRV trend down ≥10% vs 28-day, two consecutive sessions missing prescribed reps, or self-reported soreness/energy sliders red for 3 days. Deload = −40% volume, −10–15% load, 5–7 days, mobility/Zone 2 emphasis. Hard cap: force a light week at least every 8–10 weeks if no trigger has fired.

### 6.5 Vertical jump / athleticism
- Baseline test: standing reach + max touch against wall with chalk/tape; also broad jump. Retest monthly. At 6'3" with ~8'3" standing reach (estimate until measured), dunking a 10' rim needs ~30–33" vertical incl. ball clearance.
- Plyo progression: landing mechanics → pogo/ankle hops → box jumps (step down) → hurdle hops → bounds → depth jumps (only after strength base: e.g., trap-bar/DB deadlift ~1.5× BW equivalents or KOT split-squat standards).
- Power complexes: heavy strength move + plyo pairing (post-activation potentiation) 1–2×/week, always fresh, first in session.
- Sprint work: 10–30 m accelerations, full recovery (1 min per 10 m), 6–10 reps, after thorough warm-up; never on the day after heavy lower-body eccentric work.

---

## 7. Knees Over Toes (ATG) — public structure

Seth will supply his spreadsheets/links; this is the public scaffold for ingestion.

- **Core principle — "build from the ground up"**: order within a session is **backward sled / backward walk → lower legs (tibialis, calves) → step-ups → split squat → deep squat**. Upper body strategically included.
- **Zero** (bodyweight, no equipment): 10 min backward walking ("ROKP" — reverse-out-knee-pain), tibialis raises (25 reps standard), FHL/single-leg calf raises, Patrick step, ATG split squat (assisted → flat), elephant walk, couch stretch, L-sit, deep squat holds. 3×/week.
- **Dense**: adds sled (25% BW × 5×5 tib raise standard; backward sled ~50% BW), Poliquin step, Nordic progressions, reverse Nordic, seated good morning, Jefferson curl (slantboard), ATG RDL.
- **Standards** (public list; verify against Seth's sheet): ATG split squat 25% BW per hand; Poliquin step 66% BW × 20 on 3–4" box; ATG squat 25% BW × 20; tib bar curl 25% BW 5×5; ATG RDL 100% BW × 10 or 50% × 20; Nordic full BW × 10; seated good morning 50% BW; Jefferson curl 25% BW × 10 wrists below toes; single-leg calf raise 25% BW × 10; incline DB press 66% BW × 10; external rotation 10% BW; cross-bench pullover 25% BW; QL extension 25% BW × 10.
- **Equipment gaps**: no sled at Home or PF → backward treadmill (off) at PF, backward walking at home/outdoors; slant board → DIY wedge or plates; tib bar → DB between feet or band; Nordics → Seth's bench.
- **Program-slot model**: KOT sessions occupy 2–3 days/week as the current program; the engine fills longevity work around them respecting regional load (KOT is knee/posterior-chain heavy → pair with upper body or Zone 2 bike).

---

## 8. Infrastructure — free tier realities

### Hosting (recommended: hybrid)
- **Vercel Hobby**: free, non-commercial, serverless functions, 100 GB bandwidth. **Cron jobs on Hobby are limited (≈2 jobs, once per day, imprecise timing)** ⚠️ — enough for a nightly sync, not for hourly. Anything more frequent runs on the Mac mini or via Supabase.
- **Supabase Free**: 500 MB Postgres, auth, storage 1 GB, Edge Functions, **pg_cron available**. ⚠️ **Projects pause after ~7 days of inactivity** — daily app use prevents this; add a keep-alive ping from the mini as insurance. Row-level security on from day one even for one user.
- **Cloudflare Pages/Workers** — alternative to Vercel with more generous free cron (Workers cron triggers). Consider if Vercel cron proves too limited.

### Mac mini (LM Studio) integration — **worker-pull pattern**
- Do **not** expose the mini to the internet. Run a small always-on worker on the mini that **polls Supabase** (or subscribes via Realtime) for `llm_jobs`, calls LM Studio's OpenAI-compatible server (`http://localhost:1234/v1/chat/completions`), and writes results back. No inbound ports, no tunnel.
- If a job sits unclaimed >60 s (mini asleep/offline), a Vercel function picks it up with **Gemini free tier** (`gemini-2.x-flash` family; free tier limits change — verify RPM/RPD at build ⚠️). Same prompt, same output schema.
- Vision jobs (whiteboard photo → structured workout): local vision model in LM Studio (e.g., Qwen2.5-VL / Llama 3.2 Vision class) or Gemini Flash vision. Output must be strict JSON validated against the workout-log schema; ambiguous fields become bot follow-up questions.
- Keep the mini from sleeping: `caffeinate` / Energy settings; launchd for the worker.

### Telegram
- BotFather → token → **webhook** to a Vercel function (`/api/telegram`). Bot API supports photos (download via `getFile`), inline keyboards (perfect for sliders-as-buttons and quick replies), and message editing for live clocks if ever wanted.
- Message types: 06:30 daily brief; post-session summary; weekly report (Sunday); scale prompt (weekly); injury check-in (weekly); free-form chat.
- Chat routing: intent classifier (rules first: "swap", "skip", "20 min", "home", pain words) → deterministic action; otherwise LLM with tool schema to call engine functions.

### Wyze scale
- No public API. Wyze syncs to Apple Health/Google Fit only. **v1: bot asks, Seth replies with weight/body-fat or a screenshot (vision-parsed).** v2 option: Health Auto Export (iOS, paid) → webhook.

### Data seeding
- Fitbod, Strong, Hevy export CSV; Ladder/Shred/Gymverse vary. Build a generic importer: columns → (date, exercise, set, reps, weight, unit) with exercise-name fuzzy match to the library and a review screen for unmatched names.

---

## 9. Design references (for Mobbin pulls)
Apps Seth liked: **Fitbod** (equipment picker, swap carousel, predictions), **Ladder**, **Shred**, **Gymverse**, **Ray AI Trainer**, **Edge Fitness**, **Six Pack in 30 Days**, **Home Workout No Equipment**. Pull: onboarding equipment selection, active-set logging screens, exercise swap sheets, weekly plan carousels, progress dashboards. Design brief: beautiful, minimal, modern, dark-mode-first, thumb-reachable controls, numeric keypad inputs, safe-area aware, zero layout shift.

---

## 10. Prioritized open research for Claude Code
1. Join the two exercise datasets; produce media coverage report; list KOT gaps.
2. Verify Vercel Hobby cron limits and Gemini free-tier quotas on the day of build.
3. Confirm Oura `vO2_max` and `daily_cardiovascular_age` payload shapes from sandbox.
4. Prototype the Strava HR-stream → Zone-minutes function against one real activity.
5. Ingest Seth's KOT spreadsheets → `programs/kot/*.json` with step, standard, progression, equipment substitutions.
6. Equipment image sourcing and license check for PF machines.

---

## Correction — 2026-09-21 · Oura Personal Access Tokens are retired

**§3 above is wrong and must not be followed.** It says a Personal Access Token
"is all a single user needs" and that "OAuth [is] only needed for multi-user
later." Oura **retired Personal Access Tokens in December 2025**. The issuing
page at `cloud.ouraring.com/personal-access-tokens` is gone and **no new PAT can
be created**, by anyone, for any number of users. A PAT issued before that date
still works, which is why `OuraClient` still accepts one — but nobody starting
today can obtain one, so OAuth2 is not a later concern, it is the only route in.

Verified on 2026-09-21 against the live OIDC discovery document, not from
documentation or memory:

`https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous/.well-known/openid-configuration`

### What §3 got wrong

| §3 says | Actually |
| --- | --- |
| A PAT is all a single user needs | PATs cannot be issued; OAuth2 authorization code is the only way to get a credential |
| OAuth is a multi-user concern for later | OAuth is required for one user reading their own ring |
| No refresh dance | Refresh tokens rotate and are **single use**; each refresh invalidates the previous one |
| (silent on scopes) | Scopes are namespaced `extapi:*`; the legacy bare names are silently ungranted |

§3 is otherwise still accurate: the data endpoints, parameter families,
`next_token` pagination, the rate limit, the sandbox and the endpoint list are
all unchanged by this. **Only the handshake moved.**

### Verified endpoints

| | |
| --- | --- |
| issuer | `https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous` |
| authorize | `https://moi.ouraring.com/oauth/v2/ext/oauth-authorize` |
| token | `https://moi.ouraring.com/oauth/v2/ext/oauth-token` |
| revoke | `https://moi.ouraring.com/oauth/v2/ext/oauth-revoke` |
| introspect | `https://moi.ouraring.com/oauth/v2/ext/oauth-introspect` |
| auth methods | `client_secret_post`, `client_secret_basic` |
| grant types | `authorization_code`, `refresh_token`, `client_credentials`, `implicit` |
| PKCE | `S256` and `plain` supported; **not** mandatory — we use S256 regardless |

**⚠️ The host matters and Oura's own docs are stale.** Oura's authentication
documentation still shows `cloud.ouraring.com/oauth/authorize` and
`api.ouraring.com/oauth/token`. Applications registered in the post-2025 portal
**do not work against those** — they return `Invalid client` with perfect
credentials, which reads exactly like a bad client ID and sends you looking in
the wrong place. Use `moi.ouraring.com`.

Data endpoints are **unchanged**: `https://api.ouraring.com/v2/usercollection/`
with `Authorization: Bearer`.

### Verified scopes

`scopes_supported` includes: `extapi:personal`, `extapi:daily`,
`extapi:heartrate`, `extapi:session`, `extapi:workout`, `extapi:tag`,
`extapi:stress`, `extapi:heart_health`, `extapi:spo2`, `extapi:biomarkers`,
`extapi:metabolic`, `extapi:research`, `openid`, `profile`, `email`.

**The legacy bare names (`daily`, `heartrate`, `session`) are silently
ungranted** — the authorize call succeeds, a token comes back, and every request
then reads nothing. There is **no `offline_access` scope**; refresh tokens are
issued because the `refresh_token` grant type is supported.

Longevity OS requests exactly: `extapi:personal extapi:daily extapi:heartrate
extapi:session extapi:workout extapi:stress extapi:heart_health`.

### The failure mode to design against

**Refresh tokens rotate and are single use.** Every successful refresh
invalidates the token presented. The consequences are handled in
`packages/integrations/src/oura/tokens.ts`: refresh only within a 120-second
skew of expiry, persist the new pair **before** handing the access token to any
caller, hold a single-flight lock so two callers cannot spend the same token,
and treat `invalid_grant` as its own error kind (`needs_reauth`) that is never
retried — retrying burns another token and only a browser re-authorisation
fixes it.

### Source of truth

The discovery document is live and authoritative; this table is a snapshot of
it. `discoverEndpoints()` in `packages/integrations/src/oura/oauth.ts` reads it
on demand, so if Oura moves the endpoints again the recovery is a diagnostic
run, not a code archaeology exercise. **Trust the discovery document over this
file, over §3, and over Oura's own written documentation.**

Implementation: `packages/integrations/src/oura/{oauth,tokens,client}.ts`,
`scripts/oura-auth.ts`, `apps/web/src/app/api/oura/{connect,callback,sync}/`,
`supabase/migrations/0008_oura_oauth.sql`. Walkthrough: `docs/SETUP.md` step 8.
