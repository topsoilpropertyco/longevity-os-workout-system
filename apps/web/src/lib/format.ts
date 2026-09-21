/** Display formatting. Pounds and miles, always — units are display-only (PRD §8.11). */

export function lb(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  const n = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return opts.compact ? `${n}` : `${n} lb`;
}

export function tonnage(value: number): string {
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k lb`;
  return `${Math.round(value).toLocaleString('en-US')} lb`;
}

export function miles(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(2)} mi`;
}

export function minutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const m = Math.round(value);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} hr` : `${h} hr ${rest} min`;
}

/** mm:ss for clocks. Handles > 1 hour as h:mm:ss. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mm = String(mins).padStart(hrs > 0 ? 2 : 1, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Centiseconds stopwatch, mm:ss.cs */
export function stopwatch(ms: number): string {
  const total = Math.max(0, ms);
  const mins = Math.floor(total / 60000);
  const secs = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Parse an ISO `YYYY-MM-DD` as a LOCAL date — `new Date('2026-09-20')` is UTC and drifts. */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map((n) => Number(n));
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function weekdayShort(iso: string): string {
  return WEEKDAYS[parseIsoDate(iso).getDay()] ?? '';
}

export function dayNumber(iso: string): string {
  return String(parseIsoDate(iso).getDate());
}

export function longDate(iso: string): string {
  const d = parseIsoDate(iso);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Today" / "Tomorrow" / "Thu" — the shortest true thing. */
export function relativeDay(iso: string, todayIso: string): string {
  if (iso === todayIso) return 'Today';
  if (iso === addDays(todayIso, 1)) return 'Tomorrow';
  return weekdayShort(iso);
}

export function ago(iso: string, todayIso: string): string {
  const diff = Math.round(
    (parseIsoDate(todayIso).getTime() - parseIsoDate(iso).getTime()) / 86_400_000,
  );
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff}d ago`;
  if (diff < 28) return `${Math.round(diff / 7)}w ago`;
  return `${Math.round(diff / 30)}mo ago`;
}

export function pct(value: number, digits = 0): string {
  return `${value >= 0 ? '' : ''}${value.toFixed(digits)}%`;
}

export function signedPct(value: number, digits = 0): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function bpmRange(range: [number, number]): string {
  return `${Math.round(range[0])}–${Math.round(range[1])} bpm`;
}

/** Sets × reps × total load, the one line that says what to do. */
/** `90s`, `2:00`, `10:00` — whichever reads fastest at a glance. */
export function holdText(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return rem === 0 ? `${m} min` : `${m}:${String(rem).padStart(2, '0')}`;
}

export function setsRepsLoad(
  sets: { reps: number; load_lb: number; warmup?: boolean; duration_s?: number }[],
): string {
  const working = sets.filter((s) => !s.warmup);
  if (working.length === 0) return '—';

  // Timed work has no rep count. Rendering it as "1 × 0" is worse than useless:
  // it tells the person doing it to perform zero repetitions.
  const timed = working.filter((s) => s.duration_s && s.duration_s > 0);
  if (timed.length === working.length) {
    const durations = working.map((s) => s.duration_s as number);
    const same = durations.every((d) => d === durations[0]);
    const text = same ? holdText(durations[0] as number) : durations.map(holdText).join(' / ');
    return working.length === 1 ? text : `${working.length} × ${text}`;
  }

  const reps = working.map((s) => s.reps);
  const loads = working.map((s) => s.load_lb);
  const sameReps = reps.every((r) => r === reps[0]);
  const sameLoad = loads.every((l) => l === loads[0]);
  const repText = sameReps ? `${reps[0]}` : reps.join('/');
  const first = loads[0] ?? 0;
  if (first <= 0) return `${working.length} × ${repText}`;
  const loadText = sameLoad ? lb(first) : loads.map((l) => lb(l, { compact: true })).join('/') + ' lb';
  return `${working.length} × ${repText} × ${loadText}`;
}

export function titleCase(slug: string): string {
  return slug
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
