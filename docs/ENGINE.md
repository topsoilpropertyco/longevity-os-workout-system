# Longevity OS — The Rules Engine

How the app decides. Written for a human, not a compiler.

The engine is **pure and deterministic**. It takes one `PlanInput` object and returns one `PlanResult`. It reads no database, calls no network, looks at no clock, and consults no language model. The same inputs produce the same plan every time — there is a `seed` field for anything that would otherwise be arbitrary, and a `signature` hash on the output so two plans can be diffed byte for byte.

**The LLM never writes a prescription.** It writes the sentence underneath one. If every model in the stack is unreachable, the prescription is identical and the sentence comes from a template. That is the whole arrangement, and it is invariant 1.

---

## 1. What goes in

`PlanInput` (`packages/engine/src/types.ts`) carries everything, because the engine cannot go and fetch anything:

| Input | What it is for |
| --- | --- |
| `today` | The date being planned. Local timezone, `YYYY-MM-DD`. |
| `athlete` | Age, height, bodyweight, HRmax and its source, resting HR, standing reach. |
| `goals` | Goal mode, vertical-jump focus, warm-up/cooldown minutes and whether they sit on top of the budget. |
| `budget_min` | Minutes available today: 15 / 20 / 30 / 45 / 60 / 90 from the UI, any positive integer from the engine's point of view. |
| `location` + `all_locations` | Equipment, bar weights, travel overhead. The second list lets the engine offer "Home instead". |
| `oura_today`, `oura_history` | Readiness, sleep, HRV, RHR, activity, VO2max, cardiovascular age. 28 days for the baseline. |
| `self_report`, `recent_self_reports` | Soreness, energy, stress — 1–5. The fallback when Oura is absent, and a signal in their own right. |
| `history`, `cardio_history` | 28+ days of sessions, sets and cardio. Feeds the ledger, ACWR, progression and prediction. |
| `injuries` | Region, pain 0–10, aggravators. Knees and low back are seeded. |
| `body_metrics` | Bodyweight for %BW standards and bodyweight-movement load. |
| `program`, `program_progress` | The active program (KOT), its ordering rule, its steps and what has been met. |
| `exercises` | The library, already joined with media. |
| `forced_session_type` | Set when Seth pulls a future day forward from the week carousel. |

---

## 2. The pipeline, in order

Each stage consumes the one before it. Nothing loops back.

**1. Normalize.** Sort histories, resolve bodyweight to the most recent metric, resolve HRmax by the precedence chain (ADR 0004), compute zone boundaries, filter the exercise library to what this location can actually do.

**2. Assess readiness.** Produce a `ReadinessAssessment`: band, 0–100 score, source, load multiplier, RPE cap, set delta, HRV-versus-baseline, and the reasons — plain strings that become the why line.

**3. Build the ledger.** For each of the twelve regions, roll up 7-day and 28-day load, compute ACWR, compute hours since the last hard hit and since the last eccentric-dominant hit, and mark the region available or blocked with a reason.

**4. Check the deload state.** Evaluate the autoregulation triggers and the 8–10 week hard cap. If a deload is in force, volume and load multipliers apply from here on.

**5. Measure the weekly dose.** Zone 2 minutes against target and against the ≤10%/week ramp ceiling, VO2 sessions, strength minutes against the 60–120 band, mobility sessions, plyo contacts, tonnage, session count. This produces the week's deficits, and deficits are what drive the choice of day.

**6. Choose the day type.** Reconcile the biggest deficit with the readiness band, the available regions and the program's claim on 2–3 days a week. Honour `forced_session_type` if the carousel set one. KOT, when it is due and the knees are available, wins.

**7. Place the program slot.** If today is a program day, the program's steps come first, in the program's own order. KOT is strictly ground-up: backward walk → lower legs → step-ups → split squat → deep squat.

