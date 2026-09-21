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

> **This section describes what is in `apps/web/src/app/globals.css` and
> `layout.tsx` today.** An earlier draft proposed Space Grotesk / Geist; the
> build shipped Archivo / Inter, self-hosted through `next/font`, and the doc
> now follows the code rather than the other way round. If you change one,
> change both — a design doc that disagrees with the stylesheet is worse than no
> design doc.

**Display — Archivo.** The session title, the readiness number, the load on a
set card, the clock digits, the tonnage. A grotesque with a tight, confident set
at large sizes and, crucially, **tabular figures**: a timer in a proportional
face jitters as the digits change, and a rest countdown that shifts sideways
every second is a small, constant irritation. Loaded with `next/font/google`, so
it is self-hosted and there is no third-party request on first paint.

**Text — Inter.** Everything else: the why line, labels, settings, body copy,
the bot transcript. High x-height, quiet at 13–17 px, and it disappears behind
what it is saying.

**No separate mono face.** Numerals are handled by
`font-variant-numeric: tabular-nums` and `font-feature-settings: "tnum" 1`,
applied globally to `.num`, `button` and `input`. That gets column alignment and
non-jittering clocks out of the two faces already loaded, rather than paying for
a third.

### The tokens, as shipped

```css
:root {
  --font-display: var(--font-archivo), 'Archivo', ui-sans-serif, system-ui, sans-serif;
  --font-sans:    var(--font-inter),   'Inter',   ui-sans-serif, system-ui, -apple-system, sans-serif;
}
```

Sizes are Tailwind's scale plus a handful of arbitrary values where the scale did
not have the right step — `text-[1.75rem]` for the session title,
`text-[0.9375rem]` for the why line, `text-[0.6875rem]` for the uppercase
`.label`. The floor is 11 px and it is used only for the tracked-out uppercase
labels; nothing that has to be READ goes below 13 px.

Rules: numerals always tabular. One display-weight element per screen — if two
things are shouting, neither is heard.

## 3. Colour

> **Source of truth: `apps/web/src/app/globals.css`.** The values below are
> copied from it. Light sits on `:root`, dark is redefined under
> `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`
> AND under `:root[data-theme="dark"]`, so a Settings override beats the OS.

```css
/* light — :root */
--bg: #f6f5f2;  --surface: #ffffff;  --surface-2: #efeee9;  --line: #e0ded7;
--ink: #16171a; --ink-2: #4d5159;    --ink-3: #7d828c;
--accent: #c2410c;  --accent-ink: #ffffff;  --accent-soft: rgba(194,65,12,0.12);
--good: #0f7a52;  --warn: #9a6400;  --bad: #b23a37;  --info: #1d5fb5;
--s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4;

/* dark */
--bg: #0b0c0e;  --surface: #131519;  --surface-2: #1b1e24;  --line: #262a31;
--ink: #f3f4f6; --ink-2: #a8aeba;    --ink-3: #737a86;
--accent: #ff6b3d;  --accent-ink: #14120f;  --accent-soft: rgba(255,107,61,0.14);
--good: #3ddc97;  --warn: #f2b134;  --bad: #f2706d;  --info: #63a8ff;
--s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181;

--nav-h: 4.25rem;  --radius: 1.25rem;
```

Nearly monochrome with **one** signal colour, so the single primary action on a
screen is the only saturated thing in view. `--s1`…`--s5` are the categorical
chart slots, in validated order; charts also carry legends and direct labels, so
nothing reads by hue alone.

**A naming trap, recorded because it cost real time.** The Tailwind theme
defines a `nav` spacing key (`nav: 'var(--nav-h)'`), which makes Tailwind emit a
utility `.bottom-nav { bottom: var(--nav-h) }`. A component class of the same
name loses to it, because utilities are emitted after components — the fixed nav
silently rendered 68 px too high, directly on top of the Start button. The nav
class is therefore `.app-nav`. Do not name a component class `{property}-{key}`
for any key in the theme.

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
│  TUESDAY                  ● 72      │  Archivo micro label · readiness
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
│        85            × 12           │  display face, tabular figures
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

Full-bleed, one clock at a time, the digits in Archivo with tabular figures, at display scale. Rest countdown, EMOM, AMRAP, interval/Tabata, for-time stopwatch. The ring is the progress; the digits are the detail. Audible plus haptic at the last three seconds and at zero, screen kept awake, and the current interval's label ("work" / "rest", round 3 of 8) directly under the digits. Nothing else on screen.

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
