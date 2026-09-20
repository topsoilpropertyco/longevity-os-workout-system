# Contributing to Longevity OS

Single-user project, but the discipline is the same as if it were not — because the person reading this in six months is Seth, or an agent, and neither will remember.

**The short version:** conventional commits, small steps, every engine change ships with a test, migrations go in `supabase/migrations/`, and `npm run check` passes before you commit.

---

## Before you commit

```bash
npm run check    # typecheck across all workspaces, then the engine tests
```

If it fails, it does not get committed. There is no CI to catch it for you and no reviewer who will notice.

Useful while working:

```bash
npm run test:watch   # engine tests, watching
npm run dev          # the web app
npm run lint
```

---

## Conventional commits

`<type>(<scope>): <subject>`, imperative mood, lower case, no trailing period.

**Types:** `feat` · `fix` · `docs` · `refactor` · `test` · `chore` · `perf` · `style`

**Scopes:** `engine` · `web` · `integrations` · `worker` · `db` · `docs` · `data` · `claude`

```
feat(engine): add ACWR guard to running distance
fix(web): keep the rest timer accurate with the screen locked
test(engine): add the 15-minute home fixture day
docs(decisions): record the HRmax precedence chain
chore(db): add the llm_jobs stale-claim reaper
```

The body explains **why**, not what — the diff already says what. If the change alters a golden file, say so and say whether it was intended.

---

## Small, PR-sized steps

One idea per commit. A commit that touches the engine, three screens and a migration is three or four commits that have not been separated yet.

Why this matters more than usual here: the engine is deterministic and golden-file tested, so a small commit produces a small, readable diff in the golden files. A large commit produces a golden-file diff nobody can review, and an unreviewable diff in the thing that decides what a person does with their knees is not acceptable.

Work on a branch. Never commit directly to the default branch.

---

## Every engine change ships with a fixture or a test

From `CLAUDE.md`, and it is the rule with the fewest exceptions — there are none.

Any change in `packages/engine/` needs at least one of:

- a **new fixture day** in `packages/engine/fixtures/` that exercises the new behaviour
- a **unit test** for the new or changed function
- an updated **golden file**, with the diff explained in the commit body

The five required fixture days (PRD §9) are: high readiness, low readiness, injury flare, 15-minute home, 90-minute Planet Fitness. Add to them. Never delete one.

**The invariant assertions run against every fixture** and are not optional: no ledger violation, no pairing-exclusion violation, no budget overrun, no equipment the location does not have, no barbell movement surviving at a barbell-free location. A fixture that violates one of those is reporting a **bug** — fix the engine, not the fixture.

Keep the engine pure while you are in there: no network, no database, no filesystem, no `Date.now()`, no `process.env`, no unseeded randomness, no runtime dependencies (ADR 0006).

---

## Migrations

Every schema change is a **new file** in `supabase/migrations/`. Timestamp-prefixed, so ordering is unambiguous.

- **Never edit a migration that has run.** Write the next one.
- **RLS is enabled in the same migration that creates the table** (ADR 0009), with policies scoped to `auth.uid()`. A table without RLS does not get merged.
- Every table carries `user_id`, including the ones that will only ever hold one user's rows.
- Commit the **generated types** alongside the migration — `CLAUDE.md` requires it, and a stale type is worse than no type.
- Say in the commit body whether the migration is reversible and what it would take.

---

## Documentation

- **Every document gets a title line.** `CLAUDE.md` requires it, and that includes generated reports and bot messages.
- A decision with lasting consequences gets an **ADR** in `docs/decisions/` — next number, `Context / Decision / Consequences`, plus what would change our mind.
- Change a behaviour described in `docs/ENGINE.md`, `docs/ARCHITECTURE.md` or `docs/DESIGN.md`, and update it in the same commit. Documentation that disagrees with the code is worse than no documentation.
- **Never invent a credential, URL, endpoint, quota or limit.** If the source documents do not state it, say so. Where `docs/RESEARCH_FOUNDATION.md` marks something ⚠️ verify-at-build-time, carry the ⚠️ forward rather than quietly resolving it.
- `docs/PRD.md` and `docs/RESEARCH_FOUNDATION.md` are the **contract** and are effectively read-only. If the code needs to disagree with them, raise it with Seth rather than editing them.

---

## Secrets

- Never commit a secret. `.env.local` is gitignored; keep it that way.
- New environment variable → add it to `.env.example` with a **fake but realistic** placeholder and a one-line comment saying where to get it and whether local dev needs it.
- The `service_role` key bypasses RLS: server-side only, never in a `NEXT_PUBLIC_` variable, never in client code, never in a plan document.
- If a secret reaches a commit, **rotate it** (`docs/OPERATIONS.md` §4). Rewriting history does not un-publish it.

---

## Cost

**$0/month is a hard ceiling.** No paid dependency, API, tier, plan or add-on without asking Seth explicitly and getting a yes. This includes free tiers that require a card, and it includes "it's only $5".

---

## Agents

Three subagents are defined in `.claude/agents/` and delegating to them is the default:

- **`researcher`** (haiku) — read-only codebase and docs exploration
- **`engine-builder`** (opus, xhigh) — the rules engine, fixtures, tests
- **`ui-builder`** (sonnet, high) — screens, components, styling

Consult the advisor before committing to any schema, engine-architecture or integration-pattern decision, and before declaring a phase done. Plan-mode documents live in `.claude/plans/` and are committed.

Before starting a phase, restate the phase goal in one line and list what you need from Seth — tokens, files, decisions. The handoff checklist is PRD §12, reproduced live at the end of `docs/SETUP.md`.
