import { describe, expect, it } from 'vitest';
import {
  addDays, clamp, daysBetween, hashString, iqr, lastNDays, linearTrend, mean, median,
  percentile, rankBy, rng, round, roundToIncrement, stableStringify, withinDays,
} from '../src/util.js';

describe('numeric helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('rounds without float dust', () => {
    expect(round(0.1 + 0.2, 2)).toBe(0.3);
    expect(round(2.675, 2)).toBe(2.68);
  });

  it('computes mean and median', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBe(0);
  });

  it('computes percentiles by linear interpolation', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 5);
  });

  it('computes an IQR', () => {
    const [q1, q3] = iqr([10, 20, 30, 40, 50]);
    expect(q1).toBe(20);
    expect(q3).toBe(40);
  });

  it('fits a linear trend', () => {
    const { slope } = linearTrend([10, 20, 30, 40]);
    expect(slope).toBeCloseTo(10, 6);
    expect(linearTrend([5]).slope).toBe(0);
    expect(linearTrend([]).slope).toBe(0);
  });
});

describe('dates', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('adds days across a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('measures distance between dates', () => {
    expect(daysBetween('2026-09-20', '2026-09-22')).toBe(2);
    expect(daysBetween('2026-09-22', '2026-09-20')).toBe(-2);
  });

  it('builds trailing windows inclusive of today', () => {
    const days = lastNDays('2026-09-22', 3);
    expect(days).toEqual(['2026-09-20', '2026-09-21', '2026-09-22']);
  });

  it('treats today as within a 1-day window and yesterday as outside it', () => {
    expect(withinDays('2026-09-22', '2026-09-22', 1)).toBe(true);
    expect(withinDays('2026-09-21', '2026-09-22', 1)).toBe(false);
    expect(withinDays('2026-09-21', '2026-09-22', 2)).toBe(true);
    // Future dates are never "within" a trailing window.
    expect(withinDays('2026-09-23', '2026-09-22', 7)).toBe(false);
  });
});

describe('determinism', () => {
  it('produces the same sequence for the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('hashes stably regardless of key order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('drops undefined values so optional fields do not change the signature', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe('load rounding', () => {
  it('rounds to the rack increment', () => {
    expect(roundToIncrement(47, 5)).toBe(45);
    expect(roundToIncrement(48, 5)).toBe(50);
    expect(roundToIncrement(51.3, 2.5)).toBe(52.5);
    expect(roundToIncrement(51.1, 2.5)).toBe(50);
  });

  it('respects equipment bounds', () => {
    expect(roundToIncrement(200, 5, 0, 105)).toBe(105);
    expect(roundToIncrement(2, 5, 10)).toBe(10);
  });
});

describe('ranking', () => {
  it('is stable and breaks ties deterministically', () => {
    const items = [{ k: 'b', s: 1 }, { k: 'a', s: 1 }, { k: 'c', s: 2 }];
    const ranked = rankBy(items, (x) => x.s, (x) => x.k);
    expect(ranked.map((x) => x.k)).toEqual(['c', 'a', 'b']);
  });
});