**8. Select exercises.** Fill the remaining slots in assembly priority order: power → strength → conditioning → Zone 2 → mobility. Every candidate must pass the equipment filter, the ledger, the injury register and the pairing exclusions. Barbell lifts at a barbell-free location are replaced by their `barbell_free` alternatives before selection, not after.

**9. Prescribe sets, reps and load.** Goal-mode bands set sets and reps; history and double progression set the load; the readiness multiplier and any deload multiplier adjust it; the result is rounded to an increment the location can actually make (Bowflex 2.5 lb, a dumbbell rack 5 lb, a Smith bar plus plates over its effective bar weight).

**10. Compute prediction bands.** Normal / probable / max per exercise, with a confidence that shrinks below three sessions of history.

**11. Assemble within the budget.** Estimate each block's minutes including rest, fit them into the budget, and cut from the bottom of the priority order. Warm-up and cooldown sit on top of the budget or inside it depending on the setting.

**12. Write the whys and the notes.** Every exercise gets a one-line reason, the session gets one, and everything the engine chose *not* to do is recorded in `notes` for the audit view.

**13. Project the week.** Repeat stages 5–12 for the next six days under assumed-neutral readiness, so the carousel shows a real plan rather than a placeholder — while being honest that the projection will be re-solved when each day actually arrives.

---

## 3. The weekly template, and the evidence for it

Defaults, editable. Every one of them traces to a section of the research foundation.

| Slot | Default | Evidence |
| --- | --- | --- |
| **Strength** | 2–3 sessions, **60–120 min/week total** | RESEARCH §6.1. Mortality risk reduction is J-shaped: maximum around 60 min/week in one meta-analysis, 90–120 min/week optimal in a 2026 BJSM cohort, benefits diminishing above ~140 min/week. So the ceiling is a feature — more is not better here. |
| **KOT (program slot)** | 2–3 sessions, placed **first** in the session | RESEARCH §7. Knees Over Toes is the current program and the knee-rehab pathway; its internal order is ground-up and non-negotiable. §6.3 makes it the rehab route for the seeded knee injury. |
| **VO2 work** | 1 session/week, **4×4 min at 85–95% HRmax**, 3-min active recovery | RESEARCH §6.1. Norwegian 4×4, ~7% VO2max gain in 8 weeks in trained subjects. Alternatives 8×2 min or 30/30s, work:rest ~1:1. VO2max has the strongest linear dose-response with all-cause mortality of anything we can train — ~12–15% lower risk per 1-MET gain. |
| **Zone 2** | accumulating toward **150–240 min/week**, ramping **≤10%/week from baseline** | RESEARCH §6.1. 180–240 min/week across 3–5 sessions is the consensus longevity target at 60–70% HRmax, conversational. Seth starts at 0.5–1 mi/week of running, so the ramp ceiling matters far more than the target for the first few months; early minutes are made up on bike, rower, rucking and brisk walking. |
| **Power / plyo** | 1–2 blocks/week, **always fresh, first in session** | RESEARCH §6.2 and §6.5. Concurrent-training interference shows up in explosive strength and rate of force development specifically, and only when aerobic work shares the session. Power complexes (heavy lift + plyo, post-activation potentiation) go 1–2×/week, always first. |
| **Yoga / mobility** | ≥2 sessions/week | RESEARCH §6.3. Also the landing place for recovery days, and where the McGill Big 3 low-back floor lives. |
| **NEAT floor** | daily, **~7,000–8,000 steps** | RESEARCH §6.1. Step-count mortality benefit plateaus around there; it is the recovery-day floor rather than a target to beat. |
| **Total MVPA** | **150–300 min/week**, planner capped | RESEARCH §6.1. The optimal zone. Excess beyond ~10× guidelines carries atrial-fibrillation risk in male endurance athletes — irrelevant at Seth's volume, but the planner is capped anyway. |
| **Nordic hamstring curl** | 1–2×/week | RESEARCH §6.3. ~50% reduction in hamstring injury across sports (van Dyk 2019). The home bench supports it, so there is no excuse. |

