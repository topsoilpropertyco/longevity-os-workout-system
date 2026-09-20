# Drop zone — old-app history exports

**Put your CSV exports from previous training apps in this folder.** Nothing else needs to happen.

## What to put here

- **Fitbod**, **Strong**, **Hevy** exports — all of them, all the way back. Overlapping date ranges are fine; duplicates are detected.
- Exports from anything else: Ladder, Shred, Gymverse, Ray, Edge Fitness, a spreadsheet you kept, a Notes app list. Formats vary and the importer is generic.
- Old **cardio** history if it exports separately.
- Old **bodyweight / body-fat** history — this improves the trend from day one instead of starting flat.

Keep the original filenames. They often carry the app name and the date range, which helps.

## What happens when you do

1. The importer reads each file and maps its columns onto `(date, exercise, set, reps, weight, unit)`.
2. Exercise names are **fuzzy-matched** to the library. Anything it is not confident about goes to a review screen rather than being guessed — you confirm or correct, and it remembers.
3. Weights are normalized to the **total-load convention** (`docs/decisions/0007-total-load-convention.md`). If an app logged dumbbells per hand, they are doubled on the way in. The review screen shows the normalized number so a doubling error is visible before anything is committed.
4. History seeds **prediction bands** — the normal / probable / max numbers on every set card — and the e1RM trends on the dashboard.
5. It also seeds the **regional load ledger** and ACWR, so the engine knows what your recent weeks actually looked like rather than assuming you started from zero.

Without this, the first two or three weeks of prescriptions are cold-start estimates from program standards. They are safe, and they are conservative. With it, the numbers are yours from the first session.

## Notes

- **This folder is gitignored.** Your training history stays on your machine. Only this README and `.gitkeep` are committed.
- Nothing here is imported automatically. You see a review screen and confirm before a single row is written.
- This feeds the import half of Phase 8 (`docs/ROADMAP.md`).
