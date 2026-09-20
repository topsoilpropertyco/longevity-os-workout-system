import { describe, expect, it } from 'vitest';
import {
  brzycki, currentE1rm, detectPlateau, doubleProgressionBump, e1rmSeries, epley,
  estimateOneRepMax, loadForReps, predictionBand, sessionE1rm, setsAndReps,
} from '../src/progression.js';
import { neutralReadiness } from '../src/readiness.js';
import type { Exercise, SessionLog } from '../src/types.js';
import { EXERCISE_BY_ID } from '../fixtures/library.js';
import { addDays } from '../src/util.js';

const TODAY = '2026-09-22';

function log(date: string, reps: number, load: number, count = 3): SessionLog {
  return {
    id: `s-${date}`, date, type: 'strength', duration_min: 40, completed: true,
    exercises: [{
      exercise_id: 'db-bench-press',
      sets: Array.from({ length: count }, (_, i) => ({ set_index: i, reps, load_lb: load, rpe: 8 as const, completed: true })),
    }],
  };
}

describe('1RM formulas', () => {
  it('matches Epley by hand', () => {
    expect(epley(200, 5)).toBeCloseTo(233.33, 2);
  });

  it('matches Brzycki by hand', () => {
    expect(brzycki(200, 5)).toBeCloseTo(225, 2);
  });

  it('averages the two', () => {
    expect(estimateOneRepMax(200, 5)).toBeCloseTo(229.2, 1);
  });

  it('returns the load itself at one rep', () => {
    expect(estimateOneRepMax(225, 1)).toBe(225);
  });

  it('returns zero for nonsense input rather than NaN', () => {
    expect(estimateOneRepMax(0, 5)).toBe(0);
    expect(estimateOneRepMax(200, 0)).toBe(0);
  });

  it('round-trips through loadForReps', () => {
    const e1rm = estimateOneRepMax(200, 5);
    expect(loadForReps(e1rm, 5)).toBeCloseTo(200, 0);
  });
});

describe('history', () => {
  const history = [log(addDays(TODAY, -21), 8, 100), log(addDays(TODAY, -14), 8, 110), log(addDays(TODAY, -7), 8, 120)];

  it('extracts an e1RM series in date order', () => {
    const series = e1rmSeries('db-bench-press', history);
    expect(series).toHaveLength(3);
    expect(series[0]!.e1rm).toBeLessThan(series[2]!.e1rm);
  });

  it('takes the best set in a session', () => {
    const mixed: SessionLog = {
      id: 'm', date: TODAY, type: 'strength', duration_min: 30, completed: true,
      exercises: [{ exercise_id: 'db-bench-press', sets: [
        { set_index: 0, reps: 10, load_lb: 100, completed: true },
        { set_index: 1, reps: 5, load_lb: 140, completed: true },
      ] }],
    };
    expect(sessionE1rm(mixed.exercises[0]!)).toBeCloseTo(estimateOneRepMax(140, 5), 1);
  });

  it('ignores sets above the rep ceiling where the formulas stop being trustworthy', () => {
    const highRep: SessionLog = {
      id: 'h', date: TODAY, type: 'strength', duration_min: 30, completed: true,
      exercises: [{ exercise_id: 'db-bench-press', sets: [{ set_index: 0, reps: 30, load_lb: 60, completed: true }] }],
    };
    expect(sessionE1rm(highRep.exercises[0]!)).toBe(0);
  });

  it('never projects below what he has actually done recently', () => {
    const e1rm = currentE1rm('db-bench-press', history);
    expect(e1rm).toBeGreaterThanOrEqual(estimateOneRepMax(110, 8));
  });

  it('returns zero for an exercise with no history', () => {
    expect(currentE1rm('pull-up', history)).toBe(0);
  });
});

describe('prediction bands', () => {
  const history = [
    log(addDays(TODAY, -28), 8, 100), log(addDays(TODAY, -21), 8, 105),
    log(addDays(TODAY, -14), 8, 110), log(addDays(TODAY, -7), 8, 115),
  ];

  it('orders normal ≤ probable ≤ max for a rising trend', () => {
    const band = predictionBand({
      exerciseId: 'db-bench-press', reps: 8, history,
      readiness: neutralReadiness(), bodyweightLb: 205,
    });
    expect(band.basis).toBe('history');
    expect(band.normal[0]).toBeLessThanOrEqual(band.normal[1]);
    expect(band.max).toBeGreaterThanOrEqual(band.probable * 0.95);
  });

  it('grows confidence with history', () => {
    const few = predictionBand({ exerciseId: 'db-bench-press', reps: 8, history: history.slice(0, 2), readiness: neutralReadiness(), bodyweightLb: 205 });
    const many = predictionBand({ exerciseId: 'db-bench-press', reps: 8, history, readiness: neutralReadiness(), bodyweightLb: 205 });
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });

  it('falls back to a program standard on cold start', () => {
    const band = predictionBand({
      exerciseId: 'atg-split-squat', reps: 5, history: [], readiness: neutralReadiness(),
      bodyweightLb: 200, standard: { pct_bodyweight: 0.25, per_hand: true, reps: 5 },
    });
    expect(band.basis).toBe('program_standard');
    // 25% of 200 lb per hand = 50 per hand = 100 total.
    expect(band.normal[1]).toBeCloseTo(100, 0);
  });

  it('reports zero confidence when there is nothing to go on at all', () => {
    const band = predictionBand({ exerciseId: 'pull-up', reps: 5, history: [], readiness: neutralReadiness(), bodyweightLb: 205 });
    expect(band.basis).toBe('cold_start');
    expect(band.confidence).toBe(0);
  });

  it('scales the probable value by the readiness multiplier', () => {
    const neutral = predictionBand({ exerciseId: 'db-bench-press', reps: 8, history, readiness: neutralReadiness(), bodyweightLb: 205 });
    const reduced = predictionBand({
      exerciseId: 'db-bench-press', reps: 8, history, bodyweightLb: 205,
      readiness: { ...neutralReadiness(), load_multiplier: 0.9 },
    });
    expect(reduced.probable).toBeLessThan(neutral.probable);
  });
});

