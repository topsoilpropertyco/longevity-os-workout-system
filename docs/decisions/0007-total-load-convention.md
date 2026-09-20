# ADR 0007 — Weight is always total load

**Status:** accepted · **Date:** 2026-09-20 · **Implements:** `CLAUDE.md` conventions; PRD §8.2

## Context

"I pressed 50s" is ambiguous, and every fitness app resolves it differently. Per-hand, per-side, per-implement, bar-inclusive, bar-exclusive, stack-as-displayed — and the same app often mixes them by exercise type. The consequence is that tonnage is meaningless across exercises, progression comparisons are wrong across equipment, and imported history from another app is silently off by a factor of two.

Seth's situation makes this worse, not better. He trains across a Bowflex adjustable-dumbbell setup at home and a Planet Fitness Smith machine whose bar is counterbalanced to an **effective 15–20 lb, not 45** (RESEARCH §2). Any convention that treats "the bar" as a constant is already wrong before the first set.

The engine also needs one number per set to feed the regional load ledger, ACWR and tonnage. Multiple conventions would mean conversion at every read, which is where the bugs live.

## Decision

**`load_lb` is the total load moved, in pounds, always.**

| Load style | What `load_lb` holds |
| --- | --- |
| `total_dumbbell_pair` | Both hands summed. Two 42.5 lb dumbbells = **85**. |
| `single_implement` | The implement as it is. One 50 lb dumbbell = **50**. |
| `barbell` | Bar plus plates, using **that location's** bar weight. |
| `smith` | Smith bar plus plates, using that location's **effective** Smith bar weight — 20 lb by default, editable per club. |
| `stack` | The stack as displayed. |
| `bodyweight` | **Added load only.** Bodyweight itself lives on the athlete and is joined from the latest body metric. A bodyweight pull-up is 0. |
| `assisted` | Assistance as a negative contribution. |
| `band` | Approximate tension via a band-colour mapping. |
| `none` | No load concept — mobility, breathwork, distance carries. |

**The convention is explained to Seth once inline**, the first time he logs a dumbbell set, **and permanently in Settings** (PRD §8.2). That is the entire user-facing cost.

## Consequences

**Good.** Tonnage sums across every exercise and every location without conversion. The ledger gets one comparable number per set. Progression comparisons hold when he moves a lift from home dumbbells to the Smith machine. Prediction bands and e1RM work on a single scale. CSV imports are normalized once, at the boundary.

**Costs.** It is not how most lifters talk. "85" on an incline dumbbell press reads oddly the first few times when the dumbbell in his hand says 42.5. We accept this deliberately, because the alternative is either lying in the tonnage number or carrying two numbers everywhere. Mitigation: the set card shows the total as the hero, with a quiet "42.5 per hand" beneath it — display is allowed to be friendly, storage is not allowed to be ambiguous.

**Sharp edge.** Bodyweight movements are only correct if the bodyweight on file is current, which is why the weekly scale prompt exists. Stale bodyweight quietly corrupts the ledger for every bodyweight movement.

**Import risk.** Every source app has its own convention, and some vary it by exercise. The importer's review screen must show the normalized total so a doubling error is visible before it is committed.

## What would change our mind

Nothing about storage. `load_lb` stays total.

**Display** can change freely — a per-hand toggle for dumbbells is a display preference, and if Seth wants one he gets one. The stored number does not move.
