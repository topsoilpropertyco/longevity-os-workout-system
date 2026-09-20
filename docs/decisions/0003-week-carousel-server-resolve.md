# ADR 0003 — The week-carousel re-solve runs server-side, with optimistic UI

**Status:** accepted · **Date:** 2026-09-20 · **Decides:** PRD §13, "Whether the week carousel re-solve is server-side (consistent) or client-side (instant) — default server, optimistic UI"

## Context

Seth pulls Thursday's session forward to today. The rest of the week has to re-solve under the same constraints — the ledger, exclusions, the weekly dose, the program's claim on 2–3 days — and he should see a one-line diff of what moved.

Client-side is instant: the engine is pure TypeScript and would run in the browser. But it means shipping the engine and enough of the exercise library and history to the phone, and it introduces a second place where a plan can be produced. Two producers means they can disagree, and a plan that differs between phone and server is a bug class with no floor.

Server-side is one producer, full history in hand, nothing to ship. It costs a round trip — a few hundred milliseconds on LTE.

## Decision

**Server-side re-solve, with optimistic UI covering the round trip.** PRD §13's stated default, taken as stated.

1. The tap immediately reorders the carousel optimistically and shows the pulled day as today.
2. The server action re-solves the full week and returns the new `PlanResult` with its `signature`.
3. The UI reconciles. If the server's answer differs from the optimistic guess — because a constraint the client could not know about bit — the diff line says so plainly rather than silently correcting.
4. The diff line is generated from the two `PlanResult`s, not guessed at in the UI.

**The engine remains isomorphic.** It is pure TypeScript with no I/O and could run anywhere. We are choosing where to call it, not constraining what it is.

## Consequences

**Good.** Exactly one producer of plans, so the phone and the server can never disagree. No engine, library or history shipped to the client — which also keeps the first-paint budget intact. The diff is computed from real before-and-after objects.

**Costs.** A network round trip on every re-solve, and therefore a visible correction on a slow connection if the optimistic guess was wrong. Re-solving the week is not possible offline; the carousel is read-only in airplane mode, while today's card stays fully usable.

## What would change our mind

- The round trip measurably annoys — if the reconcile visibly corrects often enough that Seth stops trusting the first response.
- Offline re-planning becomes a real requirement rather than a nice idea.
- If we do move it, the rule is that the client engine and the server engine are the same build of the same package, and the `signature` is compared on every reconcile so a divergence is an error rather than a mystery.