Two ordering rules fall out of §6.2 and are enforced, not suggested:

- **Never program plyometrics, sprints or vertical-jump work after Zone 2 or a hard run in the same session.** Power goes first, or on a different day.
- **When a day combines strength and cardio, the order is power → strength → conditioning → Zone 2 → mobility.** Separated by ≥3 h the interference disappears entirely; shorter aerobic bouts (30–40 min) interfere less than 50–60+; bike Zone 2 is preferred within 24 h of a heavy lower-body day, running Zone 2 on upper-body or recovery days.

---

## 4. Readiness bands

One number in, four behaviours out (PRD §8.1, RESEARCH §6.4).

| Band | Trigger | What changes |
| --- | --- | --- |
| **push** | readiness ≥ 85 | +1 set on primary lifts, or +2.5% load. `load_multiplier` 1.025, `set_delta` +1. |
| **as_planned** | 70–84 | Nothing. `load_multiplier` 1.0. |
| **reduced** | 55–69 | −10% load, RPE capped at 7. `load_multiplier` 0.9, `rpe_cap` 7. |
| **recovery** | < 55, **or** HRV ≥10% below the 28-day baseline | The session type changes: mobility, a Zone 1 walk, breathwork. Not a lighter version of the planned session — a different session. |

Notes that matter:

- **HRV overrides the score.** A readiness of 78 with HRV 12% below baseline is a recovery day. The band is the worse of the two paths.
- **No Oura means sliders, not nothing.** Soreness, energy and stress (1–5 each, stress inverted) map onto the same 0–100 scale and the same four bands. `ReadinessAssessment.source` records which path was taken, so the why line can be honest: "planning from your sliders — no Oura data this morning."
- **No sliders either** means `source: 'default'`, band `as_planned`, multiplier 1.0. The day is planned unmodulated rather than blocked.
- Readiness modulates **load and volume**. It does not modulate the ledger. A fresh-feeling day does not unlock a region that was hit hard 20 hours ago.

---

## 5. The regional load ledger and ACWR

Twelve regions: knees/quads, posterior chain, low back, shoulders, elbows/forearms, calves/Achilles, spine, chest, upper back, core, hips/glutes, neck. Coarse on purpose — these are the units at which "this needs 48 hours" is a meaningful sentence.

Every exercise carries a `region_loads` map, 0–1 per region, saying how hard one working set taxes it. Each logged set contributes `load × region weight` to every region it touches, and the ledger rolls those up.

**Per region, the ledger holds:** 7-day load, 28-day load, ACWR, hours since the last hard hit, hours since the last eccentric-dominant hit, an availability flag and a block reason.

**The rules (RESEARCH §6.3), all hard constraints:**

- **≥48 hours** between hard stimuli to the same region.
- **≥72 hours** after eccentric-dominant work — Nordics, depth jumps, slow negatives. The `eccentric_dominant` flag on the exercise is what triggers the longer clock.
- **ACWR (7-day ÷ 28-day-average) stays in 0.8–1.3.** Above 1.5 flags an injury-risk spike (Gabbett). It is computed **separately** for running distance, plyometric contacts and tonnage — a big lifting week must not license a big running week.
- **Plyometric contacts:** 40–60 per session for beginners, 80–100 intermediate, never on consecutive days. No depth jumps until double-leg landing mechanics and single-leg squat control are demonstrated.
- **Running:** 10% weekly volume rule, walk-run progression from the current baseline, never two hard run days in a row.
- **Pain response:** a rise of ≥2 points in an injured region's pain within 24 hours regresses that program step by one.

**These are constraints, not scores** — invariant 5. A blocked region cannot be outvoted by a large weekly deficit or a high readiness score. If the engine cannot fill a slot without violating one, it leaves the slot empty, records why in `warnings`, and says so on the card. An assembled session that violates the ledger is a bug with a failing test, not a judgement call.

---

## 6. Pairing exclusions

Combinations that must not share a session (RESEARCH §6.3):

