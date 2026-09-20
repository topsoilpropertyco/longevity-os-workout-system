# ADR 0009 — Row-level security is on from the first migration, for one user

**Status:** accepted · **Date:** 2026-09-20 · **Implements:** `CLAUDE.md` project shape; PRD §5, §9

## Context

There is exactly one user. RLS protects nothing today that a correct application layer would not already protect. Turning it on now costs a policy per table, a `user_id` column that is the same value on every row, and the occasional confusing empty result while developing.

The argument for doing it later is that later is when it matters.

The argument against is what "later" means in practice: a migration touching every table, backfilling `user_id` on every row, writing policies for a schema you no longer hold in your head, and testing them against data you cannot afford to lose. Retrofitting RLS is the kind of task that gets scheduled and then does not happen, and the failure mode is a health database — Oura readiness, HRV, injuries, body fat, training history — readable by anyone holding a publishable anon key.

The specific hazard is Supabase's shape. The `anon` key **is** in the browser by design; RLS is the thing that makes that safe. Without policies, that key is a full read of the database. With them, it is scoped to one user.

## Decision

**RLS is enabled on every table in the migration that creates it. No exceptions, no "we'll add it before launch".**

- Every table carries `user_id`, from day one, including tables that will only ever hold one user's rows.
- Every table gets select, insert, update and delete policies scoped to `auth.uid()`.
- Reference tables that are genuinely shared and non-personal — the exercise library, the equipment catalog, the public program scaffolds — have RLS enabled with an explicit read-for-authenticated policy, so "no policy" never means "wide open by accident".
- The **`service_role` key bypasses RLS** and is therefore server-only: cron routes, webhook handlers, and the Mac mini worker. Never in a `NEXT_PUBLIC_` variable, never in client code.
- Adding a table without RLS is a review failure, not a style note.

## Consequences

**Good.** The anon key is safe in the browser, which is the whole reason the client can talk to Supabase directly and the reason ADR 0001 can use server actions without a bespoke auth layer. Multi-user becomes a product decision rather than a security project — the data is already partitioned. There is no future migration where health data sits unprotected during a backfill.

**Costs.** A policy per table to write and keep correct. During development, a missing or wrong policy shows up as an empty result rather than an error, which is genuinely confusing the first few times — the reflex to learn is *check the policy before debugging the query*. The service-role key now exists and must be handled carefully; it is the one credential that would hurt.

**Testing.** The policies are tested: an authenticated request sees its own rows, and a request without a session sees nothing. That test runs against every table.

## What would change our mind

Nothing. This is the cheapest security decision available and it gets more expensive every day it is deferred.

The only adjacent question is whether the app should also encrypt Oura and Strava tokens at rest on top of RLS — PRD §9 says yes, and that is separate and additional, not an alternative.
