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

**6. Choose the day type.** Reconcile the biggest deficit with the readiness band, the available regions and the program's claim on the week. On a phased program that claim is a list of weekdays (§8), not a session count. Honour `forced_session_type` if the carousel set one. KOT, when the phase's calendar says so and the knees are available, wins.

**7. Place the program slot.** If today is a program day, the program's steps come first. On a phased program the active phase's template for today's weekday supplies both the steps and their order (§8); otherwise the program's own ordering rule does, and KOT's is strictly ground-up: backward walk → lower legs → step-ups → split squat → deep squat.

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
| **KOT (program slot)** | 2–3 sessions, placed **first** in the session — or, on a phased program, exactly the weekdays the active phase trains (§8) | RESEARCH §7. Knees Over Toes is the current program and the knee-rehab pathway; its internal order is ground-up and non-negotiable. §6.3 makes it the rehab route for the seeded knee injury. |
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

## 8. Phased programs

Knees Over Toes is not one program. It is three, run in sequence, and they have
almost nothing in common with each other:

| Phase | Length | Days | Session | Load |
| --- | --- | --- | --- | --- |
| **Zero** | 12 weeks | Mon, Wed, Fri | 10–20 min | Bodyweight. None. Anywhere. |
| **Dense** | 12 weeks | Mon–Fri | 30–45 min | Ramps as a percentage of bodyweight, week over week. |
| **Standards** | open-ended | Mon, Tue, Thu, Fri | 45–60 min | Whatever reaches the twelve benchmarks. |

The 69 steps in `programs/kot/program.json` each carry the phase they belong to,
and each training weekday of each phase carries a session template. Without the
machinery below, all 69 are in play on day one — and the engine will offer a
Standards benchmark, a hinge at 100% of bodyweight, on the first Monday of the
rehab phase that exists precisely because the knees cannot take that yet.

**Which phase.** `ProgramProgress.phase_id` is the authority, because progress is
the thing that advances. `Program.current_phase_id` is the seed for an athlete
with no progress row. A program with no `phases` at all is unphased and behaves
exactly as it did before any of this existed.

**Which steps.** Only steps whose `phase_id` matches the active phase. A step
with **no** `phase_id` is always in play — that is what keeps a flat program
flat. The phase filter runs *first*, before prerequisites and before
`current_step_ids`, because the `current_step_ids` fallback is "if nothing is
current, everything is", and a stale progress row used to open the whole pool.

**Which session.** `Program.days` holds one entry per (phase, weekday) the
program trains. `ProgramDay.weekday` and `ProgramPhase.weekdays` follow
`Date.getDay()`: 0 = Sunday … 6 = Saturday. When today has an entry, that entry
**is** the session — its `blocks` give the order, its `step_ids` give the steps,
and each block becomes its own block on the card. Two things in the real data
that look like mistakes and are not:

- **A step can appear twice in one day.** Zero lists `zero-tibialis-raise` at
  the top of the session and again a few minutes later, alternating with the
  calf raises. Both are kept. Collapsing them deletes half the prescribed dose
  of the movement the phase is named for. The de-duplication guard that stops
  the McGill Big 3 and the Core block both prescribing the curl-up still runs —
  it is aimed at accidental overlap between blocks the *engine* chose, not at
  work the program authored.
- **Two blocks can share a title.** Zero has a "Knee Ability" block near the
  front and another at the very end, for the optional body squat that comes
  after the stretches. Merging them by title moves that movement fifteen minutes
  earlier, which is not the session the program prescribes.

A step whose movement this location cannot perform, and whose substitutions
cannot either, is dropped with a note naming it. A hole in an authored session
that nobody can see is indistinguishable from a bug.

**Which days.** The phase's `weekdays` decide whether today is a program day —
not a weekly session count. Zero claims three days, Dense claims five, and
refusing Dense's Thursday because three sessions are already logged would mean
not running the phase as written. A scheduled day is also exempt from the "don't
repeat yesterday's type" damping, because Dense trains Monday through Friday on
purpose.

**The safety rules still win.** A scheduled program day that would violate the
regional load ledger or a pairing exclusion is still refused, and the note says
which. The calendar is the program's *claim*; ≥48 hours between hard stimuli to
the same region is a *constraint* (invariant 5), and a constraint is not
outvoted by a claim any more than by a deficit. The comment in `template.ts`
puts it better: KOT is a knee program, and fresh calves are not a reason to run
it on cooked quads.

### Load rules

`PhaseLoadRule` is how a phase turns bodyweight into a number. It **proposes**;
readiness, the ledger, the injury register, the deload and the equipment
rounding all still dispose, in that order, exactly as they do for any other
prescription. A calendar ramp never pushes load up on a low-readiness day or
during a deload.

