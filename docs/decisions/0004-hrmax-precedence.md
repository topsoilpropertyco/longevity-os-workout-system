# ADR 0004 — HRmax precedence: measured Strava max (90 days) > Oura > 220 − age

**Status:** accepted · **Date:** 2026-09-20 · **Decides:** PRD §13, "Exact HRmax source precedence"

## Context

Every heart-rate zone in the system derives from HRmax. Zone 2 targets at 60–70% HRmax, VO2 intervals at 85–95% (RESEARCH §6.1), and compliance scoring on every cardio session all move when HRmax moves. Get it wrong and Seth's Zone 2 is someone else's Zone 3, and the 150–240 min/week target becomes a slow way to accumulate fatigue.

Three sources are available, in descending order of trustworthiness and ascending order of availability:

- **Measured**: the maximum heart rate observed in Strava activity streams. True data, but only meaningful if he has actually gone near maximal recently, and vulnerable to strap artifacts — a dropout can produce a spurious 210.
- **Oura**: whatever maximum the ring has recorded. Optical wrist/finger HR is not workout-grade (RESEARCH §3 notes the `heartrate` endpoint is 5-minute daytime granularity), so this is a weak source.
- **220 − age**: the formula. At 34, that is **186**. Population-level, with a standard deviation around ±10–12 bpm, so it can be badly wrong for an individual — but it is always available.

## Decision

**Precedence, highest first:**

1. **Measured — the maximum HR across Strava activity streams in the last 90 days**, provided it clears a plausibility filter: within a sane band for his age, and sustained across enough samples that it is not a single-sample spike. `hr_max_source: 'measured_strava'`.
2. **Oura**, when Oura exposes a usable maximum and no qualifying Strava measurement exists. `hr_max_source: 'oura'`.
3. **220 − age = 186 at 34.** `hr_max_source: 'formula'`.

**A manual override in Settings beats all three** and is sticky until cleared, because a lab test or a genuine all-out effort he witnessed beats anything we can infer.

**The 90-day window matters.** A measured max ages out, so a hard effort from eighteen months ago does not keep defining today's zones.

**The source is always shown.** Settings displays which one is in force, and the cardio card's why line says so when it is the formula: *"zones from 220 − age until we see a real max."*

This is PRD §13's stated precedence, taken as stated, with the plausibility filter, the window and the override added.

## Consequences

**Good.** Zones improve automatically as real data arrives, with no action from Seth. The `hr_max_source` field means every historical zone calculation can be re-examined knowing what it was based on. The plausibility filter keeps a strap dropout from permanently inflating every future zone.

**Costs.** HRmax can shift when a new measured max arrives, which shifts zone boundaries and therefore makes historical zone minutes computed under the old max not strictly comparable. We accept this and store the HRmax used alongside each computed set of zone minutes, so a re-computation is always possible.

**Risk.** If he never goes near maximal — likely, given Zone 2 is the bulk of the prescription — the formula stands indefinitely. A VO2 4×4 session is the natural place to observe a real max, which is a quiet argument for keeping the weekly VO2 slot filled.

## What would change our mind

- Karvonen / heart-rate reserve using Oura's resting HR proves to track his perceived effort better than %HRmax. RESEARCH §4 raises this explicitly as an open question, and the data to test it accumulates automatically.
- A lab VO2max test happens. Then the measured value is entered by hand and outranks everything.
- The plausibility filter turns out to reject real efforts, or to admit strap artifacts. Either way the filter is tuned, not the precedence.
