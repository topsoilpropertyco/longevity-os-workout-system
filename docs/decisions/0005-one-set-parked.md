# ADR 0005 — "One set" stays parked

**Status:** accepted (parked) · **Date:** 2026-09-20 · **Decides:** PRD §13, "'One set' (unresolved feature memory from a past app) — parked"

## Context

PRD §13 records a feature memory: **"one set"**, from an app Seth used previously. The name is all we have. The intent is not recovered, and the PRD itself parks it.

Plausible readings, none confirmed:

- **A single working set per exercise** — a minimalist mode, one hard set to near-failure per movement, which is a defensible time-efficient protocol.
- **One set at a time on screen** — a runtime UI where exactly one set card is visible and the rest are hidden until earned. This would sit naturally with the one-idea-per-screen principle.
- **A quick-log affordance** — "log one set" without starting a whole session, for the ad-hoc set of pull-ups on the way past the bar.
- **Something else entirely**, remembered by feel rather than by function.

Building the wrong one costs more than not building any: it adds a mental model Seth has to hold, which is the exact thing the governing rule forbids.

## Decision

**Parked. Nothing is built.** This ADR exists so the memory is not lost and so nobody quietly invents a meaning for it during a phase.

Two of the readings are already covered, which lowers the cost of waiting:

- Minimalist volume is reachable today through **goal mode Maintain** (2 sets, 6–10 reps, RPE 7) and through short time budgets, where the engine compresses to supersets.
- One-set-at-a-time is already how the runtime screen reads: the current set is the hero, logged sets are a quiet table beneath it.

**The unparking rule:** Seth describes what it did, in one sentence, from memory or from a screenshot of the original app. That sentence becomes the requirement. Until then it stays here.

## Consequences

**Good.** No speculative feature, no mental model added on a guess. The memory is recorded where it will be found — `docs/decisions/` — rather than lost in a chat log. Two of the four readings are already served.

**Costs.** If "one set" was the thing Seth actually missed from the old app, he does not have it yet. That is the acceptable side of the trade, because he can ask for it in one sentence and he is the only user.

## What would change our mind

- Seth says what it was.
- A screenshot or the old app's name surfaces and makes it recoverable.
- The same shape gets asked for independently, in different words — "just let me log one set", "can I do one hard set and go" — at which point that request is the requirement and the name is irrelevant.