describe('double progression', () => {
  const bench = EXERCISE_BY_ID.get('db-bench-press') as Exercise;

  it('bumps after two sessions at the top of the range', () => {
    const history = [log(addDays(TODAY, -14), 12, 120), log(addDays(TODAY, -7), 12, 120)];
    const { bump } = doubleProgressionBump({ exerciseId: 'db-bench-press', exercise: bench, history, repRange: [8, 12] });
    expect(bump).toBe(5);
  });

  it('does not bump when only one session reached the top', () => {
    const history = [log(addDays(TODAY, -14), 9, 120), log(addDays(TODAY, -7), 12, 120)];
    expect(doubleProgressionBump({ exerciseId: 'db-bench-press', exercise: bench, history, repRange: [8, 12] }).bump).toBe(0);
  });

  it('uses the larger increment for lower-body patterns', () => {
    const squat = EXERCISE_BY_ID.get('goblet-squat') as Exercise;
    const history = [
      { ...log(addDays(TODAY, -14), 12, 100), exercises: [{ exercise_id: 'goblet-squat', sets: [{ set_index: 0, reps: 12, load_lb: 100, rpe: 8 as const, completed: true }] }] },
      { ...log(addDays(TODAY, -7), 12, 100), exercises: [{ exercise_id: 'goblet-squat', sets: [{ set_index: 0, reps: 12, load_lb: 100, rpe: 8 as const, completed: true }] }] },
    ];
    expect(doubleProgressionBump({ exerciseId: 'goblet-squat', exercise: squat, history, repRange: [8, 12] }).bump).toBe(10);
  });
});

describe('plateau detection', () => {
  it('flags a flat trend', () => {
    const history = [100, 100, 100, 100].map((l, i) => log(addDays(TODAY, -(28 - i * 7)), 8, l));
    expect(detectPlateau('db-bench-press', history).plateaued).toBe(true);
  });

  it('does not flag a rising trend', () => {
    const history = [100, 110, 120, 130].map((l, i) => log(addDays(TODAY, -(28 - i * 7)), 8, l));
    expect(detectPlateau('db-bench-press', history).plateaued).toBe(false);
  });

  it('stays silent without enough sessions to judge', () => {
    expect(detectPlateau('db-bench-press', [log(TODAY, 8, 100)]).plateaued).toBe(false);
  });
});

describe('sets and reps', () => {
  it('adds a set on a primary lift when readiness is high', () => {
    const high = { ...neutralReadiness(), set_delta: 1 };
    const a = setsAndReps({ goal: 'bulk', readiness: neutralReadiness(), isPrimary: true, deloadVolumeMultiplier: 1 });
    const b = setsAndReps({ goal: 'bulk', readiness: high, isPrimary: true, deloadVolumeMultiplier: 1 });
    expect(b.sets).toBe(a.sets + 1);
  });

  it('does not add the extra set to accessory work', () => {
    const high = { ...neutralReadiness(), set_delta: 1 };
    const a = setsAndReps({ goal: 'bulk', readiness: neutralReadiness(), isPrimary: false, deloadVolumeMultiplier: 1 });
    const b = setsAndReps({ goal: 'bulk', readiness: high, isPrimary: false, deloadVolumeMultiplier: 1 });
    expect(b.sets).toBe(a.sets);
  });

  it('honours the readiness RPE cap', () => {
    const capped = { ...neutralReadiness(), rpe_cap: 7 as const };
    expect(setsAndReps({ goal: 'bulk', readiness: capped, isPrimary: true, deloadVolumeMultiplier: 1 }).rpe).toBe(7);
  });

  it('never prescribes zero sets, however deep the deload', () => {
    expect(setsAndReps({ goal: 'maintain', readiness: neutralReadiness(), isPrimary: false, deloadVolumeMultiplier: 0.1 }).sets).toBeGreaterThanOrEqual(1);
  });
});
