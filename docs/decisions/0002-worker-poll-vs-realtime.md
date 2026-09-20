# ADR 0002 — The mini worker polls `llm_jobs` every 15 seconds

**Status:** accepted · **Date:** 2026-09-20 · **Decides:** PRD §13, "Supabase Realtime vs. polling for the mini worker (default: poll every 15 s)"

## Context

The Mac mini worker has to find out that an LLM job exists. Two options: subscribe to Supabase Realtime and get pushed a notification, or poll the `llm_jobs` table on a timer.

Realtime is lower-latency and lighter on requests, but it is a websocket — it needs reconnection handling, it can silently drop and leave the worker looking alive while it is deaf, and a missed event needs a polling reconciliation anyway. Polling is a loop with a `select` in it: obvious, debuggable, and it fails loudly.

There is also a second job polling does for free. RESEARCH §8 warns that a free Supabase project pauses after about 7 days of inactivity. A 15-second poll is 5,760 writes a day, which is the keep-alive. A websocket subscription may not count as activity in the same way.

Latency budget: the fallback fires at 60 seconds, and nobody is waiting on a "why" line in real time. A 15-second worst case is invisible.

## Decision

**Poll every 15 seconds, and claim atomically.** This is PRD §13's stated default, taken as stated.

- The worker selects unclaimed jobs and claims one with a conditional update — `queued → claimed` only where the row is still `queued`. Exactly one claimant wins, so the worker and the Gemini fallback can race safely.
- Every poll doubles as the keep-alive write.
- A stale-claim reaper releases jobs that have sat `claimed` without completing, so a worker that dies mid-job does not strand it.

## Consequences

**Good.** Trivially debuggable — the failure mode is "the loop stopped", which is visible in one log line and in the app's worker last-seen row. No websocket lifecycle code. Keep-alive comes free. The 60-second fallback works unchanged.

**Costs.** Up to 15 seconds of latency per job. About 5,760 queries a day against a free Postgres — negligible at this scale, but it is not nothing, and it is a floor on how quiet the system can be. Realtime would be more elegant.

## What would change our mind

- A genuinely interactive LLM surface appears — a live chat in the app where 15 seconds is felt.
- The poll shows up as meaningful load or quota pressure on the free tier.
- Realtime proves itself elsewhere in the app first, so the reconnection handling already exists and is trusted. Even then, keep the poll as the keep-alive and the reconciliation, at a slower interval.
