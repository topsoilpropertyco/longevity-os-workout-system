# ADR 0006 — The rules engine is deterministic and pure

**Status:** accepted · **Date:** 2026-09-20 · **Implements:** `CLAUDE.md` architecture invariant 1; PRD §7 brain split

## Context

Something has to decide what Seth does today. The candidates were an LLM deciding directly, an LLM deciding with rule-based guardrails, or a deterministic engine deciding with an LLM narrating.

A prescription here is not a suggestion. It is a claim about a body with two injured regions, made under constraints that exist specifically to prevent injury — the 48-hour regional rule, the 72-hour eccentric rule, ACWR bounds, pairing exclusions. Those constraints are only meaningful if they are *always* applied. A model that applies them 98% of the time applies them zero percent of the time in the sense that matters, because the 2% arrives on the day he feels great and the ledger says no.

There is also a plain engineering argument. A pure function is testable against fixture days, diffable across runs, explainable by pointing at a rule and a number, and reproducible when Seth asks in March why it told him to do that in September.

## Decision

**`packages/engine/` is pure TypeScript with no I/O.** One `PlanInput` in, one `PlanResult` out.

- No network, no database, no filesystem, no clock, no environment. `today` is a field on the input, not a call to `Date.now()`.
- No randomness that is not seeded. `PlanInput.seed` exists for anything that would otherwise be arbitrary.
- No runtime dependencies at all.
- Every output carries a **`signature`** — a deterministic hash of input to plan — so two plans can be compared byte for byte.
- 100% unit-tested against fixture days in `packages/engine/fixtures/`, with golden files on session assembly.
- **The LLM may explain, converse, parse, and request engine actions through a typed tool schema. It may never write a prescription the engine did not produce.**

The caller does all the gathering. That is the whole price of purity, and it is paid once, in one place.

## Consequences

**Good.** Tests are a table of inputs and expected outputs. Bugs are reproducible from a serialized `PlanInput`. The engine can run on the server, in the browser (see ADR 0003) or in a test with no setup. When the plan changes, the diff says exactly what changed and the signature proves whether anything did. The LLM layer can fail completely — and it will, because it depends on a machine in Seth's house — without affecting a single prescription.

**Costs.** The gathering layer is bulky: assembling `PlanInput` means fetching the athlete, goals, location, 28 days of Oura, 28+ days of sessions and cardio, injuries, body metrics, the program, its progress and the filtered exercise library, every open. That is a real cost and it is concentrated in one adapter rather than spread everywhere. Purity is also a discipline that erodes under deadline — the first `fetch` inside the engine is the end of this ADR, which is why the package has no dependencies and no I/O imports available to it.

**Explainability comes free.** Because every decision is a rule with a number, the why line has something true to say. The LLM's job is to phrase `reasons: ['readiness 72, in the planned band', 'knees 38 h since Sunday, needs 48']` as a sentence — not to invent it.

## What would change our mind

Nothing about determinism or purity. Both are invariants.

The *boundary* could move: if the engine grew genuinely hard combinatorial optimization — a full-week solve over many constraints where a heuristic search beats hand-written priority ordering — we would use a solver **inside** the engine, seeded and deterministic. It would remain pure. An LLM writing a prescription is not on the table at any scale.
