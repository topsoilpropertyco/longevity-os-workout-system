/**
 * Longevity OS — Regional Load Ledger
 *
 * A rolling account of how hard each body region has been hit, and whether it
 * has had enough time to repair. RESEARCH §6.3.
 *
 * This is a HARD CONSTRAINT, not a score (CLAUDE.md invariant 5). If the ledger
 * says a region is unavailable, no amount of enthusiasm in another part of the
 * engine may schedule hard work for it.
 */

import { LEDGER } from './constants.js';
import type {
  Exercise,
  Ledger,
  LedgerEntry,
  Region,
  SessionLog,
  SetLog,
} from './types.js';
import { REGIONS } from './types.js';
import { clamp, daysBetween, round } from './util.js';

/**
 * Load contributed by a single set, in "kilo-pound-reps" — reps × total load ÷ 1000.
 * The division keeps the numbers human-readable: a hard set of 10 × 200 lb is 2.0.
 */
export function setLoad(set: SetLog): number {
  if (!set.completed) return 0;
  // Timed holds and carries have no rep count; charge them by the minute.
  if (set.reps === 0 && set.duration_s) return round((set.duration_s / 60) * Math.max(set.load_lb, 1) * 0.5 / 1000, 4);
  return round((set.reps * Math.max(set.load_lb, 1)) / 1000, 4);
}

/** True when this set counts as a hard stimulus rather than accumulated volume. */
export function isHardSet(set: SetLog, e1rm?: number): boolean {
  if (!set.completed) return false;
  if (typeof set.rpe === 'number' && set.rpe >= LEDGER.hard_hit_rpe) return true;
  if (e1rm && e1rm > 0 && set.load_lb / e1rm >= LEDGER.hard_hit_intensity) return true;
  return false;
}

function emptyEntry(region: Region): LedgerEntry {
  return {
    region,
    load_7d: 0,
    load_28d: 0,
    acwr: 0,
    hours_since_hard_hit: null,
    hours_since_eccentric: null,
    available: true,
  };
}

/**
 * Build the ledger from logged history.
 *
 * `today` anchors every window. Sessions dated after `today` are ignored, so the
 * same function serves both today's plan and each projected day of the week.
 */
export function buildLedger(args: {
  today: string;
  history: SessionLog[];
  exercises: Exercise[];
  e1rmByExercise?: Map<string, number>;
}): Ledger {
  const { today, history, exercises, e1rmByExercise } = args;
  const byId = new Map(exercises.map((e) => [e.id, e]));

  const ledger = Object.fromEntries(REGIONS.map((r) => [r, emptyEntry(r)])) as Ledger;

  for (const session of history) {
    const age = daysBetween(session.date, today);
    if (age < 0 || age > 28) continue;
    const hoursAgo = age * 24;

    for (const logged of session.exercises) {
      const ex = byId.get(logged.exercise_id);
      if (!ex) continue;
      const e1rm = e1rmByExercise?.get(logged.exercise_id);

      for (const set of logged.sets) {
        const load = setLoad(set);
        if (load === 0) continue;
        const hard = isHardSet(set, e1rm);

        for (const [region, weight] of Object.entries(ex.region_loads) as [Region, number][]) {
          const entry = ledger[region];
          if (!entry) continue;
          const contribution = load * weight;
          entry.load_28d += contribution;
          if (age < 7) entry.load_7d += contribution;

          if (hard && weight >= 0.5) {
            if (entry.hours_since_hard_hit === null || hoursAgo < entry.hours_since_hard_hit) {
              entry.hours_since_hard_hit = hoursAgo;
            }
            if (ex.eccentric_dominant) {
              if (entry.hours_since_eccentric === null || hoursAgo < entry.hours_since_eccentric) {
                entry.hours_since_eccentric = hoursAgo;
              }
            }
          }
        }
      }
    }
  }

  for (const region of REGIONS) {
    const entry = ledger[region];
    entry.load_7d = round(entry.load_7d, 3);
    entry.load_28d = round(entry.load_28d, 3);
    entry.acwr = acwr(entry.load_7d, entry.load_28d);

    const { available, reason } = regionAvailability(entry);
    entry.available = available;
    if (reason) entry.block_reason = reason;
  }

  return ledger;
}

/**
 * Acute:chronic workload ratio — the 7-day load over the weekly average of the
 * 28-day load. Gabbett's sweet spot is 0.8–1.3; above 1.5 is a risk spike.
 *
 * Returns 0 when there is no chronic base to compare against, which the caller
 * must read as "unknown", not "safe". This matters more than it looks: a single
 * logged session puts all of the 28-day load inside the 7-day window, which
 * computes to an ACWR of 4 and would lock the athlete out of his own second
 * workout. A ratio is only meaningful once there is history OUTSIDE the acute
 * window to be a ratio against.
 */
