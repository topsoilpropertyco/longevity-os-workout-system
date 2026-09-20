# Architecture Decision Records

One file per decision. Format: **Context / Decision / Consequences**, plus **what would change our mind** — because a decision without a reversal condition is a belief.

| # | Decision | Source |
| --- | --- | --- |
| [0001](0001-app-router-server-actions.md) | App Router with server actions; route handlers only for external callers | PRD §13 |
| [0002](0002-worker-poll-vs-realtime.md) | The mini worker polls `llm_jobs` every 15 seconds | PRD §13 |
| [0003](0003-week-carousel-server-resolve.md) | Week-carousel re-solve runs server-side, with optimistic UI | PRD §13 |
| [0004](0004-hrmax-precedence.md) | HRmax precedence: measured Strava (90 d) > Oura > 220 − age | PRD §13 |
| [0005](0005-one-set-parked.md) | "One set" stays parked | PRD §13 |
| [0006](0006-deterministic-pure-engine.md) | The rules engine is deterministic and pure | Invariant 1 |
| [0007](0007-total-load-convention.md) | Weight is always total load | PRD §8.2 |
| [0008](0008-pounds-and-miles.md) | Store pounds and miles | CLAUDE.md |
| [0009](0009-rls-from-first-migration.md) | RLS on from the first migration, for one user | PRD §9 |
| [0010](0010-mac-mini-outbound-only.md) | The Mac mini is outbound-only | Invariant 3 |

0001–0005 take the defaults the PRD states, explicitly and on the record. Adding one: next number, same format, same four sections.
