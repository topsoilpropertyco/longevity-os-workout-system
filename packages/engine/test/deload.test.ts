import { describe, expect, it } from 'vitest';
import { deloadGuidance, evaluateDeload } from '../src/deload.js';
import { DELOAD } from '../src/constants.js';
import type { OuraDaily, SelfReport, SessionLog } from '../src/types.js';
import { addDays } from '../src/util.js';

const TODAY = '2026-09-22';

function oura(readiness: number, hrv: number, days = 28, recentHrv?: number): OuraDaily[] {
  return Array.from({ length: days }, (_, i) => {
    const back = days - i;
    return {
      date: addDays(TODAY, -back),
      readiness_score: readiness,
      hrv_ms: back <= 7 ? (recentHrv ?? hrv) : hrv,
    };
  });
}

function sliders(soreness: 1 | 2 | 3 | 4 | 5, days: number): SelfReport[] {
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(TODAY, -(days - 1 - i)),
    soreness, energy: 4, stress: 2,
  }));
}

const NONE: SessionLog[] = [];

describe('triggers', () => {
  it('fires on a 7-day readiness average below 65', () => {
    const s = evaluateDeload({ today: TODAY, ouraHistory: oura(58, 60), selfReports: [], history: NONE, lastDeloadStart: addDays(TODAY, -14) });
    expect(s.active).toBe(true);
    expect(s.triggers.join(' ')).toMatch(/readiness averaging/);
  });

  it('fires on an HRV trend 10% below the 28-day baseline', () => {
    const s = evaluateDeload({ today: TODAY, ouraHistory: oura(80, 60, 28, 50), selfReports: [], history: NONE, lastDeloadStart: addDays(TODAY, -14) });
    expect(s.active).toBe(true);
    expect(s.triggers.join(' ')).toMatch(/HRV trending/);
  });

  it('fires after two consecutive sessions where the reps did not come', () => {
    const history: SessionLog[] = [addDays(TODAY, -2), addDays(TODAY, -4)].map((date) => ({
      id: date, date, type: 'strength', duration_min: 40, completed: true,
      exercises: [{ exercise_id: 'db-bench-press', sets: [{ set_index: 0, reps: 5, load_lb: 100, completed: false }] }],
    }));
    const s = evaluateDeload({ today: TODAY, ouraHistory: oura(80, 60), selfReports: [], history, lastDeloadStart: addDays(TODAY, -14) });
    expect(s.active).toBe(true);
    expect(s.triggers.join(' ')).toMatch(/reps did not come/);
  });

  it('fires after three consecutive red slider days', () => {
    const s = evaluateDeload({ today: TODAY, ouraHistory: oura(80, 60), selfReports: sliders(2, 3), history: NONE, lastDeloadStart: addDays(TODAY, -14) });
    expect(s.active).toBe(true);
    expect(s.triggers.join(' ')).toMatch(/red sliders/);
  });

  it('does not fire on two red days', () => {
    const s = evaluateDeload({ today: TODAY, ouraHistory: oura(80, 60), selfReports: sliders(2, 2), history: NONE, lastDeloadStart: addDays(TODAY, -14) });
    expect(s.active).toBe(false);
  });

  it('stays quiet when every signal is healthy', () => {
    const s = evaluateDeload({ today: TODAY, ouraHistory: oura(82, 60), selfReports: sliders(4, 5), history: NONE, lastDeloadStart: addDays(TODAY, -14) });
    expect(s.active).toBe(false);
    expect(s.volume_multiplier).toBe(1);
    expect(s.load_multiplier).toBe(1);
  });
});

describe('the calendar backstop', () => {
  it('forces a light week past the hard cap even with perfect signals', () => {
    const s = evaluateDeload({
      today: TODAY, ouraHistory: oura(90, 60), selfReports: sliders(5, 5), history: NONE,
      lastDeloadStart: addDays(TODAY, -DELOAD.hard_cap_weeks * 7),
    });
    expect(s.active).toBe(true);
    expect(s.triggers.join(' ')).toMatch(/since the last light week/);
  });

  it('does not force one before the cap', () => {
    const s = evaluateDeload({
      today: TODAY, ouraHistory: oura(90, 60), selfReports: sliders(5, 5), history: NONE,
      lastDeloadStart: addDays(TODAY, -21),
    });
    expect(s.active).toBe(false);
  });

  it('does not deload a brand-new athlete who has simply never deloaded', () => {
    const s = evaluateDeload({ today: TODAY, ouraHistory: oura(90, 60), selfReports: sliders(5, 5), history: NONE });
    expect(s.active).toBe(false);
    expect(s.weeks_since_last).toBe(0);
  });

  it('counts from the first logged session when there has never been a deload', () => {
    const longHistory: SessionLog[] = [{
      id: 'first', date: addDays(TODAY, -DELOAD.hard_cap_weeks * 7), type: 'strength',
      duration_min: 40, completed: true,
      exercises: [{ exercise_id: 'db-bench-press', sets: [{ set_index: 0, reps: 8, load_lb: 100, completed: true }] }],
    }];
    const s = evaluateDeload({ today: TODAY, ouraHistory: oura(90, 60), selfReports: sliders(5, 5), history: longHistory });
    expect(s.active).toBe(true);
    expect(s.triggers.join(' ')).toMatch(/since the last light week/);
  });
});

describe('an in-progress deload', () => {
  it('runs to completion rather than re-evaluating itself away', () => {
    const s = evaluateDeload({
      today: TODAY, ouraHistory: oura(95, 60), selfReports: sliders(5, 5), history: NONE,
      activeDeloadStart: addDays(TODAY, -2),
    });
    expect(s.active).toBe(true);
    expect(s.triggers[0]).toMatch(/in progress/);
  });

  it('ends once its days are up', () => {
    const s = evaluateDeload({
      today: TODAY, ouraHistory: oura(95, 60), selfReports: sliders(5, 5), history: NONE,
      activeDeloadStart: addDays(TODAY, -(DELOAD.duration_days + 1)),
      lastDeloadStart: addDays(TODAY, -(DELOAD.duration_days + 1)),
    });
    expect(s.active).toBe(false);
  });
});

describe('prescription', () => {
  it('is lighter and shorter, not a week off', () => {
    const s = evaluateDeload({ today: TODAY, ouraHistory: oura(55, 60), selfReports: [], history: NONE, lastDeloadStart: addDays(TODAY, -14) });
    expect(s.volume_multiplier).toBeGreaterThan(0);
    expect(s.volume_multiplier).toBeLessThan(1);
    expect(s.load_multiplier).toBeGreaterThan(0.8);
    expect(deloadGuidance(s)).toMatch(/less volume/);
  });
});
