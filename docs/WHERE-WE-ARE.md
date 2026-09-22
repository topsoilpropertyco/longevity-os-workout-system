# Longevity OS — where we are

**Last updated:** 21 September 2026, overnight.

This file exists so the next session can be picked up cold. It is the state of
the system, the exact commands still outstanding, and the questions only Seth
can answer. `docs/SETUP.md` is the full walkthrough; this is the short version
of what is already true and what is next.

---

## Working right now

| | |
| --- | --- |
| **Supabase** | Project live. Schema applied — 13 migrations, 31 tables, RLS on every one. |
| **The program** | Knees Over Toes, rebuilt from Seth's own April 2026 checklist and spreadsheets: 3 phases, 69 steps, 12 weekday templates, 12 benchmarks. Seeded into the database. |
| **The engine** | 382 tests. Phase-aware: it gates steps to the phase, drives the session from that weekday's template, and enforces the phase's load rule. |
| **The app** | Deployed on Vercel, installable on the iPhone home screen, magic-link sign-in working. |
| **Oura** | Connected on the Mac mini with all seven scopes. **Not yet reachable from the deployed app** — see below. |
| **CI** | Green. Every push runs contracts, typecheck, 418 tests, data validation, and the migrations against a real Postgres 16 in both transaction modes. |

Seth's athlete id is in `.env.local` as `LONGEVITY_USER_ID`. Every script that
needs it reads it from there; none of them need it typed again.

---

## ⚠️ Blocked on one thing, and it is not code

`SUPABASE_SERVICE_ROLE_KEY` in `.env.local` on the Mac mini is **447
characters**. A real service-role JWT is around 220 — the hidden paste that
wrote it landed twice, or picked up strays. A malformed header value makes
undici refuse to send the request at all, which surfaces as
`TypeError: fetch failed` and nothing more useful.

This is why the seed has never completed and why the Oura token push fails.
Nothing is wrong with the code; both scripts stop before writing and leave
the local token file untouched, which is what they are built to do.

**The fix, next time Seth is at the Mac.** Copy the key with Supabase's copy
BUTTON — dragging across the revealed text is how strays get in — then, in
`~/Desktop/longevity-os-workout-system`:

```bash
grep -v '^SUPABASE_SERVICE_ROLE_KEY=' .env.local > .env.tmp && mv .env.tmp .env.local \
  && printf 'SUPABASE_SERVICE_ROLE_KEY=' >> .env.local && read -rs key \
  && printf '%s\n' "$key" >> .env.local && unset key \
  && awk -F= '{print $1, "len=" length($0)-length($1)-1}' .env.local
```

It waits silently; paste once, press Return. Every other value is already
correct — `OURA_TOKEN_KEY len=64` and `LONGEVITY_USER_ID len=36` both check
out. Then `npm run seed`, then `npx tsx scripts/oura-push-tokens.ts`.

Worth doing at the same time: `npm install -g @anthropic-ai/claude-code`,
then run `claude` inside that folder. A local session can run these itself
instead of trading screenshots.

---

## Outstanding — in order

### 1. Seed the exercise library (may already be done)

```bash
npm run seed            # reference data: 1,938 exercises + media
npm run seed -- --user "$LONGEVITY_USER_ID"   # …plus locations and KOT enrolment
```

Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Writes
only rows with `user_id is null` unless `--user` is passed, and is safe to
re-run. Confirm it landed:

```sql
select count(*) from exercises;                 -- 1938
select count(*) from locations;                 -- 3
select phase_id, week_in_phase from program_progress;  -- zero, 1
```

### 2. Move the Oura connection into Supabase

The tokens are in `.oura-tokens.enc` in the **old** repo directory. The
deployed app cannot read a file on a laptop; it reads `integration_tokens`.

```bash
find ~ -name ".oura-tokens.enc" -not -path "*/node_modules/*"
# copy that file, plus the OURA_CLIENT_ID / OURA_CLIENT_SECRET / OURA_TOKEN_KEY
# lines from the old .env.local, into this repo
npx tsx scripts/oura-push-tokens.ts --dry-run
npx tsx scripts/oura-push-tokens.ts
```