- heavy spinal loading **+** max-effort sprints
- Nordics **+** depth jumps
- two max-effort grip movements back-to-back before pulling
- overhead pressing right after high-volume dips or push-ups, **when shoulders are flagged**

Exercises can also declare `contraindicated_with` individually, which the engine treats identically. Exclusions are checked at selection time, and again as an assertion after assembly — the second check is cheap and catches the class of bug where a swap introduces a conflict the original selection did not have.

The positive counterpart: **agonist/antagonist supersets** (push/pull) are time-efficient and do not impair performance, so the engine reaches for them whenever the budget is 15–30 minutes.

---

## 7. Progression and prediction

**Estimated 1RM** (RESEARCH §6.4) is the average of Epley `w × (1 + r/30)` and Brzycki `w × 36/(37 − r)`, trusted only for r ≤ 10. Above ten reps the formulas diverge and the engine stops pretending.

**Double progression** is the default: hit the top of the rep range for all sets in two consecutive sessions → add 5 lb upper / 10 lb lower, or the next dumbbell increment. At home that means the next Bowflex step; the engine never prescribes a load the location cannot physically produce.

**Prediction bands** (`PredictionBand`) are what Seth sees on the card:

- **normal** — median ± IQR of recent e1RM, mapped to today's prescribed rep count. "This is your ordinary day."
- **probable** — the linear trend, adjusted by today's readiness multiplier. "This is what you should hit today."
- **max** — derived from e1RM through a rep-max table. "This is the honest ceiling, not a dare."
- **confidence** — 0–1, shrinking below three sessions of history. With no history the basis is `program_standard` (KOT's %BW standards) or `cold_start`, and the card says so rather than inventing precision.

**Goal-mode bands** (RESEARCH §6.4), readiness-adjusted:

| Mode | Sets | Reps | RPE |
| --- | --- | --- | --- |
| Maintain | 2 | 6–10 | 7 |
| Tone (hypertrophy-lean) | 3 | 10–15 | 8, shorter rest |
| Bulk (hypertrophy-strength) | 3–4 | 6–12 | 8–9 |
| Six-pack | as Tone, **plus 2–3 dedicated core blocks/week** — anti-extension, anti-rotation, hanging knee raises, cable crunches — paired with the body-fat trend | 8 |

Behind a disclosure: Strength (3–5 reps), Power, Endurance, Rehab, VO2 focus, Fat loss. Six-pack mode also carries an honest message: visible abs are body-fat-driven, and the scale trend is the real instrument.

---

## 8. Autoregulated deloads

Fixed-calendar deloads show **no advantage** over continuous training in recent RCTs (Coleman 2024; Pancar 2025 within-subject). So the engine does not schedule them. It watches for them.

**Triggers — any one fires a deload:**

1. 7-day average readiness below **65**
2. HRV trend down **≥10%** versus the 28-day baseline
3. **Two consecutive sessions** missing prescribed reps
4. Soreness or energy sliders red for **3 days**

**The deload:** −40% volume, −10–15% load, 5–7 days, mobility and Zone 2 emphasis.

**The hard cap:** if no trigger has fired in **8–10 weeks**, a light week is forced anyway. `DeloadState.weeks_since_last` is what counts, and the fired triggers are recorded in `triggers` so the why line can name the actual reason: "backing off for a few days — your HRV has been 11% down for a week and you missed reps on Monday."

---

## 9. Session assembly within a time budget

The budget is real. 30 minutes means 30 minutes, including rest, including setup, minus the location's travel overhead if any.

1. **Reserve** warm-up and cooldown. They sit on top of the budget or inside it depending on `warmup_outside_budget`.
2. **Estimate** every candidate block in minutes: working sets × (time under tension + rest), plus transition time, plus the program block's own estimate.
3. **Fill in priority order:** power → strength → program → conditioning → Zone 2 → mobility, with the program block hoisted to the front on program days and KOT internally ordered ground-up.
4. **Cut from the bottom.** When the budget runs out, the lowest-priority remaining block is dropped, and the drop is recorded in `notes` — so the audit view can say "no Zone 2 today, 30 minutes did not reach it".
5. **Compress rather than drop, where it is honest.** Under 30 minutes the engine pairs agonist/antagonist supersets and shortens rest inside what the goal mode allows. It does not compress rest on power or maximal-strength work, because that changes what the set is.
6. **Never overflow.** A session that estimates longer than the budget is a bug. Overruns are the reason people stop showing up.

---

## 10. Worked example: Tuesday, 30 minutes, home, readiness 72

Inputs: `today` = Tuesday. `budget_min` = 30. `location` = Home — Bowflex adjustable dumbbells to 52.5 lb, adjustable flat/incline bench with Nordic support, pull-up bar, resistance bands. No barbell, no rack, no sled, no cable. Oura readiness 72, HRV 3% above the 28-day baseline. Goal mode Tone, vertical-jump focus on. Program KOT, cycle 1. Injuries: knees (pain 3), low back (pain 2). History: Sunday was a 45-minute lower-body KOT day; Monday was a 25-minute Zone 2 bike.

**Stage 1 — Normalize.** Bodyweight 205 lb from Friday's scale entry. HRmax by precedence: no measured Strava max in the last 90 days, no Oura figure, so 220 − 34 = **186**, source `formula`, and the zone boundaries follow. The exercise library is filtered to home equipment: 640-odd candidates become 180-odd.

**Stage 2 — Readiness.** 72 → band **as_planned**, `load_multiplier` 1.0, no RPE cap, `set_delta` 0, `source: 'oura'`, HRV +3%. Reasons: "readiness 72, in the planned band"; "HRV 3% above your 28-day baseline".

**Stage 3 — Ledger.**

| Region | Hours since hard hit | ACWR | Available |
| --- | --- | --- | --- |
| knees_quads | 38 (Sunday KOT) | 1.12 | **No** — inside the 48-hour window |
| posterior_chain | 38 | 1.08 | **No** — Sunday's ATG split squats and RDL |
| calves_achilles | 38 | 1.15 | **No** |
| low_back | 96 | 0.94 | Yes |
| chest | 121 | 0.81 | Yes |
| upper_back | 121 | 0.86 | Yes |
| shoulders | 121 | 0.88 | Yes |
| core | 18 (Monday, light) | 1.02 | Yes |

Nothing is eccentric-blocked: Sunday's split squats were not eccentric-dominant, so the 72-hour clock is not running. Every ACWR sits inside 0.8–1.3.

**Stage 4 — Deload.** 7-day average readiness 74 (>65). HRV up, not down. No missed reps Sunday. Sliders not red. Six weeks since the last light week — inside the 8–10 cap. **No deload.**

**Stage 5 — Weekly dose.** Zone 2 at 25 of 90 minutes this week (the ramp ceiling, not the 150+ target — he is still climbing). VO2 sessions 0 of 1. Strength at 45 of 60–120 minutes. Mobility 1 of 2. Tonnage tracking flat. **Biggest deficit: upper-body strength minutes.**

**Stage 6 — Day type.** KOT is due twice more this week, but the knees and posterior chain are blocked until Wednesday morning — so KOT is not today, and the engine notes that it will be tomorrow. VO2 work is deficient but VO2 on a 30-minute home day with no equipment beyond a bench is a worse use of the slot than the strength deficit, and it would collide with tomorrow's KOT. **Today is `strength`, upper-focused**, which is exactly what the ledger leaves available.

**Stage 7 — Program slot.** None today. Recorded in `notes`: "KOT moved to Wednesday — knees 38 h since Sunday, needs 48."

**Stage 8 — Selection.** Budget 30 minutes, warm-up 5 on top (Seth's setting), so 30 minutes of work. Vertical-jump focus wants a power block, but power is lower-body and lower-body is blocked, so it is skipped with a note. What is left is horizontal push, vertical pull, horizontal pull and core, at home:

- **A1** Incline dumbbell press — chest and shoulders, both available, Bowflex and the adjustable bench
- **A2** Pull-up — vertical pull, upper back, the bar; superset with A1 (agonist/antagonist, and the budget is 30 minutes)
- **B1** Single-arm dumbbell row — horizontal pull, upper back, bench support
- **B2** Band pull-apart — rear delts, cheap in time, keeps shoulders balanced
- **C** Bird dog and side plank — the McGill Big 3 low-back floor, and low back is available at pain 2

Exclusions checked: no heavy spinal loading, no sprints, no Nordics, no depth jumps, no back-to-back maximal grip before pulling — the row comes after the pull-up, which is the right order for grip. Clean.

**Stage 9 — Prescription.** Tone mode: 3 sets, 10–15 reps, RPE 8, shorter rest.

- Incline DB press: last Thursday, 3×12 at 85 lb total (42.5 per hand) at RPE 8. Top of range not reached twice, so no double-progression bump. Readiness multiplier 1.0. **3 × 12 at 85 lb total**, rest 75 s. Rounded to the Bowflex's 2.5 lb-per-hand increment — 85 lb total is achievable, 88 lb would not be.
- Pull-up: bodyweight, `load_style: 'bodyweight'`, added load 0. **3 × 8**, rest shared with the press superset.
- Single-arm row: **3 × 12 at 50 lb** per hand, single implement, rest 60 s.
- Band pull-apart: **2 × 20**, no load concept.
- Bird dog **2 × 8/side**, side plank **2 × 30 s/side**.

**Stage 10 — Prediction bands** on the press: normal [80, 90], probable **85**, max 100, confidence 0.8 on nine sessions of history, basis `history`. The card shows 85 in the middle with the band around it, so a good day and a bad day both look normal instead of like failure.

**Stage 11 — Budget.** Superset A ≈ 11 min, B ≈ 9 min, C ≈ 6 min, transitions ≈ 3 min. **Total 29 of 30.** Nothing is cut. Zone 2 did not fit and is recorded in `notes` — with the observation that tomorrow's KOT day pairs well with a bike Zone 2 block, which is exactly the §6.2 rule about cycling within 24 h of heavy lower-body work.

**Stage 12 — Why.** Session: *"Upper body today — your knees need one more day after Sunday's KOT, and upper strength is where this week is short."* Per exercise, one line each; the incline press reads *"Top of your range twice and you earn the next 5 lb — you are one session away."*

**Stage 13 — Week.** Wednesday projects as KOT (knees free at 48 hours), Thursday as VO2 4×4 (the standing weekly deficit), Friday as Zone 2 plus mobility, Saturday as full-body strength, Sunday as KOT, Monday as recovery. Every one of those will be re-solved when the day arrives, and the carousel says so.

**Output.** One `PrescribedSession`, three blocks, `estimated_min` 29, `readiness.band` `as_planned`, `deload` false, two notes, no warnings, and a signature. Feed the same input in tomorrow and you get the same bytes back.

---

## 11. Testing

Because the engine is pure, testing it is just a table of inputs and expected outputs.

- **Fixture days** in `packages/engine/fixtures/`: high readiness, low readiness, injury flare, 15-minute home, 90-minute Planet Fitness. PRD §9 requires these five.
- **Golden-file tests** on session assembly: the whole `PlanResult` is serialized and compared, so an unintended change anywhere shows up as a diff rather than as a surprise in March.
- **Invariant assertions** that run against every fixture: no session violates the ledger; no session violates a pairing exclusion; no session exceeds its budget; no session prescribes equipment the location does not have; no barbell movement survives at a barbell-free location.
- **Every engine change ships with a fixture or a test.** That is in `CLAUDE.md` and in `CONTRIBUTING.md`, and it is the reason the ledger stays a constraint rather than drifting into a suggestion.