| Kind | What it does |
| --- | --- |
| `bodyweight_only` | Load is zero, and the zero is load-bearing: it survives `achievableLoad`, which otherwise rounds *up* to the lightest dumbbell in the room. This is the whole reason Zero week 1 used to open with a 10 lb split squat. On a program day it governs the **whole session**, not only the program's own steps — bolting a loaded goblet squat onto the end to use up the budget is not "filling around the program", it is quietly cancelling it. Other session types in those twelve weeks are untouched. |
| `percent_bw_ramp` | Week 1 is bodyweight. Week 2 is `start_pct`. Week N ≥ 2 is `start_pct + (N − 2) × weekly_increment_pct`. For Dense that is 0 → 25% → 30% → 35% …  **These percentages are whole numbers** — 25 means 25% — unlike `ProgramStandard.pct_bodyweight`, which is a fraction. A ramp replaces the history-driven estimate rather than adding to it, and it suppresses the double-progression bump: the calendar *is* the progression, and applying both advances the same load twice in one week. |
| `standards_driven` | No calendar at all. The step's own `standard` is the target, through the usual prediction band. |

A ramp only applies to a movement that can actually hold weight. A wall tibialis
raise handed 40% of bodyweight produces 82 lb, which the equipment layer then
clamps to the movement's ceiling of zero and reports as "capped at 0 lb — that
is the heaviest here". The ramp simply does not apply there.

> **Known gap — the split squat.** Dense's own description says every week adds
> 5% *"except the split squat, which adds 2.5%"*. Nothing in the schema carries
> that: `PhaseLoadRule` has one increment for the whole phase. Every Dense step
> therefore climbs at 5%, and the ATG split squat climbs twice as fast as the
> program intends. There is a `TODO(kot)` on `phaseLoadFor` in `assembly.ts`. It
> needs a per-step override on `ProgramStep` before it can be honoured, and that
> is an additive schema change plus a re-ingest of `programs/kot/`, which is
> outside the engine.

### Per-side volume, and rest

Twenty of the 69 steps are `per_side`, and the engine used to ignore it — so
"25 reps per side" was counted, timed and ledgered as 25 reps. Half the work
went missing.

A per-side step is now prescribed as the **total across both sides**: 25 a side
is 50 reps, a 60-second hold per side is 120 seconds. This is the same
convention the app already uses for load, where a dumbbell pair is logged as the
sum of both hands (PRD §8.2), and it means the ledger, the weekly tonnage and
the time estimate all see the real work without any of them needing to know what
a side is. `PrescribedSet.per_side` travels with the set so the runtime can
render "25 each side" on the card.

`ProgramStep.rest_s`, where a step states one, is now the prescribed rest. The
30 seconds between ATG split-squat sets is part of the protocol, not a default.

One more dose rule falls out of this: a step whose standard names reps or a hold
but **no set count** is one set. A checklist line reading "25 reps" is the whole
dose; multiplying it by the goal mode's three sets is the same class of error as
overriding its rep count, and it turns Zero's tibialis raise into 75 reps twice
over.

### What Seth reads

The why line names the phase and the week in his language, not the schema's:

> **Knees Over Toes — Zero, week 1.** Readiness 75 — run it as written. Zero
> trains Mon, Wed and Fri, and today is one.

Phase names arrive from the source material shouting (`ZERO`, `DENSE`,
`STANDARDS`) because that is how the checklist prints them; `phaseLabel` in
`why.ts` turns them back into words. No id, no underscore and no week-zero ever
reaches the card.

---

## 9. Autoregulated deloads

Fixed-calendar deloads show **no advantage** over continuous training in recent RCTs (Coleman 2024; Pancar 2025 within-subject). So the engine does not schedule them. It watches for them.

**Triggers — any one fires a deload:**

1. 7-day average readiness below **65**
2. HRV trend down **≥10%** versus the 28-day baseline
3. **Two consecutive sessions** missing prescribed reps
4. Soreness or energy sliders red for **3 days**

**The deload:** −40% volume, −10–15% load, 5–7 days, mobility and Zone 2 emphasis.

**The hard cap:** if no trigger has fired in **8–10 weeks**, a light week is forced anyway. `DeloadState.weeks_since_last` is what counts, and the fired triggers are recorded in `triggers` so the why line can name the actual reason: "backing off for a few days — your HRV has been 11% down for a week and you missed reps on Monday."

---

## 10. Session assembly within a time budget

The budget is real. 30 minutes means 30 minutes, including rest, including setup, minus the location's travel overhead if any.

