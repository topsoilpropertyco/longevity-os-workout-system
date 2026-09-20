# Drop zone — Knees Over Toes source files

**Put your KOT spreadsheets and links in this folder.** Nothing else needs to happen; the next build session picks them up.

## What to put here

- The **KOT / ATG spreadsheets** themselves — `.xlsx`, `.csv`, Numbers export, whatever form they are in. Multiple files are fine.
- A plain text file of **links** if part of the program lives on the web — name it `links.txt`, one URL per line, with a note about what each one is.
- **Screenshots** of anything that only exists as an image.
- Anything about **your** progress: which step you are on, standards you have already met, dates.

Do not reformat or tidy anything first. Messy is fine — the ingest script and a human both read it, and reformatting loses information.

## What happens when you do

1. `npm run ingest:kot` normalizes what is here into `programs/kot/*.json`: steps, standards as %BW, progressions, equipment substitutions, and the ground-up ordering.
2. Standards get converted into real pounds at your current bodyweight — "25% BW per hand" becomes "51 lb per hand" at 205.
3. Each step is matched to an exercise in the library, and anything unmatched is reported rather than guessed at.
4. Substitutions are generated for Home and Planet Fitness, since neither has a sled and neither has a tib bar. Backward sled becomes backward walking or a powered-off treadmill; the slant board becomes a DIY wedge or plates; the tib bar becomes a dumbbell between the feet or a band.
5. KOT becomes the active program: 2–3 days a week, placed **first** in those sessions, ground-up ordered, with progress tracked toward two full cycles.

Until then the engine plans longevity work without a program slot, which works but is not the point.

## Notes

- **This folder is gitignored.** Your files stay on your machine. Only this README and `.gitkeep` are committed.
- A public scaffold of the KOT structure is in `docs/RESEARCH_FOUNDATION.md` §7. It exists so the ingest script has a shape to aim at, and it will be checked against your sheets — yours win.
- This unblocks Phase 7 (`docs/ROADMAP.md`), and nothing else is waiting on it.
