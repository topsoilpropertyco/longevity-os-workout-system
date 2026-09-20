# ADR 0001 — App Router with server actions, plus route handlers only for external callers

**Status:** accepted · **Date:** 2026-09-20 · **Decides:** PRD §13, "Next.js App Router + server actions vs. separate API layer"

## Context

PRD §13 leaves this open. The app has two very different kinds of caller:

1. **Seth's phone**, which is the only client and is authenticated as a single user.
2. **Outside systems** — Telegram, Strava, Vercel cron — which need a stable public URL to POST to and authenticate with a shared secret or a signed header.

A separate API layer would mean a second deployable, a second set of types, hand-written fetch calls from the client, and a serialization boundary in the middle of every mutation. Server actions collapse all of that into a typed function call, with no client-side fetch code and no API surface to keep in sync. Against that: server actions are Next.js-specific, they are not callable from outside, and they are awkward to test in isolation.

## Decision

**App Router with server actions for everything the app itself does. Route handlers under `/api/` only where an external system needs a URL.**

- **Server actions** own: solve today's plan, re-solve the week, log a set, swap an exercise, complete a session, update settings, connect an integration.
- **Route handlers** own exactly: `/api/telegram`, `/api/strava/webhook`, `/api/strava/callback`, `/api/oura/sync`, `/api/strava/sync`, `/api/llm/fallback`, `/api/cron/*`. Each authenticates on its own terms — Telegram's secret header, Strava's verify token, `Authorization: Bearer $CRON_SECRET`.
- **Neither layer contains logic.** Both are thin adapters over `packages/engine/` and `packages/integrations/`. Anything either one does that the other cannot is a design error.

**This is the PRD's first option, taken deliberately.** PRD §13 states the alternative; we are choosing App Router with server actions and recording why.

## Consequences

**Good.** No duplicated types across a network boundary. Mutations are typed end to end. No client fetch code to write or debug. The external surface is small, enumerable and individually authenticated. Because both layers are thin, the engine stays testable without a server.

**Costs.** Coupled to Next.js and to Vercel's runtime. Server actions cannot be called from the bot or from the worker, so anything both the app and the bot need — starting a session, logging a set — has to live in the shared layer beneath both, not in the action. That discipline is load-bearing; if it slips, the bot and the app drift apart.

**Testing.** Server actions are tested through the shared layer they call, not directly. Route handlers get contract tests on payload shape and auth rejection.

## What would change our mind

- A second client appears — a watch app, a desktop tool, anything not this Next.js app. Then a real API layer earns its keep.
- We leave Vercel for a host with weaker server-action support (Cloudflare is named in RESEARCH §8 as the cron alternative).
- Multi-user arrives, and the auth story needs to be explicit and inspectable at a boundary rather than implicit in a framework feature.
