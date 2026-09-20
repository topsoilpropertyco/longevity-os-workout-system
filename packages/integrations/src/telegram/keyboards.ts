/**
 * Inline keyboards for the bot (PRD §8.8).
 *
 * ── THE CALLBACK-DATA BUDGET ─────────────────────────────────────────────────
 * Telegram caps `callback_data` at **64 BYTES** (UTF-8 bytes, not characters).
 * Exceed it and `sendMessage` is rejected outright — the whole daily brief
 * fails to send, not just the button. So the scheme is deliberately terse:
 *
 *     v ~ op [ ~ arg ]*
 *
 *   - `v`   schema version, currently `1`. Bump it if the grammar changes; the
 *           router ignores versions it does not know rather than misreading an
 *           old button someone scrolled back to and tapped.
 *   - `~`   separator. Chosen because it never appears in our ids or dates.
 *   - `op`  1–3 character opcode, from `CB_OPS` below.
 *   - args  positional, opcode-specific, no names.
 *
 * Dates are `YYMMDD` (6 bytes), never ISO with dashes (10 bytes). Ids are
 * truncated to 8 characters — enough to disambiguate one athlete's injuries,
 * and the server re-resolves the full id anyway.
 *
 * A full button is around 12–20 bytes, so there is deep headroom. `encodeCb`
 * still measures every payload and returns `null` past 64, and the builders
 * drop any button that would not fit rather than sending an invalid keyboard.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { InlineKeyboardButton, InlineKeyboardMarkup } from './client.js';

/** Current callback-data grammar version. */
export const CB_VERSION = '1';
/** Field separator. Must never occur inside an argument. */
export const CB_SEP = '~';
/** Telegram's hard limit, in UTF-8 bytes. */
export const CB_MAX_BYTES = 64;

/**
 * Every opcode the bot emits. Keep them short and never reuse one for a new
 * meaning — old messages stay tappable forever.
 */
export const CB_OPS = {
  /** Start today's session as prescribed. args: date */
  START: 'st',
  /** Re-plan for a smaller budget. args: date, minutes */
  BUDGET: 'bu',
  /** Re-plan at another location. args: date, locationId(8) */
  LOCATION: 'lo',
  /** Skip today. args: date */
  SKIP: 'sk',
  /** 1–5 self-report slider. args: date, metric(1 char), value */
  SLIDER: 'sl',
  /** Weekly injury check-in pain score. args: date, injuryId(8), pain(0–10) */
  INJURY: 'ij',
  /** Injury resolved. args: date, injuryId(8) */
  INJURY_CLEAR: 'ic',
  /** Weekly scale prompt. args: date, choice */
  SCALE: 'wt',
  /** Swap an exercise. args: date, exerciseId(8), direction */
  SWAP: 'sw',
  /** Show the "why" in full. args: date */
  WHY: 'wy',
  /** Dismiss / no-op acknowledgement. args: none */
  DISMISS: 'xx',
} as const;

export type CbOp = (typeof CB_OPS)[keyof typeof CB_OPS];

/** Slider metrics, one character each, to keep the payload small. */
export const SLIDER_METRICS = {
  soreness: 's',
  energy: 'e',
  stress: 'x',
} as const;
export type SliderMetric = keyof typeof SLIDER_METRICS;
const METRIC_FROM_CODE: Record<string, SliderMetric> = { s: 'soreness', e: 'energy', x: 'stress' };

/** Scale-prompt choices. */
export const SCALE_CHOICES = { type: 't', photo: 'p', skip: 's' } as const;
export type ScaleChoice = keyof typeof SCALE_CHOICES;
const SCALE_FROM_CODE: Record<string, ScaleChoice> = { t: 'type', p: 'photo', s: 'skip' };

/** A decoded callback payload. */
export interface DecodedCallback {
  version: string;
  op: string;
  args: string[];
}

/** UTF-8 byte length, which is what Telegram actually measures. */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Build a callback payload. Returns `null` if it would exceed 64 bytes, so the
 * caller drops the button instead of poisoning the whole keyboard.
 */
