import { describe, expect, it } from 'vitest';
import { chooseSessionType, sessionsToday } from '../src/template.js';
import { buildLedger } from '../src/ledger.js';
import { neutralReadiness } from '../src/readiness.js';
import { weeklyDose } from '../src/weekly.js';
import { WEEKLY } from '../src/constants.js';
import type { CardioLog, Injury, SessionLog, WeeklyDose } from '../src/types.js';
import { BASELINE_INJURIES, EXERCISES, KOT } from '../fixtures/library.js';
import { addDays } from '../src/util.js';

const TODAY = '2026-09-22';
const FRESH = buildLedger({ today: TODAY, history: [], exercises: EXERCISES });

const EMPTY_DOSE: WeeklyDose = {
  zone2_min: 0, zone2_target_min: WEEKLY.zone2_target_min, zone2_ceiling_min: 60,
  vo2_sessions: 0, strength_min: 0, strength_target_min: WEEKLY.strength_min_range,
  mobility_sessions: 0, plyo_contacts: 0, tonnage_lb: 0, sessions: 0,
};

function choose(over: Partial<Parameters<typeof chooseSessionType>[0]> = {}) {
  return chooseSessionType({
    today: TODAY, readiness: neutralReadiness(), dose: EMPTY_DOSE, ledger: FRESH,
    history: [], cardioHistory: [], injuries: [], goal: 'tone', budgetMin: 45,
    hasProgram: true, deload: false, ...over,
  });
}

describe('overrides', () => {
  it('forces recovery when readiness says so, whatever the week needs', () => {
    const d = choose({ readiness: { ...neutralReadiness(), band: 'recovery', score: 40 } });
    expect(d.type).toBe('recovery');
    expect(d.considered).toHaveLength(1);
  });

  it('honours a day pulled forward from the carousel', () => {
    const d = choose({ forcedType: 'vo2' });
    expect(d.type).toBe('vo2');
    expect(d.rationale).toMatch(/moved this one to today/);
  });

  it('lets recovery outrank even a forced type', () => {
    const d = choose({ forcedType: 'vo2', readiness: { ...neutralReadiness(), band: 'recovery', score: 40 } });
    expect(d.type).toBe('recovery');
  });
});

describe('hard constraints', () => {
  it('will not schedule KOT when the lower body is still recovering', () => {
    const history: SessionLog[] = [{
      id: 'x', date: addDays(TODAY, -1), type: 'strength', duration_min: 40, completed: true,
      exercises: [
        { exercise_id: 'goblet-squat', sets: [{ set_index: 0, reps: 8, load_lb: 100, rpe: 9, completed: true }] },
        { exercise_id: 'db-rdl', sets: [{ set_index: 0, reps: 8, load_lb: 200, rpe: 9, completed: true }] },
      ],
    }];
    const ledger = buildLedger({ today: TODAY, history, exercises: EXERCISES });
    const d = choose({ ledger, history });
    const kot = d.considered.find((c) => c.type === 'kot');
    if (kot) expect(kot.score).toBe(0);
    expect(d.type).not.toBe('kot');
  });

  it('will not schedule plyometrics on consecutive days', () => {
    const history: SessionLog[] = [{
      id: 'p', date: addDays(TODAY, -1), type: 'power', duration_min: 30, completed: true, exercises: [],
    }];
    const d = choose({ history });
    const power = d.considered.find((c) => c.type === 'power');
    expect(power?.score ?? 0).toBe(0);
    expect(power?.note).toMatch(/day between them/);
  });

  it('will not schedule VO2 the day after hard cardio', () => {
    const cardioHistory: CardioLog[] = [{
      date: addDays(TODAY, -1), modality: 'run', duration_min: 30, source: 'strava',
      zone_minutes: { z1: 2, z2: 5, z3: 5, z4: 15, z5: 3 },
    }];
    const d = choose({ cardioHistory });
    const vo2 = d.considered.find((c) => c.type === 'vo2');
    expect(vo2?.score ?? 0).toBe(0);
    expect(vo2?.note).toMatch(/no two in a row/);
  });

  it('stops prescribing strength past the point of added longevity benefit', () => {
    const d = choose({ dose: { ...EMPTY_DOSE, strength_min: WEEKLY.strength_hard_cap_min + 10 } });
    const strength = d.considered.find((c) => c.type === 'strength');
    expect(strength?.score).toBe(0);
    expect(strength?.note).toMatch(/longevity benefit/);
  });

  it('respects the aerobic ramp ceiling', () => {
    const d = choose({ dose: { ...EMPTY_DOSE, zone2_min: 60, zone2_ceiling_min: 60 } });
    const z2 = d.considered.find((c) => c.type === 'zone2');
    expect(z2?.note).toMatch(/10% rule/);
  });
});

