import { describe, expect, it } from 'vitest';
import { assessReadiness, hrvBaseline, hrvDeviationPct, neutralReadiness, scoreFromSliders } from '../src/readiness.js';
import { HRV_RECOVERY_TRIGGER_PCT } from '../src/constants.js';
import type { OuraDaily, SelfReport } from '../src/types.js';
import { addDays } from '../src/util.js';

const TODAY = '2026-09-22';

function history(hrv: number, days = 28): OuraDaily[] {
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(TODAY, -(days - i)),
    hrv_ms: hrv,
    readiness_score: 75,
  }));
}

describe('sliders', () => {
  it('maps a perfect report to 100 and a terrible one to 0', () => {
    const best: SelfReport = { date: TODAY, soreness: 5, energy: 5, stress: 1 };
    const worst: SelfReport = { date: TODAY, soreness: 1, energy: 1, stress: 5 };
    expect(scoreFromSliders(best)).toBe(100);
    expect(scoreFromSliders(worst)).toBe(0);
  });

  it('inverts stress — a 5 means maxed out, not great', () => {
    const calm: SelfReport = { date: TODAY, soreness: 3, energy: 3, stress: 1 };
    const fried: SelfReport = { date: TODAY, soreness: 3, energy: 3, stress: 5 };
    expect(scoreFromSliders(calm)).toBeGreaterThan(scoreFromSliders(fried));
  });

  it('anchors a neutral 3/3/3 to the same neutral point Oura would report', () => {
    // Not 50: Oura's ordinary day sits around 75, and the two signals have to be
    // on one scale or every normal self-report reads as a disagreement.
    expect(scoreFromSliders({ date: TODAY, soreness: 3, energy: 3, stress: 3 })).toBe(75);
  });

  it('stays monotonic across the whole range', () => {
    const scores = ([1, 2, 3, 4, 5] as const).map((n) =>
      scoreFromSliders({ date: TODAY, soreness: n, energy: n, stress: (6 - n) as 1 | 2 | 3 | 4 | 5 }),
    );
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
  });
});

describe('HRV baseline', () => {
  it('needs at least a week of nights', () => {
    expect(hrvBaseline(history(60, 5), TODAY)).toBeNull();
    expect(hrvBaseline(history(60, 20), TODAY)).toBe(60);
  });

  it('excludes today from its own baseline', () => {
    const h = [...history(60, 10), { date: TODAY, hrv_ms: 200 }];
    expect(hrvBaseline(h, TODAY)).toBe(60);
  });

  it('reports deviation as a percentage', () => {
    expect(hrvDeviationPct(54, 60)).toBe(-10);
    expect(hrvDeviationPct(66, 60)).toBe(10);
    expect(hrvDeviationPct(undefined, 60)).toBeUndefined();
    expect(hrvDeviationPct(60, null)).toBeUndefined();
  });
});

describe('bands', () => {
  const h = history(60);

  it('pushes at 85 and above', () => {
    const r = assessReadiness({ today: TODAY, oura: { date: TODAY, readiness_score: 90, hrv_ms: 62 }, ouraHistory: h });
    expect(r.band).toBe('push');
    expect(r.load_multiplier).toBeGreaterThan(1);
    expect(r.set_delta).toBe(1);
  });

  it('runs as planned between 70 and 84', () => {
    const r = assessReadiness({ today: TODAY, oura: { date: TODAY, readiness_score: 75, hrv_ms: 60 }, ouraHistory: h });
    expect(r.band).toBe('as_planned');
    expect(r.load_multiplier).toBe(1);
    expect(r.rpe_cap).toBeUndefined();
  });

  it('reduces load and caps RPE at 7 between 55 and 69', () => {
    const r = assessReadiness({ today: TODAY, oura: { date: TODAY, readiness_score: 60, hrv_ms: 59 }, ouraHistory: h });
    expect(r.band).toBe('reduced');
    expect(r.load_multiplier).toBeCloseTo(0.9, 5);
    expect(r.rpe_cap).toBe(7);
  });

  it('converts to recovery below 55', () => {
    const r = assessReadiness({ today: TODAY, oura: { date: TODAY, readiness_score: 40, hrv_ms: 58 }, ouraHistory: h });
    expect(r.band).toBe('recovery');
  });

  it('forces recovery when HRV is 10% below baseline even with a good score', () => {
    const r = assessReadiness({
      today: TODAY,
      oura: { date: TODAY, readiness_score: 88, hrv_ms: 54 }, // exactly -10%
      ouraHistory: h,
    });
    expect(r.hrv_vs_baseline_pct).toBeLessThanOrEqual(HRV_RECOVERY_TRIGGER_PCT);
    expect(r.band).toBe('recovery');
    expect(r.reasons.join(' ')).toMatch(/HRV/);
  });
});

describe('degradation', () => {
  it('falls back to sliders when Oura is missing', () => {
    const r = assessReadiness({
      today: TODAY,
      ouraHistory: [],
      selfReport: { date: TODAY, soreness: 4, energy: 4, stress: 2 },
    });
    expect(r.source).toBe('sliders');
    expect(r.score).toBeGreaterThan(50);
  });

  it('falls back to a neutral default when nothing is known', () => {
    const r = assessReadiness({ today: TODAY, ouraHistory: [] });
    expect(r.source).toBe('default');
    expect(r.band).toBe('as_planned');
  });

  it('trusts the more cautious signal when ring and sliders disagree sharply', () => {
    const r = assessReadiness({
      today: TODAY,
      oura: { date: TODAY, readiness_score: 90, hrv_ms: 60 },
      ouraHistory: history(60),
      selfReport: { date: TODAY, soreness: 1, energy: 1, stress: 5 },
    });
    expect(r.source).toBe('blend');
    // A blend that ignored the self-report would land near 63; the caution rule
    // pulls it to at most sliderScore + 10.
    expect(r.score).toBeLessThanOrEqual(10);
  });

  it('does not let a neutral self-report drag down a fine Oura score', () => {
    const r = assessReadiness({
      today: TODAY,
      oura: { date: TODAY, readiness_score: 72, hrv_ms: 60 },
      ouraHistory: history(60),
      selfReport: { date: TODAY, soreness: 3, energy: 3, stress: 3 },
    });
    // 72 from the ring, 75 from neutral sliders: a 3-point gap, so no clamp and
    // the day stays as-planned. Before the scales were reconciled this landed at
    // 60 and turned an ordinary Tuesday into a reduced-load day.
    expect(r.score).toBeCloseTo(72.9, 1);
    expect(r.band).toBe('as_planned');
  });

  it('leaves the Oura score untouched when no sliders were submitted', () => {
    const r = assessReadiness({
      today: TODAY,
      oura: { date: TODAY, readiness_score: 72, hrv_ms: 60 },
      ouraHistory: history(60),
    });
    expect(r.score).toBe(72);
    expect(r.source).toBe('oura');
    expect(r.band).toBe('as_planned');
  });

  it('projects future days as neutral rather than forecasting Oura', () => {
    expect(neutralReadiness().band).toBe('as_planned');
    expect(neutralReadiness().source).toBe('default');
  });
});