export function acwr(load7d: number, load28d: number): number {
  const priorThreeWeeks = load28d - load7d;
  if (priorThreeWeeks <= LEDGER.negligible_load) return 0;
  const chronicWeekly = load28d / 4;
  if (chronicWeekly <= LEDGER.negligible_load / 4) return 0;
  return round(load7d / chronicWeekly, 3);
}

/** Whether a region may take a hard stimulus today, and why not if it may not. */
export function regionAvailability(entry: LedgerEntry): { available: boolean; reason?: string } {
  if (entry.hours_since_eccentric !== null && entry.hours_since_eccentric < LEDGER.eccentric_recovery_h) {
    const left = Math.ceil(LEDGER.eccentric_recovery_h - entry.hours_since_eccentric);
    return {
      available: false,
      reason: `Eccentric work ${Math.round(entry.hours_since_eccentric)}h ago — needs ${left}h more.`,
    };
  }
  if (entry.hours_since_hard_hit !== null && entry.hours_since_hard_hit < LEDGER.hard_hit_recovery_h) {
    const left = Math.ceil(LEDGER.hard_hit_recovery_h - entry.hours_since_hard_hit);
    return {
      available: false,
      reason: `Hard session ${Math.round(entry.hours_since_hard_hit)}h ago — needs ${left}h more.`,
    };
  }
  if (entry.acwr > LEDGER.acwr_danger) {
    return {
      available: false,
      reason: `Workload ratio ${entry.acwr.toFixed(2)} is above the ${LEDGER.acwr_danger} risk line.`,
    };
  }
  return { available: true };
}

/**
 * How much of an exercise's intended load the ledger permits today: 1 when every
 * region it touches is fresh, tapering to 0 when a primary region is blocked.
 * Light accessory involvement in a tired region does not veto the movement.
 */
export function ledgerAllowance(ex: Exercise, ledger: Ledger): { multiplier: number; blockedBy: Region[] } {
  const blockedBy: Region[] = [];
  let multiplier = 1;

  for (const [region, weight] of Object.entries(ex.region_loads) as [Region, number][]) {
    const entry = ledger[region];
    if (!entry) continue;
    if (!entry.available) {
      if (weight >= 0.5) {
        blockedBy.push(region);
        multiplier = 0;
      } else {
        // Secondary involvement in a recovering region: allowed, but lightened.
        multiplier = Math.min(multiplier, 1 - weight * 0.5);
      }
    } else if (entry.acwr > LEDGER.acwr_max && weight >= 0.5) {
      // Approaching the ceiling — permitted, but do not add fuel.
      multiplier = Math.min(multiplier, 0.85);
    }
  }

  return { multiplier: round(clamp(multiplier, 0, 1), 3), blockedBy };
}

/** Regions that are fresh and therefore good candidates for today's hard work. */
export function availableRegions(ledger: Ledger): Region[] {
  return REGIONS.filter((r) => ledger[r].available);
}

/**
 * Project the ledger forward by applying a planned session to it, so the week
 * carousel's later days respect the days before them.
 */
export function applyPlannedLoad(
  ledger: Ledger,
  planned: { exercise: Exercise; sets: { reps: number; load_lb: number }[] }[],
  hoursFromNow: number,
): Ledger {
  const next: Ledger = Object.fromEntries(
    Object.entries(ledger).map(([k, v]) => [k, { ...v }]),
  ) as Ledger;

  for (const item of planned) {
    const load = item.sets.reduce((a, s) => a + (s.reps * Math.max(s.load_lb, 1)) / 1000, 0);
    for (const [region, weight] of Object.entries(item.exercise.region_loads) as [Region, number][]) {
      const entry = next[region];
      if (!entry) continue;
      entry.load_7d += load * weight;
      entry.load_28d += load * weight;
      if (weight >= 0.5) {
        // Planned work is assumed to be a hard hit on its primary regions, and
        // it happens NOW — the shift below ages it by `hoursFromNow`.
        entry.hours_since_hard_hit = 0;
        if (item.exercise.eccentric_dominant) entry.hours_since_eccentric = 0;
      }
    }
  }

  for (const region of REGIONS) {
    const entry = next[region];
    // Shift every clock forward by the elapsed time.
    if (entry.hours_since_hard_hit !== null) entry.hours_since_hard_hit += hoursFromNow;
    if (entry.hours_since_eccentric !== null) entry.hours_since_eccentric += hoursFromNow;
    entry.acwr = acwr(entry.load_7d, entry.load_28d);
    const { available, reason } = regionAvailability(entry);
    entry.available = available;
    entry.block_reason = reason;
  }

  return next;
}