export function encodeCb(op: CbOp | string, ...args: (string | number)[]): string | null {
  const payload = [CB_VERSION, op, ...args.map((a) => String(a))].join(CB_SEP);
  if (payload.includes('\n')) return null;
  return byteLength(payload) <= CB_MAX_BYTES ? payload : null;
}

/**
 * Parse a callback payload back into `{ version, op, args }`.
 * Returns `null` for anything that is not our grammar — including buttons from
 * a future schema version, which must be ignored, not guessed at.
 */
export function decodeCb(data: string | undefined | null): DecodedCallback | null {
  if (!data) return null;
  const parts = data.split(CB_SEP);
  if (parts.length < 2) return null;
  const [version, op, ...args] = parts;
  if (!version || !op) return null;
  if (version !== CB_VERSION) return null;
  return { version, op, args };
}

/** ISO `YYYY-MM-DD` → the compact `YYMMDD` used in payloads. */
export function packDate(isoDate: string): string {
  return isoDate.replace(/-/g, '').slice(2);
}

/** `YYMMDD` → ISO `YYYY-MM-DD`. Assumes the 2000s, which outlives this app. */
export function unpackDate(packed: string): string {
  if (!/^\d{6}$/.test(packed)) return packed;
  return `20${packed.slice(0, 2)}-${packed.slice(2, 4)}-${packed.slice(4, 6)}`;
}

/**
 * Truncate an id for callback data; the server re-resolves the full one by
 * prefix. 16 characters, not 8: `inj_knee_left_01` and `inj_knee_right_01`
 * collide at 8, and booking a left-knee pain score against the right knee is
 * exactly the kind of silent wrong answer this app must not produce. 16 still
 * leaves roughly 30 bytes of headroom inside the 64-byte cap.
 *
 * Resolve the prefix against the CURRENT day's plan or open injuries, and if
 * two candidates share it, ask rather than guess.
 */
export function shortId(id: string, len = 16): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, len);
}

/** Drop any button whose callback data failed to encode. */
function row(...buttons: (InlineKeyboardButton | null)[]): InlineKeyboardButton[] {
  return buttons.filter((b): b is InlineKeyboardButton => b !== null);
}