1. **Reserve** warm-up and cooldown. They sit on top of the budget or inside it depending on `warmup_outside_budget`.
2. **Estimate** every candidate block in minutes: working sets × (time under tension + rest), plus transition time, plus the program block's own estimate.
3. **Fill in priority order:** power → strength → program → conditioning → Zone 2 → mobility, with the program block hoisted to the front on program days and KOT internally ordered ground-up.
4. **Cut from the bottom.** When the budget runs out, the lowest-priority remaining block is dropped, and the drop is recorded in `notes` — so the audit view can say "no Zone 2 today, 30 minutes did not reach it".
5. **Compress rather than drop, where it is honest.** Under 30 minutes the engine pairs agonist/antagonist supersets and shortens rest inside what the goal mode allows. It does not compress rest on power or maximal-strength work, because that changes what the set is.
6. **Never overflow.** A session that estimates longer than the budget is a bug. Overruns are the reason people stop showing up.

---

## 11. Worked example: Tuesday, 30 minutes, home, readiness 72

**This section is generated from a real engine run, not written by hand.** The
input is `DOCS_WORKED_EXAMPLE` in `packages/engine/fixtures/days.ts`, and
`test/golden.test.ts` asserts the outcomes below against `plan()` on every test
run. If the engine's judgement changes, this section fails the build rather than
quietly becoming a lie. Every number here was printed by the code.

### The input

`today` = Tuesday 2026-09-22. `budget_min` = 30, with warm-up and cool-down set
to sit on top of it. `location` = Home — Bowflex adjustable dumbbells to 52.5 lb
per hand, adjustable bench with Nordic support, pull-up bar, bands, an outdoor
route. No barbell, no rack, no sled, no cable, no bike. Oura readiness 72, HRV
level with the 28-day baseline. Goal mode Tone, vertical-jump focus on. Program
KOT. Injuries: knees at 2/10, low back at 2/10, both longstanding.

History that matters: **Monday was a 45-minute lower-body KOT day** — backward
walking, tibialis raises, 3 × 5 ATG split squats at 70 lb at RPE 9, 2 × 8 RDL at
160 lb at RPE 8. Sunday was a 25-minute Zone 2 bike.

### Stage 1 — Readiness

`score 72 · band as_planned · source oura`, with reasons "Oura readiness 72" and
"HRV +0% vs baseline". Load multiplier 1.0, no RPE cap, no extra set. No
self-report was submitted, so the sliders do not enter the blend and 72 is
carried through unchanged.

### Stage 2 — The ledger

Monday's KOT session was 24 hours ago and hit four regions hard:

| Region | 7-day load | ACWR | Since hard hit | State |
| --- | --- | --- | --- | --- |
| knees_quads | 1.06 | 0.92 | 24 h | **Blocked** — needs 24 h more |
| posterior_chain | 7.21 | 1.42 | 24 h | **Blocked** — needs 24 h more |
| low_back | 4.28 | 1.36 | 24 h | **Blocked** — needs 24 h more |
| hips_glutes | 5.57 | 1.36 | 24 h | **Blocked** — needs 24 h more |
| chest | 4.05 | 1.06 | 120 h | Available |
| upper_back | 2.25 | 1.11 | 120 h | Available |
| shoulders | 2.02 | 1.06 | 120 h | Available |
| elbows_forearms | 2.75 | 1.08 | 120 h | Available |
| calves_achilles | 0.34 | 0.83 | — | Available |
| core · spine · neck | 0.00 | 0.00 | — | Available |

Nothing is eccentric-blocked: Monday's split squats are not flagged
`eccentric_dominant`, so the 72-hour clock never started. Posterior chain and
hips are both at 1.36, above the 1.3 comfort line but below the 1.5 danger line —
permitted, but the assembler will not add fuel there.

### Stage 3 — Deload

Seven-day readiness averages well above 65, HRV is flat rather than falling, no
session missed its reps, sliders are not red, and the calendar backstop has not
elapsed. **No deload.**

### Stage 4 — Weekly dose

Zone 2 at **47 minutes** against this week's ramp ceiling of **55** — not against
the 180-minute target, because Seth is still climbing and the ≤10%/week rule is
what governs early weeks. VO2 sessions **0 of 1**. Strength at **85 minutes**,
inside the 60–120 window. Mobility 0 of 2. Two sessions logged, 14,560 lb moved,
steps averaging 7,500.

### Stage 5 — Choosing the day

KOT is due, but every lower-body region it needs is inside its 48-hour window,
so it scores zero with the note *"Lower body is still recovering."* Power is
lower-body too, and gated on the same regions. Zone 2 has only 8 minutes of
headroom left under the ramp ceiling. Strength is possible on the upper body but
the week is already at 85 minutes. **The VO2 session is the one thing that is
both owed and legal**, and it is the single highest-leverage session in the
programme for lifespan.

**Today is `vo2`.**

### Stage 6 — The prescription

