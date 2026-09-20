# Longevity OS — Design System

Beautiful, minimal, modern, dark-first. One idea per screen. The app is used one-handed, in a gym, sweating, between sets — so the thing you need next is always the biggest thing on the screen and always within thumb reach.

Nothing here is a default. The typeface pair, the palette, the scales and the motion rules were chosen, and each one has a reason.

---

## 1. Mobile Safari checklist

From `CLAUDE.md`, verbatim. Every screen is checked against this list **on an actual iPhone** before it is called done.

- [ ] `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- [ ] `env(safe-area-inset-*)` padding
- [ ] `height: 100%` on html/body, **never** `100vh`
- [ ] Dark-mode aware via tokens on `:root`
- [ ] Thumb-zone primary actions
- [ ] Tap targets ≥44 px
- [ ] No horizontal page scroll (wide content scrolls inside its own container)
- [ ] Numeric inputs: `inputmode="decimal"`, clear-on-focus for prescribed values
- [ ] PWA manifest + service worker caching today's plan and media thumbnails
- [ ] **Test on an actual iPhone before calling any screen done**

Plus, from PRD §9: today's card interactive in under 1.5 s on LTE, media lazy-loaded, offline read of today's plan, and **zero layout shift on data load** — reserve the space before the data arrives, always.

Why each of these bites on iOS specifically:

- **`100vh` lies.** Safari's toolbars change the visible height as you scroll, so a `100vh` layout is either clipped or bouncing. `height: 100%` on `html`, `body` and the app root, with the scroll container inside, is stable.
- **`viewport-fit=cover` without safe-area padding** puts the primary button under the home indicator, where it cannot be tapped.
- **Anything under 44 px** is a miss with a sweaty thumb, every time.
- **Horizontal page scroll** in an installed PWA feels like a broken app and fights the back-swipe gesture. Wide things — the week carousel, the swap carousel — scroll inside their own overflow container.
- **Without `inputmode="decimal"`** iOS shows the full QWERTY keyboard for a weight field, and logging a set takes four taps instead of two.
- **Without clear-on-focus**, changing a prescribed 85 to 90 means positioning a cursor between two digits with a wet finger.

---

## 2. Typography

**Display — Space Grotesk.** Used for numbers-as-heroes and for the session title: the load on the set card, the countdown on the rest timer, the vertical-jump figure, the tonnage on the summary. It is a grotesque with unusual, slightly mechanical digits and a tight, confident set at large sizes — it reads as *instrument*, which is what those numbers are.

**Text — Geist Sans.** Everything else: the why line, labels, settings, body copy, the bot transcript. High x-height, quiet, excellent at 13–17 px, and it disappears behind what it is saying. It carries the load Space Grotesk should not.

**Numeric — Geist Mono**, tabular, for anything that ticks or aligns in a column: the clock digits, the set log table, the keypad readout. A timer in a proportional face jitters as the digits change; a mono one does not.

All three are open-licence and self-hosted as `woff2` — no third-party font request on the critical path, which matters for the 1.5 s LTE budget.

```css
:root {
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-text:    'Geist Sans', system-ui, -apple-system, sans-serif;
  --font-mono:    'Geist Mono', ui-monospace, 'SF Mono', monospace;

  /* Type scale — 1.25 major third, clamped for the 390–430 px range */
  --t-hero:    clamp(2.75rem, 12vw, 3.5rem);  /* the one number on a set card */
  --t-title:   1.75rem;   /* session title */
  --t-heading: 1.3125rem; /* block headings */
  --t-body:    1.0625rem; /* why line, prose */
  --t-label:   0.9375rem; /* field labels, secondary */
  --t-micro:   0.8125rem; /* units, timestamps, attribution */

  --lh-tight: 1.1;   /* display and numerals */
  --lh-snug:  1.35;  /* headings */
  --lh-body:  1.55;  /* prose */

  --track-display: -0.02em;
  --track-body:     0em;
  --track-micro:    0.01em;
}
```

Rules: never below 13 px, ever. Numerals always `font-variant-numeric: tabular-nums`. One display-weight element per screen — if two things are shouting, neither is heard.

---

## 3. Colour

Dark-first, because the app is opened at 06:00 and in dim gyms. The palette is nearly monochrome with **one** signal colour, so that the single primary action on each screen is the only saturated thing in view.

The accent is **chalk** — the yellow-green of gym chalk, and a nod to the chalk-and-wall vertical test that is the athletic north star. It appears on exactly one element per screen.

Readiness gets its own small ramp, deliberately separate from the semantic colours, so "reduced" never reads as "error".

```css
:root {
  /* ── Surfaces ─────────────────────────────────────────── */
  --bg:            #0C0D10;  /* app background */
  --surface:       #14161A;  /* cards */
  --surface-2:     #1C1F24;  /* raised: sheets, keypad, menus */
  --surface-sunk:  #080A0C;  /* wells: the set-log table, inputs */
  --hairline:      #262A31;  /* 1px dividers */
  --hairline-soft: #1B1E24;

  /* ── Text ─────────────────────────────────────────────── */
  --text:        #ECEEF1;
  --text-muted:  #9BA3AE;
  --text-faint:  #6B7480;   /* units, timestamps, attribution */
  --text-invert: #0C0D10;   /* on accent fills */

  /* ── Accent: chalk. One per screen. ───────────────────── */
  --accent:         #C6F24E;
  --accent-press:   #AFDB37;
  --accent-soft:    #C6F24E1F;  /* 12% wash behind selected states */
  --accent-text:    #C6F24E;    /* accent as foreground on dark */

  /* ── Readiness ramp (its own scale, not the semantics) ── */
  --ready-push:       #C6F24E;  /* ≥85 — go */
  --ready-planned:    #8FA3B0;  /* 70–84 — quiet on purpose */
  --ready-reduced:    #F2B44E;  /* 55–69 */
  --ready-recovery:   #6E8BFF;  /* <55 or HRV −10% */

  /* ── Semantics ────────────────────────────────────────── */
  --danger:   #E5484D;   /* pain rising, destructive */
  --warning:  #F2B44E;   /* ACWR out of band, blocked region */
  --info:     #6E8BFF;
  --success:  #57C98A;   /* set completed, standard met */

  /* ── Elevation. Dark UI leans on hairlines, not shadow. ─ */
  --shadow-sheet: 0 -8px 32px rgb(0 0 0 / 0.55);
  --shadow-float: 0 4px 16px rgb(0 0 0 / 0.40);
}