It is a MOVE. Oura's refresh tokens are single use, so two copies racing each
other would kill the connection; the local file is renamed aside once Supabase
holds a set the script has read back and verified.

### 3. Four more variables in Vercel

`LONGEVITY_USER_ID`, `OURA_CLIENT_ID` as **Config**; `OURA_CLIENT_SECRET` and
`OURA_TOKEN_KEY` as **Secret**. `OURA_TOKEN_KEY` must be byte-identical to the
one in `.env.local` or the deployment cannot decrypt what step 2 wrote. Then
redeploy — environment variables only take effect on a new build.

### 4. Backfill Oura

The today card reads `oura_daily`, not the Oura API, which is what keeps it
instant. One sync fills the last 28 days. `/api/oura/sync` is guarded by
`CRON_SECRET`; set one in Vercel and call it once, or run the sync locally.

### 5. Then it is done

Real readiness from the ring, real locations, and Monday's session out of
Seth's own checklist: Phase 1 Zero, week 1, Mon/Wed/Fri, bodyweight.

---

## Not required, worth having

- **Telegram** — 06:30 brief, post-session summary, Sunday report. Needs a bot
  token. `docs/SETUP.md` §10.
- **Strava** — runs and rucks land automatically instead of being typed.
- **LM Studio on the Mac mini** — local model answering "why this session?",
  with Gemini's free tier as the fallback. The worker is written and polls
  outbound only; nothing to open on the router.

---

## Open questions for Seth

Recorded so they are not lost. None of them block anything.

1. **Backward walking and the sled appear nowhere in his material.** They were
   inventions of the earlier public-scaffold version of the program and have
   been removed. His warm-up is a plain forward walk. Does he actually do them?
2. **"25 DB" on the Full Body split squat** — 25 lb per hand (50 total) or 25
   total? Stored as the lighter reading; one logged session self-corrects it.
3. **Neck Brace Exercises carries no sets, reps or duration** in any source —
   the only step of the 69 with no numbers.
4. **The Hip Flexor Tri-Set contradicts itself**: the checklist says alternate
   all three to failure for five minutes, the spreadsheet says pick one.

---

## Known gaps, in falling order of cost

1. **`seated-calf-raise` and `seated-good-morning` are unreachable at Home.**
   Equipment matching has no aliasing: the steps ask for `bench_flat` and
   `dumbbell`; Home has `bench_adjustable` and `adjustable_dumbbell`. Two
   authored steps silently vanish from Dense. They now at least emit a note
   saying so rather than disappearing in silence.
2. **A static-hold movement with a rep standard loses its reps.** Zero's
   elephant walk says 25 reps but is a static mobility movement, so it falls
   through to the 30-second default hold.
3. **`ProgramStandard.distance_mi` is ignored.** Standards' quarter-mile walk
   is prescribed as "10 reps".
4. **Warm-up and cool-down prescribe nothing.** They reserve minutes and carry
   a focus line ("knees quads, hips glutes"); `scripts/today.ts` still renders
   its own placeholder instead of that line.
5. **`/api/oura/connect` is reachable without a session.** All of `/api/` is
   outside the auth middleware, correctly, because webhooks send no cookies —
   but this route starts an OAuth flow whose callback binds to
   `LONGEVITY_USER_ID`. A stranger would have to authorise with their own ring,
   and the effect would be writing their token into Seth's row.
6. **`0002_rls.sql` cannot run on a bare Postgres**, despite its header saying
   it can: it guards the `authenticated` role but not the `auth` schema. Only
   affects psql smoke tests, never Supabase.
7. **`supabase/README.md`'s migration table stops at 0005.** There are 13.

---

## The one rule

From `CLAUDE.md`: **Seth should never have to think.** Every choice above is
downstream of that. If a step here needs him to hold something in his head,
it is a step that has not been finished yet.
