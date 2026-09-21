import type { PlanInput, PlanResult, Region } from './engine-bridge';
import { estimateOneRepMax } from './engine-bridge';
import { addDays, weekdayShort } from './format';

/** Vertical jump: measured with chalk and a wall, prompted at onboarding. */
// TODO(db): read from the `tests` table once it exists; fixture for now.
export const VERTICAL = { baseline_in: 24.5, latest_in: 26.25, measured_on: 'this month' };

export type WeeklyBucket = { week: string; strength: number; zone2: number; vo2: number; mobility: number };

function weekLabel(iso: string, todayIso: string): string {
  const diff = Math.round((new Date(todayIso).getTime() - new Date(iso).getTime()) / 86_400_000);
  const weeks = Math.floor(diff / 7);
  return weeks === 0 ? 'This' : `−${weeks}w`;
}

export function weeklyBuckets(input: PlanInput, weeks = 5): WeeklyBucket[] {
  const out: WeeklyBucket[] = [];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const start = addDays(input.today, -(w + 1) * 7 + 1);
    const end = addDays(input.today, -w * 7);
    const sessions = input.history.filter((s) => s.date >= start && s.date <= end);
    const cardio = input.cardio_history.filter((c) => c.date >= start && c.date <= end);
    out.push({
      week: weekLabel(start, input.today),
      strength: sessions.filter((s) => s.type === 'strength' || s.type === 'kot' || s.type === 'power').reduce((a, s) => a + s.duration_min, 0),
      zone2: cardio.reduce((a, c) => a + (c.zone_minutes?.z2 ?? 0), 0),
      vo2: cardio.reduce((a, c) => a + (c.zone_minutes?.z4 ?? 0) + (c.zone_minutes?.z5 ?? 0), 0),
      mobility: sessions.filter((s) => s.type === 'mobility' || s.type === 'recovery').reduce((a, s) => a + s.duration_min, 0),
    });
  }
  return out;
}

export function zoneDistribution(input: PlanInput, weeks = 5) {
  const rows = [] as { week: string; z1: number; z2: number; z3: number; z4: number; z5: number }[];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const start = addDays(input.today, -(w + 1) * 7 + 1);
    const end = addDays(input.today, -w * 7);
    const cardio = input.cardio_history.filter((c) => c.date >= start && c.date <= end);
    const sum = (k: 'z1' | 'z2' | 'z3' | 'z4' | 'z5') => cardio.reduce((a, c) => a + (c.zone_minutes?.[k] ?? 0), 0);
    rows.push({ week: weekLabel(start, input.today), z1: sum('z1'), z2: sum('z2'), z3: sum('z3'), z4: sum('z4'), z5: sum('z5') });
  }
  return rows;
}

export type E1rmPoint = { date: string; label: string; e1rm: number };

export function e1rmSeries(input: PlanInput, exerciseId: string): E1rmPoint[] {
  const points: E1rmPoint[] = [];
  for (const session of [...input.history].sort((a, b) => a.date.localeCompare(b.date))) {
    const logged = session.exercises.find((e) => e.exercise_id === exerciseId);
    if (!logged) continue;
    const best = logged.sets.reduce((max, s) => Math.max(max, estimateOneRepMax(s.load_lb, s.reps)), 0);
    if (best > 0) points.push({ date: session.date, label: weekdayShort(session.date), e1rm: best });
  }
  return points;
}

/**
 * Plateau: the last four sessions gained less than 1% in total.
 * TODO(engine): if progression decisions ever key off this, it belongs in the
 * engine and this becomes a read of the engine's own verdict.
 */
export function detectPlateau(points: E1rmPoint[]): { fromIndex: number; note: string } | undefined {
  if (points.length < 5) return undefined;
  const tail = points.slice(-4);
  const first = tail[0]?.e1rm ?? 0;
  const last = tail[tail.length - 1]?.e1rm ?? 0;
  if (first <= 0) return undefined;
  const gain = (last - first) / first;
  if (gain > 0.01) return undefined;
  return {
    fromIndex: points.length - 4,
    note: `Flat for ${tail.length} sessions — the engine will vary reps or the exercise next block.`,
  };
}

export type Pr = { date: string; exercise: string; detail: string };

export function prFeed(input: PlanInput, limit = 6): Pr[] {
  const best: Record<string, number> = {};
  const prs: Pr[] = [];
  for (const session of [...input.history].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const logged of session.exercises) {
      for (const set of logged.sets) {
        const e1 = estimateOneRepMax(set.load_lb, set.reps);
        const prev = best[logged.exercise_id] ?? 0;
        if (e1 > prev * 1.01 && set.load_lb > 0) {
          best[logged.exercise_id] = e1;
          const name = input.exercises.find((e) => e.id === logged.exercise_id)?.name ?? logged.exercise_id;
          prs.push({
            date: session.date,
            exercise: name,
            detail: `${set.reps} × ${set.load_lb} lb · e1RM ${Math.round(e1)} lb`,
          });
        }
      }
    }
  }
  return prs.reverse().slice(0, limit);
}

export function streak(input: PlanInput): number {
  let count = 0;
  const logged = new Set(input.history.map((s) => s.date));
  const cardioDays = new Set(input.cardio_history.map((c) => c.date));
  for (let i = 1; i < 90; i += 1) {
    const d = addDays(input.today, -i);
    if (logged.has(d) || cardioDays.has(d)) count += 1;
    else break;
  }
  return count;
}

export function painTrend(input: PlanInput, region: Region): { label: string; value: number }[] {
  const injury = input.injuries.find((i) => i.region === region);
  const base = injury?.current_pain ?? 0;
  // TODO(db): read `injury_checkins`; this shapes the series from the current value.
  return [4, 3, 3, 2, base].map((value, i) => ({ label: `−${4 - i}w`, value }));
}

export function readinessVsPerformance(input: PlanInput, days = 14) {
  const labels: string[] = [];
  const readiness: number[] = [];
  const performance: number[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(input.today, -i);
    const oura = input.oura_history.find((o) => o.date === date);
    const session = input.history.find((s) => s.date === date);
    labels.push(weekdayShort(date));
    readiness.push(oura?.readiness_score ?? 70);
    performance.push(
      session
        ? session.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + s.reps * s.load_lb, 0), 0)
        : 0,
    );
  }
  return { labels, readiness, performance };
}

export function topAcwr(result: PlanResult, count = 4) {
  return Object.values(result.ledger)
    .filter((e) => e.load_7d > 0)
    .sort((a, b) => Math.abs(b.acwr - 1) - Math.abs(a.acwr - 1))
    .slice(0, count);
}

export function regionLabel(region: Region): string {
  return region.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