/** Build a button, or `null` when the payload does not fit. */
function btn(text: string, data: string | null): InlineKeyboardButton | null {
  return data === null ? null : { text, callback_data: data };
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyboards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 06:30 daily brief: **Start · 20 min instead · Home instead · Skip**.
 *
 * Two rows so the primary action owns its own full-width tap target — the brief
 * is read one-handed and Start must be unmissable (CLAUDE.md: never make Seth
 * think). `homeLocationId` is optional; without it the Home button is omitted
 * rather than guessed at.
 */
export function dailyBriefKeyboard(opts: {
  date: string;
  homeLocationId?: string;
  /** Defaults to 20, per the PRD's "20 min instead". */
  shortBudgetMin?: number;
}): InlineKeyboardMarkup {
  const d = packDate(opts.date);
  const short = opts.shortBudgetMin ?? 20;
  return {
    inline_keyboard: [
      row(btn('▶️ Start', encodeCb(CB_OPS.START, d))),
      row(
        btn(`⏱ ${short} min instead`, encodeCb(CB_OPS.BUDGET, d, short)),
        opts.homeLocationId
          ? btn('🏠 Home instead', encodeCb(CB_OPS.LOCATION, d, shortId(opts.homeLocationId)))
          : null,
      ),
      row(btn('⤼ Why?', encodeCb(CB_OPS.WHY, d)), btn('Skip today', encodeCb(CB_OPS.SKIP, d))),
    ].filter((r) => r.length > 0),
  };
}

/** Human labels for each slider value. 1 is always the bad end. */
export const SLIDER_LABELS: Record<SliderMetric, [string, string, string, string, string]> = {
  soreness: ['1 wrecked', '2 sore', '3 ok', '4 good', '5 fresh'],
  energy: ['1 flat', '2 low', '3 ok', '4 good', '5 wired'],
  // Higher stress is WORSE — the labels have to make that obvious, because the
  // number reads the opposite way to the other two sliders.
  stress: ['1 calm', '2 fine', '3 ok', '4 tense', '5 maxed'],
};

/**
 * One 1–5 slider as a row of five buttons. This is the no-Oura fallback path
 * (CLAUDE.md invariant 2), so it has to be as fast as a single tap.
 */
export function sliderKeyboard(opts: {
  date: string;
  metric: SliderMetric;
}): InlineKeyboardMarkup {
  const d = packDate(opts.date);
  const code = SLIDER_METRICS[opts.metric];
  const labels = SLIDER_LABELS[opts.metric];
  return {
    inline_keyboard: [
      row(
        ...([1, 2, 3, 4, 5] as const).map((v) =>
          btn(labels[v - 1] ?? String(v), encodeCb(CB_OPS.SLIDER, d, code, v)),
        ),
      ),
    ],
  };
}

/** All three sliders stacked, each on its own row, for one message. */
export function allSlidersKeyboard(date: string): InlineKeyboardMarkup {
  const d = packDate(date);
  const rows: InlineKeyboardButton[][] = [];
  for (const metric of ['soreness', 'energy', 'stress'] as SliderMetric[]) {
    const code = SLIDER_METRICS[metric];
    rows.push(
      row(
        ...([1, 2, 3, 4, 5] as const).map((v) =>
          btn(`${metric[0]?.toUpperCase()}${v}`, encodeCb(CB_OPS.SLIDER, d, code, v)),
        ),
      ),
    );
  }
  return { inline_keyboard: rows };
}

/**
 * Weekly injury check-in: pain 0–10, plus a "gone" button.
 *
 * Laid out 0–5 / 6–10 so every target stays ≥44 px wide on an iPhone. A ≥2
 * point rise regresses the KOT step (RESEARCH §6.3), so the number matters and
 * must be easy to tap accurately.
 */
export function injuryCheckinKeyboard(opts: {
  date: string;
  injuryId: string;
  /** Show the "resolved" escape hatch. Injuries never disappear on their own. */
  allowResolve?: boolean;
}): InlineKeyboardMarkup {
  const d = packDate(opts.date);
  const id = shortId(opts.injuryId);
  const mk = (v: number): InlineKeyboardButton | null =>
    btn(String(v), encodeCb(CB_OPS.INJURY, d, id, v));
  const rows: InlineKeyboardButton[][] = [
    row(mk(0), mk(1), mk(2), mk(3), mk(4), mk(5)),
    row(mk(6), mk(7), mk(8), mk(9), mk(10)),
  ];
  if (opts.allowResolve !== false) {
    rows.push(row(btn('✓ It’s gone', encodeCb(CB_OPS.INJURY_CLEAR, d, id))));
  }
  return { inline_keyboard: rows };
}

/**
 * Weekly scale prompt. The Wyze scale has no public API (RESEARCH §8), so this
 * is the whole integration: type it, photograph it, or say not now.
 */
export function scalePromptKeyboard(date: string): InlineKeyboardMarkup {
  const d = packDate(date);
  return {
    inline_keyboard: [
      row(
        btn('⌨️ Type it', encodeCb(CB_OPS.SCALE, d, SCALE_CHOICES.type)),
        btn('📷 Send a photo', encodeCb(CB_OPS.SCALE, d, SCALE_CHOICES.photo)),
      ),
      row(btn('Not now', encodeCb(CB_OPS.SCALE, d, SCALE_CHOICES.skip))),
    ],
  };
}

/** Easier / same / harder swap row for one prescribed exercise. */
export function swapKeyboard(opts: {
  date: string;
  exerciseId: string;
}): InlineKeyboardMarkup {
  const d = packDate(opts.date);
  const id = shortId(opts.exerciseId);
  return {
    inline_keyboard: [
      row(
        btn('↓ Easier', encodeCb(CB_OPS.SWAP, d, id, 'e')),
        btn('↔ Same', encodeCb(CB_OPS.SWAP, d, id, 's')),
        btn('↑ Harder', encodeCb(CB_OPS.SWAP, d, id, 'h')),
      ),
    ],
  };
}

/** The budget row on its own, for "how long have you got?" replies. */
export function budgetKeyboard(date: string, budgets: readonly number[] = [15, 20, 30, 45, 60, 90]): InlineKeyboardMarkup {
  const d = packDate(date);
  const buttons = budgets.map((m) => btn(`${m}`, encodeCb(CB_OPS.BUDGET, d, m)));
  return {
    inline_keyboard: [row(...buttons.slice(0, 3)), row(...buttons.slice(3))].filter(
      (r) => r.length > 0,
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Decoding into intents
// ─────────────────────────────────────────────────────────────────────────────

/** A decoded button tap, ready to hand to the engine. */
export type CallbackIntent =
  | { kind: 'start'; date: string }
  | { kind: 'set_budget'; date: string; minutes: number }
  | { kind: 'set_location'; date: string; locationId: string }
  | { kind: 'skip'; date: string }
  | { kind: 'slider'; date: string; metric: SliderMetric; value: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'injury_pain'; date: string; injuryId: string; pain: number }
  | { kind: 'injury_resolved'; date: string; injuryId: string }
  | { kind: 'scale'; date: string; choice: ScaleChoice }
  | { kind: 'swap'; date: string; exerciseId: string; direction: 'easier' | 'same' | 'harder' }
  | { kind: 'why'; date: string }
  | { kind: 'dismiss' };

/**
 * Turn raw `callback_data` into a typed intent, or `null` when it is not ours.
 * Note the ids are the TRUNCATED forms — resolve them against the day's plan.
 */
export function parseCallbackData(data: string | undefined | null): CallbackIntent | null {
  const decoded = decodeCb(data);
  if (!decoded) return null;
  const [a, b, c] = decoded.args;
  const date = a ? unpackDate(a) : '';

  switch (decoded.op) {
    case CB_OPS.START:
      return date ? { kind: 'start', date } : null;
    case CB_OPS.BUDGET: {
      const minutes = Number(b);
      return date && Number.isFinite(minutes) && minutes > 0
        ? { kind: 'set_budget', date, minutes }
        : null;
    }
    case CB_OPS.LOCATION:
      return date && b ? { kind: 'set_location', date, locationId: b } : null;
    case CB_OPS.SKIP:
      return date ? { kind: 'skip', date } : null;
    case CB_OPS.SLIDER: {
      const metric = b ? METRIC_FROM_CODE[b] : undefined;
      const value = Number(c);
      return date && metric && value >= 1 && value <= 5
        ? { kind: 'slider', date, metric, value: value as 1 | 2 | 3 | 4 | 5 }
        : null;
    }
    case CB_OPS.INJURY: {
      const pain = Number(c);
      return date && b && Number.isFinite(pain) && pain >= 0 && pain <= 10
        ? { kind: 'injury_pain', date, injuryId: b, pain }
        : null;
    }
    case CB_OPS.INJURY_CLEAR:
      return date && b ? { kind: 'injury_resolved', date, injuryId: b } : null;
    case CB_OPS.SCALE: {
      const choice = b ? SCALE_FROM_CODE[b] : undefined;
      return date && choice ? { kind: 'scale', date, choice } : null;
    }
    case CB_OPS.SWAP: {
      const dir = c === 'e' ? 'easier' : c === 'h' ? 'harder' : c === 's' ? 'same' : undefined;
      return date && b && dir ? { kind: 'swap', date, exerciseId: b, direction: dir } : null;
    }
    case CB_OPS.WHY:
      return date ? { kind: 'why', date } : null;
    case CB_OPS.DISMISS:
      return { kind: 'dismiss' };
    default:
      return null;
  }
}