/* Light mode: warm paper, not inverted grey. Same hierarchy, same one accent. */
@media (prefers-color-scheme: light) {
  :root:not([data-theme='dark']) {
    --bg:            #FAFAF7;
    --surface:       #FFFFFF;
    --surface-2:     #F4F4EF;
    --surface-sunk:  #EFEFE9;
    --hairline:      #E3E3DB;
    --hairline-soft: #EDEDE6;

    --text:        #16181C;
    --text-muted:  #5B636E;
    --text-faint:  #858D98;
    --text-invert: #16181C;   /* chalk fills still take dark text */

    --accent:       #C2ED45;  /* fill — dark text on top */
    --accent-press: #A7D22C;
    --accent-soft:  #C2ED4533;
    --accent-text:  #55700A;  /* foreground use needs the darker value for contrast */

    --ready-push:     #55700A;
    --ready-planned:  #5B636E;
    --ready-reduced:  #A5670A;
    --ready-recovery: #3A54C4;

    --danger:  #C22B30;
    --warning: #A5670A;
    --info:    #3A54C4;
    --success: #1F7F4E;

    --shadow-sheet: 0 -8px 32px rgb(16 18 22 / 0.12);
    --shadow-float: 0 4px 16px rgb(16 18 22 / 0.10);
  }
}

/* Explicit override from settings wins over the OS. */
:root[data-theme='dark']  { color-scheme: dark; }
:root[data-theme='light'] { color-scheme: light; }
```

Rules:
- **One accent element per screen.** If Start is chalk, nothing else is.
- Body text hits WCAG AA against its surface in both themes; `--text-faint` is for non-essential metadata only.
- Colour never carries meaning alone — readiness shows a word as well as a hue, blocked regions show a reason as well as amber.
- Media thumbnails sit on `--surface-sunk` so a transparent GIF never floats on nothing.

---

## 4. Spacing, radius, layout

```css
:root {
  --sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;  --sp-4: 16px;
  --sp-5: 20px;  --sp-6: 24px;  --sp-7: 32px;  --sp-8: 40px;
  --sp-9: 56px;  --sp-10: 72px;

  --r-sm:   8px;   /* chips, inputs */
  --r-md:   12px;  /* buttons, list rows */
  --r-lg:   16px;  /* cards */
  --r-xl:   24px;  /* sheets, the today card */
  --r-full: 999px; /* pills, the timer ring, avatars */

  --gutter: var(--sp-4);              /* 16px page gutter, always */
  --tap:    44px;                     /* the floor, not the target */
  --tap-comfortable: 52px;            /* what runtime controls actually use */
  --safe-top:    env(safe-area-inset-top);
  --safe-bottom: env(safe-area-inset-bottom);
  --thumb-bar:   calc(var(--sp-6) + var(--safe-bottom)); /* primary action rail */
}