describe('priorities', () => {
  it('gives the active program first claim when the week owes it sessions', () => {
    expect(choose().type).toBe('kot');
  });

  it('does not schedule a program day without a program', () => {
    expect(choose({ hasProgram: false }).type).not.toBe('kot');
  });

  it('leans toward mobility and Zone 2 on a very short day', () => {
    const d = choose({ budgetMin: 15, hasProgram: false });
    expect(['mobility', 'zone2', 'strength']).toContain(d.type);
  });

  it('avoids repeating yesterday\'s session type', () => {
    const history: SessionLog[] = [{
      id: 'y', date: addDays(TODAY, -1), type: 'strength', duration_min: 40, completed: true, exercises: [],
    }];
    const withRepeat = choose({ history, hasProgram: false });
    const strength = withRepeat.considered.find((c) => c.type === 'strength');
    const fresh = choose({ hasProgram: false }).considered.find((c) => c.type === 'strength');
    expect(strength!.score).toBeLessThan(fresh!.score);
  });

  it('steers away from the hardest options on a reduced day', () => {
    const d = choose({ readiness: { ...neutralReadiness(), band: 'reduced', score: 60 } });
    expect(['vo2', 'power', 'sprint']).not.toContain(d.type);
  });

  it('never schedules power during a deload', () => {
    const d = choose({ deload: true });
    expect(d.type).not.toBe('power');
  });

  it('returns a rationale and the full consideration list every time', () => {
    const d = choose();
    expect(d.rationale.length).toBeGreaterThan(5);
    expect(d.considered.length).toBeGreaterThan(1);
  });
});

describe('the last resort', () => {
  it('falls back to recovery rather than nothing when everything is blocked', () => {
    const everythingSore: SessionLog[] = EXERCISES.map((e, i) => ({
      id: `s${i}`, date: addDays(TODAY, -1), type: 'strength' as const, duration_min: 40, completed: true,
      exercises: [{ exercise_id: e.id, sets: [{ set_index: 0, reps: 8, load_lb: 300, rpe: 10 as const, completed: true }] }],
    }));
    const ledger = buildLedger({ today: TODAY, history: everythingSore, exercises: EXERCISES });
    const d = chooseSessionType({
      today: TODAY, readiness: neutralReadiness(), ledger,
      dose: { ...EMPTY_DOSE, zone2_min: 60, zone2_ceiling_min: 60, strength_min: 200, vo2_sessions: 1, mobility_sessions: 5 },
      history: everythingSore, cardioHistory: [], injuries: [], goal: 'tone', budgetMin: 45,
      hasProgram: true, deload: false,
    });
    // Something physical every day is a product goal, so the answer is never "nothing".
    expect(['recovery', 'mobility', 'zone2']).toContain(d.type);
  });
});

describe('target regions', () => {
  it('points a KOT day at the lower body', () => {
    expect(choose().targetRegions.length).toBeGreaterThan(0);
  });

  it('gives a recovery day no target regions', () => {
    expect(choose({ readiness: { ...neutralReadiness(), band: 'recovery', score: 40 } }).targetRegions).toHaveLength(0);
  });

  it('sends a strength day to whichever half of the body is freshest', () => {
    const legsCooked: SessionLog[] = [{
      id: 'l', date: addDays(TODAY, -1), type: 'strength', duration_min: 40, completed: true,
      exercises: [
        { exercise_id: 'goblet-squat', sets: [{ set_index: 0, reps: 8, load_lb: 100, rpe: 9, completed: true }] },
        { exercise_id: 'db-rdl', sets: [{ set_index: 0, reps: 8, load_lb: 200, rpe: 9, completed: true }] },
      ],
    }];
    const ledger = buildLedger({ today: TODAY, history: legsCooked, exercises: EXERCISES });
    const d = choose({ ledger, history: legsCooked, hasProgram: false, dose: { ...EMPTY_DOSE, mobility_sessions: 5 } });
    if (d.type === 'strength') {
      expect(d.targetRegions).not.toContain('knees_quads');
      expect(d.targetRegions).not.toContain('posterior_chain');
    }
  });
});

describe('weekly dose', () => {
  it('counts only completed sessions inside the window', () => {
    const history: SessionLog[] = [
      { id: 'a', date: addDays(TODAY, -2), type: 'strength', duration_min: 40, completed: true, exercises: [] },
      { id: 'b', date: addDays(TODAY, -2), type: 'strength', duration_min: 40, completed: false, exercises: [] },
      { id: 'c', date: addDays(TODAY, -20), type: 'strength', duration_min: 40, completed: true, exercises: [] },
    ];
    const dose = weeklyDose({ today: TODAY, history, cardioHistory: [], exercises: EXERCISES });
    expect(dose.sessions).toBe(1);
    expect(dose.strength_min).toBe(40);
  });

  it('finds sessions already logged today', () => {
    const history: SessionLog[] = [
      { id: 'a', date: TODAY, type: 'strength', duration_min: 40, completed: true, exercises: [] },
      { id: 'b', date: addDays(TODAY, -1), type: 'strength', duration_min: 40, completed: true, exercises: [] },
    ];
    expect(sessionsToday(history, TODAY)).toHaveLength(1);
  });
});