Thirty working minutes does not fit the Norwegian 4 × 4 with its warm-up, so the
engine falls back to the **8 × 2 min** protocol: 2 minutes work, 2 minutes active
recovery, eight rounds, exactly 30 minutes, at **164–177 bpm** — 88–95% of an
HRmax of 186, which comes from 220 − 34 because no measured Strava maximum
exists in the last 90 days.

Modality is **running**. RESEARCH §6.2 prefers a bike or rower within 24 hours of
heavy lower-body work, and the engine tried: there is no bike at home. That is a
preference, not a prohibition, so it runs and says so in the copy rather than
skipping the most valuable session of the week.

### Stage 7 — What is NOT in the session

No strength block, no mobility block, no core. On a cardio-led day the cardio is
the session; assembling accessories first and appending the intervals afterwards
is how a 30-minute day becomes a 66-minute one. The cardio duration is reserved
from the budget before anything else is allowed to compete for it.

### Stage 8 — Output

```
type          vo2 — "VO2 intervals"
estimated_min 40          (30 working + 5 warm-up + 5 cool-down, bookends outside the budget)
readiness     72 · as_planned · oura
deload        false
warnings      []
signature     934e06f6
```

**Session why:**
> VO2 day. Readiness 72 — run it as written. The single highest-leverage session
> for lifespan.

**Cardio why:**
> 8 × 2 min at 85–95% max. VO2max carries the strongest dose-response with
> all-cause mortality of anything in this app — roughly 12–15% lower risk per MET
> gained. Recovery between rounds is active, not stopped. Zone 2 window for
> reference: 133–146 bpm. Your legs took a hard session yesterday and there is no
> bike here, so keep the effort honest but the ground soft, and stop if anything
> sharpens.

**Notes** (the audit trail, shown behind a disclosure):
```
knees quads: Hard session 24h ago — needs 24h more.
posterior chain: Hard session 24h ago — needs 24h more.
low back: Hard session 24h ago — needs 24h more.
hips glutes: Hard session 24h ago — needs 24h more.
Not kot today: Zero trains Mon, Wed and Fri — today is not one of them.
```

Both facts about KOT are true today and only one of them is the reason. The
four blocked regions are printed immediately above, but the schedule answers
first: Tuesday is not a Zero training day at all, so the ledger never gets a
turn. On a Wednesday with those same four regions blocked the note reads
"Lower body is still recovering" instead — see §8.

### Stage 9 — The week

```
Tue  vo2      ← today
Wed  kot
Thu  zone2
Fri  kot
Sat  mobility
Sun  zone2
Mon  kot
```

Every program day lands on a Monday, a Wednesday or a Friday, because those are
the weekdays Phase 1 Zero trains (§8). Before phase scheduling existed the week
came back `vo2 · power · zone2 · kot · mobility · zone2 · strength` — one KOT
session instead of three, on whichever day the weekly-deficit arithmetic
happened to favour. The four days that changed are the whole point of the
mechanism.

Each projected day is planned against a ledger carrying the days before it, and
each one counts toward the weekly dose as though it had been performed — so
Wednesday knows Tuesday spent the week's VO2 session, and does not prescribe
another. Without that accumulation every day independently sees "no VO2 yet this
week" and the whole week comes back as VO2, which is exactly the bug this
mechanism was built to fix.

Future days assume neutral readiness. We do not forecast Oura, and the carousel
says so. Every one of them is re-solved when the day actually arrives.

Feed the same input in tomorrow and you get the same bytes back, signature
included.

---

## 12. Testing

Because the engine is pure, testing it is just a table of inputs and expected outputs.

- **Fixture days** in `packages/engine/fixtures/`: high readiness, low readiness, injury flare, 15-minute home, 90-minute Planet Fitness. PRD §9 requires these five. Two more exist: cold start (no history, no Oura, no sliders) and `DOCS_WORKED_EXAMPLE`, which is the input §11 above is generated from.
- **Golden-file tests** on session assembly: the whole `PlanResult` is serialized and compared, so an unintended change anywhere shows up as a diff rather than as a surprise in March.
- **Invariant assertions** that run against every fixture: no session violates the ledger; no session violates a pairing exclusion; no session exceeds its budget; no session prescribes equipment the location does not have; no barbell movement survives at a barbell-free location.
- **Phased-program tests** in `test/program.test.ts`: phase gating, the weekday templates and their authored repeats, the three load rules and their interaction with readiness and deload, per-side volume and prescribed rest.
- **381 tests** at the time of writing. `npm run test` from `packages/engine`, `npm run check` from the repo root for contracts, types, tests and data together.
- **Every engine change ships with a fixture or a test.** That is in `CLAUDE.md` and in `CONTRIBUTING.md`, and it is the reason the ledger stays a constraint rather than drifting into a suggestion.
