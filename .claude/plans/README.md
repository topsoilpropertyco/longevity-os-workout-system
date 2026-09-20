# Plan documents

`plansDirectory` is set to `./.claude/plans` in `.claude/settings.json`, so plan-mode documents are written here, inside the repository, and **survive the session that produced them**.

That is the point. A plan written in a session and lost with it is a plan you write again. Kept here, it is reviewable before the work starts, diffable against what was actually built, and readable in six months when someone asks why a phase went the way it did.

## What lives here

- Phase plans produced in plan mode before a build phase starts.
- Refinements of the eight phases in `docs/ROADMAP.md`.
- Investigation write-ups that are not decisions — a decision goes to `docs/decisions/` as an ADR instead.

Every document gets a **title line** (`CLAUDE.md`). Name files `YYYY-MM-DD-short-slug.md`.

## What does not live here

- Decisions with lasting consequences → `docs/decisions/`.
- Anything Seth needs to act on → `docs/SETUP.md` or a Telegram message. Nobody reads a plans folder on their phone.
- Secrets. Ever. A token pasted into a plan is a committed token.

`*.local.md` in this folder is gitignored, for scratch work that should not be committed.
