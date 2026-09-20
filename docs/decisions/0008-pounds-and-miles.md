# ADR 0008 — Store pounds and miles

**Status:** accepted · **Date:** 2026-09-20 · **Implements:** `CLAUDE.md` units convention

## Context

The usual engineering instinct is to store SI — kilograms and metres — and convert at the edges. It is tidy, it is what a multi-region product would do, and it makes unit-agnostic maths slightly cleaner.

This is not a multi-region product. It is one man in Detroit. He thinks in pounds, his dumbbells are labelled in pounds, the Planet Fitness plates are in pounds, the KOT standards are expressed as percentages of a bodyweight he knows in pounds, his runs are in miles, and Strava is already giving him miles.

Storing kilograms would mean every write converts in, every read converts out, every displayed number is a rounded conversion of a converted value, and a 42.5 lb dumbbell becomes 19.2772... kg and then comes back as 42.499. That is a class of drift with no upside for this user.

## Decision

**Store pounds and miles. `load_lb` and `distance_mi`, as the field names say.**

- Weight: pounds, `load_lb`, total load (ADR 0007).
- Distance: miles, `distance_mi`.
- Duration: minutes, unless the field name ends `_s` or `_sec`.
- Height: inches. Body temperature deviation stays in Celsius because that is what Oura returns, and the field name says so.
- Dates are ISO `YYYY-MM-DD` in Seth's local timezone; instants are ISO 8601 UTC.
- **Conversion happens at integration boundaries only.** If Oura or Strava returns metric, `packages/integrations/` converts on the way in and nothing downstream ever sees a metre.
- **Units are in the field name.** No bare `weight` or `distance` anywhere in the schema or the types.

PRD §8.11 lists a units setting (lb/mi). That is a **display** preference. It does not change storage.

## Consequences

**Good.** What Seth sees is what is stored. No round-trip drift, no rounding artifacts on dumbbell increments, no conversion bug class at all in application code. The Bowflex's 2.5 lb steps and the plate maths land on exact numbers. KOT's %BW standards compute directly against a bodyweight in pounds. Debugging is easier because the numbers in the database are the numbers on the card.

**Costs.** If the app ever serves a metric user, every stored row needs a conversion layer on read — and the units setting becomes real work rather than a formatting flag. We accept that, because `user_id` exists on every table for a future that may never arrive, and this is a decision that is cheap to revisit with a single migration.

**Sharp edge.** Integrations must convert at the boundary and must be tested for it. A Strava distance in metres written straight into `distance_mi` is a 1,609× error that would sail past a type checker, so the integration tests assert on plausible ranges.

## What would change our mind

- A second user who thinks in kilograms. Then storage moves to SI and display converts — one migration, and the field names change with it so nothing is ambiguous during the transition.
- A data source that only supplies metric at a precision that matters, where converting on the way in would lose something real. Not the case for Oura or Strava.