html, body, #app { height: 100%; }   /* never 100vh */
body { background: var(--bg); color: var(--text); overflow-x: hidden; }
```

Layout skeleton: a fixed header of `--safe-top` plus 56 px, a scrolling body with `--gutter` sides, and a bottom action rail padded by `--thumb-bar`. The primary action lives in that rail, at the bottom, where the thumb already is. Secondary actions go up top or inside the scroll — never side by side with the primary at equal weight.

---

## 5. Motion

Motion communicates state. It never decorates.

```css
:root {
  --dur-instant: 90ms;    /* press feedback */
  --dur-quick:   160ms;   /* state change, tab, toggle */
  --dur-move:    240ms;   /* sheet in, card transition */
  --ease-out:    cubic-bezier(0.22, 0.61, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.32, 0.64, 1);  /* set completion only */
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
}
```

Where motion is allowed:
- **Set completed** — the row settles with `--ease-spring` and the rest timer ring starts. This is the app's one moment of delight, and it is earned.
- **Rest timer** — a ring that depletes. The state *is* the animation.
- **Swap** — the carousel card slides in and the session's estimated minutes tick to their new value, so the cost of the swap is visible.
- **Sheet in / out** — from the bottom edge, `--dur-move`.
- **Why line upgrading** from template to LLM copy — a 160 ms cross-fade, so the change is noticed but does not interrupt.

Where it is banned: page loads, list appearance, numbers counting up for their own sake, anything on the today card's first paint. First paint is instant or it is broken.

Haptics pair with sound on clocks: a light tick on the last three seconds, a heavier one at zero, and the screen stays awake for the whole session.

---

## 6. One idea per screen

Each screen answers one question, and the answer is the biggest thing on it.

| Screen | The one question |
| --- | --- |
| Today | What am I doing? |
| Week | What does the rest of the week look like? |
| Runtime | What is this set? |
| Swap | What else could this be? |
| Clocks | How long? |
| Dashboard | Is this working? |
| Settings | Change one thing. |

If a screen needs a second idea, it needs a sheet or a second screen.

---

## 7. Screens

References pulled from Mobbin (RESEARCH §9): **Fitbod** — equipment picker, swap carousel, prediction presentation; **Ladder** — session runtime pacing and the one-big-action layout; **Shred** — dark-first density and weekly plan carousel; **Gymverse** — exercise library and media treatment; **Ray AI Trainer** — conversational surfaces and daily brief. Also named in the research: Edge Fitness, Six Pack in 30 Days, Home Workout No Equipment. Pull specifically: onboarding equipment selection, active-set logging screens, exercise swap sheets, weekly plan carousels, progress dashboards.

### Today card

```
┌─────────────────────────────────────┐
│ ▸ safe-area top                     │
│  TUESDAY                  ● 72      │  Space Grotesk micro label · readiness
│  Sep 23                as planned   │  dot in --ready-planned
├─────────────────────────────────────┤
│                                     │
│  Upper Strength                     │  --t-title, display
│  30 min · Home                      │  --t-label, muted
│                                     │
│  "Your knees need one more day      │  --t-body. The why line.
│   after Sunday's KOT — upper        │  Never truncated. It is the product.
│   strength is where the week        │
│   is short."                        │
│                                     │
│  ┌───────┬───────┬───────┐          │
│  │ Press │ Pull  │ Core  │          │  Block chips, --r-full, hairline
│  └───────┴───────┴───────┘          │
├─────────────────────────────────────┤
│  ○ ○ ● ○ ○ ○ ○     week  ›          │  Week strip: 7 dots, today filled
├─────────────────────────────────────┤
│  [  Start  ]                        │  Chalk, full width, --tap-comfortable
│  30 min instead ·  Home instead     │  Text buttons, muted
│ ▸ safe-area bottom                  │
└─────────────────────────────────────┘
```

If Oura is missing, a three-slider row sits above the why line: soreness, energy, stress, five taps each, and the why line says it is planning from them.

### Week carousel

Horizontally scrolling cards inside their own overflow container — the page itself never scrolls sideways. Today is first and full width; the next six are peeked at ~80%. Each card: day, type, minutes, location, one-line why. Tapping a future day opens it read-only with **"Do this today instead"**. Taking that re-solves the week server-side and shows a one-line diff — *"Thursday's VO2 moves to Friday; Zone 2 drops 15 min"* — before it commits. Projected days are visibly quieter than today: muted text, no accent, a small "projected" tag.

### Session runtime

```
┌─────────────────────────────────────┐
│  ‹  Upper Strength        2 of 5    │  progress, not a back-heavy header
├─────────────────────────────────────┤
│      ┌───────────────────┐          │
│      │    GIF / loop     │          │  lazy, thumb first, --surface-sunk
│      └───────────────────┘          │
│  Incline Dumbbell Press             │  --t-heading
│  why ⌄                              │  tap to expand one line
├─────────────────────────────────────┤
│                                     │
│        85            × 12           │  --t-hero, display, tabular
│        lb             reps          │  tap either → clears → keypad
│                                     │
│  normal 80–90 · probable 85 · max 100│ --t-micro, faint
├─────────────────────────────────────┤
│  1  85 × 12  ✓                      │  logged sets, mono, --surface-sunk
│  2  85 × 12  ✓                      │
│  3  ——                              │  current row, accent hairline
├─────────────────────────────────────┤
│  RPE  6 7 8 9 10                    │  optional, 44px each, off by default
│  [ Complete set ]      ⇄ swap       │  chalk primary in the thumb rail
└─────────────────────────────────────┘
```

Completing a set starts the rest countdown as a ring around the button, which becomes **Next set** at zero. Keypad is a custom numeric pad on `--surface-2`, not the OS keyboard — big digits, a decimal key, and one **Clear**; the field clears on focus so a prescribed value is replaced rather than edited.

### Swap carousel

A bottom sheet, `--r-xl`, `--shadow-sheet`. Horizontal cards, each with a thumbnail, a name, a **Same / Easier / Harder** pill, and one line of reason — *"same pattern, less knee load"*. Filtered to the location's equipment; ranked by pattern match, region and equipment fit. Beneath the carousel, a single line shows the effect on the session: *"29 → 31 min"*. One tap replaces and returns. There is no confirm step; the back gesture undoes it.

### Clocks

Full-bleed, one clock at a time, the digits in Geist Mono at `--t-hero` scale. Rest countdown, EMOM, AMRAP, interval/Tabata, for-time stopwatch. The ring is the progress; the digits are the detail. Audible plus haptic at the last three seconds and at zero, screen kept awake, and the current interval's label ("work" / "rest", round 3 of 8) directly under the digits. Nothing else on screen.

### Dashboard

Fixed top row, two columns of tiles, each tile one number with a sparkline and a direction: Zone 2 min/week · sessions this week + streak · weekly tonnage · Oura VO2max and cardiovascular age · vertical (latest / baseline) · weight and body-fat trend · knee and back pain trend. Below the fold, **Explore** as a list rather than a wall of charts: per-exercise e1RM with plateau detection, PR feed, weekly minutes by bucket, readiness vs performance overlay, program progress, zone distribution, ACWR gauges. Each opens full screen. The weekly summary card at the bottom mirrors the Sunday bot report word for word.

### Settings

A plain grouped list, one idea per row, nothing clever. Goal mode (four primary buttons, "More" discloses the other six) · warm-up/cooldown defaults · units · HRmax and zones (with the precedence chain shown and an override) · bar weights per location · bot schedule · integrations (Oura, Strava, Telegram — each with a live status dot and the worker's last-seen time) · data export (CSV / JSON) · **credits**. The total-load convention is explained here in one paragraph, and once inline the first time he logs a dumbbell set.

### Locations

List of locations with the sticky one marked. Each opens a checklist over the equipment catalog, grouped by category, every item tappable with an image and notes ("Smith bar 20 lb", "DBs to 75"). Presets to clone: **Home** (seeded), **Planet Fitness — standard**, **CrossFit box — typical**, **Bodyweight only**. Per-location fields for bar weight and Smith bar weight sit at the top, because on a Planet Fitness Smith bar the effective weight is ≈15–20 lb and getting it wrong corrupts every tonnage number downstream.

### Programs

Active program at the top: **Knees Over Toes**, cycle 1 of 2, a progress ring, and the current step. Below it the step list in program order — ground-up for KOT — each row showing the standard in Seth's terms ("25% BW per hand × 5 each side" = 51 lb per hand at 205 lb), with met steps ticked and dated. Tapping a step shows the movement, its substitutions for the current location, and the evidence that it was met. A quiet row at the bottom offers to swap the active program.

### Injuries

Two seeded entries: knees, low back. Each row shows region, current pain as a 0–10 dot scale, and the trend since onset. Opening one shows onset, type (recent / longstanding), aggravators, notes, the check-in history as a sparkline, and what the engine is currently doing about it — *"KOT is your knee pathway; a 2-point pain rise in 24 h regresses you one step."* Weekly check-in is a single slider plus optional text, and it arrives via the bot. **Nothing here disappears on its own** — resolving an injury is an explicit action with a date.
