/**
 * Longevity OS — Engine Utilities
 *
 * Pure helpers. No I/O, no Date.now() outside `todayFrom`, no randomness that
 * is not seeded. The engine must be reproducible: identical inputs, identical
 * plan, every time.
 */

/** Clamp `n` into [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Round to `dp` decimal places, avoiding float dust like 0.30000000000000004. */
export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

/** Linear-interpolated percentile, the same convention numpy uses. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = clamp(p, 0, 1) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo] ?? 0;
  const w = idx - lo;
  return (s[lo] ?? 0) * (1 - w) + (s[hi] ?? 0) * w;
}

/** Interquartile range as [q1, q3]. */
export function iqr(xs: number[]): [number, number] {
  return [percentile(xs, 0.25), percentile(xs, 0.75)];
}

/** Ordinary least squares slope and intercept over (index, value) pairs. */
export function linearTrend(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const xs = ys.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    num += dx * ((ys[i] ?? 0) - my);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

// ─── dates ───────────────────────────────────────────────────────────────────

/** Parse `YYYY-MM-DD` as a UTC midnight instant. Timezone-stable by construction. */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

export function hoursBetween(a: string, b: string): number {
  return daysBetween(a, b) * 24;
}

/** 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay`. */
export function dayOfWeek(iso: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return parseDate(iso).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** Inclusive of `from`, exclusive of `to`. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The last `n` days ending at and including `today`, oldest first. */
export function lastNDays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, -(n - 1 - i)));
}

/** True when `date` falls in the `days`-day window ending at and including `today`. */
export function withinDays(date: string, today: string, days: number): boolean {
  const delta = daysBetween(date, today);
  return delta >= 0 && delta < days;
}

// ─── deterministic randomness ────────────────────────────────────────────────

/**
 * Mulberry32. Seeded so that tie-breaking is stable: the same plan input always
 * produces the same plan, which is what makes the fixtures meaningful.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a. Used for the plan signature, so re-plans can be diffed cheaply. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Stable stringify: object keys sorted, so the hash does not depend on key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

// ─── loads ───────────────────────────────────────────────────────────────────

/**
 * Round a prescribed load to something that actually exists on the rack.
 * `increment` is the smallest step available; `min`/`max` bound the equipment.
 * Returns 0 when no load is achievable, which the caller must treat as bodyweight.
 */
export function roundToIncrement(load: number, increment: number, min = 0, max = Infinity): number {
  if (increment <= 0) return round(clamp(load, min, max), 1);
  const stepped = Math.round(load / increment) * increment;
  return round(clamp(stepped, min, max), 2);
}

/** Group an array by a key, preserving insertion order within each group. */
export function groupBy<T, K extends string | number>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const bucket = out.get(k);
    if (bucket) bucket.push(x);
    else out.set(k, [x]);
  }
  return out;
}

/** Stable sort by a numeric score, descending, with a tie-break key. */
export function rankBy<T>(xs: T[], score: (x: T) => number, tieBreak: (x: T) => string): T[] {
  return [...xs].sort((a, b) => {
    const d = score(b) - score(a);
    if (Math.abs(d) > 1e-9) return d;
    const ta = tieBreak(a);
    const tb = tieBreak(b);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

export function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Title-case a slug for display: `atg-split-squat` → `ATG Split Squat`. */
export function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => (w.length <= 3 && w === w.toLowerCase() && /^[a-z]+$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
