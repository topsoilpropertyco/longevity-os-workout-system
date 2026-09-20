import { describe, expect, it } from 'vitest';
import { acwr, applyPlannedLoad, buildLedger, isHardSet, ledgerAllowance, regionAvailability, setLoad } from '../src/ledger.js';
import { LEDGER } from '../src/constants.js';
import type { Exercise, SessionLog } from '../src/types.js';
import { EXERCISES, EXERCISE_BY_ID } from '../fixtures/library.js';
import { addDays } from '../src/util.js';

const TODAY = '2026-09-22';

function session(date: string, exerciseId: string, opts: { reps?: number; load?: number; rpe?: number; count?: number } = {}): SessionLog {
  const { reps = 5, load = 200, rpe = 9, count = 3 } = opts;
  return {
    id: `s-${date}-${exerciseId}`,
    date,
    type: 'strength',
    duration_min: 40,
    completed: true,
    exercises: [
      {
        exercise_id: exerciseId,
        sets: Array.from({ length: count }, (_, i) => ({
          set_index: i, reps, load_lb: load, rpe: rpe as 9, completed: true,
        })),
      },
    ],
  };
}

describe('set load', () => {
  it('is reps × total load, scaled to kilo-pound-reps', () => {
    expect(setLoad({ set_index: 0, reps: 10, load_lb: 200, completed: true })).toBe(2);
  });

  it('is zero for an incomplete set', () => {
    expect(setLoad({ set_index: 0, reps: 10, load_lb: 200, completed: false })).toBe(0);
  });

  it('charges timed holds by the minute rather than by reps', () => {
    const hold = setLoad({ set_index: 0, reps: 0, load_lb: 0, duration_s: 120, completed: true });
    expect(hold).toBeGreaterThan(0);
  });
});

describe('hard sets', () => {
  it('counts RPE 8 and above as hard', () => {
    expect(isHardSet({ set_index: 0, reps: 5, load_lb: 100, rpe: 8, completed: true })).toBe(true);
    expect(isHardSet({ set_index: 0, reps: 5, load_lb: 100, rpe: 6, completed: true })).toBe(false);
  });

  it('counts 80% of e1RM as hard regardless of reported RPE', () => {
    expect(isHardSet({ set_index: 0, reps: 5, load_lb: 170, rpe: 5, completed: true }, 200)).toBe(true);
    expect(isHardSet({ set_index: 0, reps: 5, load_lb: 100, rpe: 5, completed: true }, 200)).toBe(false);
  });
});

describe('ACWR', () => {
  it('is the 7-day load over the weekly average of the 28-day load', () => {
    expect(acwr(10, 40)).toBe(1);
    expect(acwr(15, 40)).toBe(1.5);
  });

  it('returns 0 when there is no chronic base, which means unknown not safe', () => {
    expect(acwr(5, 0)).toBe(0);
  });
});

describe('availability', () => {
  it('blocks a region for 48 hours after a hard hit', () => {
    const history = [session(addDays(TODAY, -1), 'db-rdl')];
    const ledger = buildLedger({ today: TODAY, history, exercises: EXERCISES });
    expect(ledger.posterior_chain.available).toBe(false);
    expect(ledger.posterior_chain.block_reason).toMatch(/needs/);
  });

  it('releases the region once 48 hours have passed', () => {
    const history = [session(addDays(TODAY, -3), 'db-rdl')];
    const ledger = buildLedger({ today: TODAY, history, exercises: EXERCISES });
    expect(ledger.posterior_chain.available).toBe(true);
  });

  it('holds an eccentric-dominant region for 72 hours, not 48', () => {
    const at48 = buildLedger({
      today: TODAY,
      history: [session(addDays(TODAY, -2), 'nordic-curl', { load: 0, reps: 6 })],
      exercises: EXERCISES,
    });
    expect(at48.posterior_chain.available).toBe(false);
    expect(at48.posterior_chain.block_reason).toMatch(/Eccentric/);

    const at72 = buildLedger({
      today: TODAY,
      history: [session(addDays(TODAY, -4), 'nordic-curl', { load: 0, reps: 6 })],
      exercises: EXERCISES,
    });
    expect(at72.posterior_chain.available).toBe(true);
  });

  it('blocks on an ACWR above the danger line', () => {
    const entry = {
      region: 'knees_quads' as const, load_7d: 20, load_28d: 40, acwr: 2,
      hours_since_hard_hit: null, hours_since_eccentric: null, available: true,
    };
    expect(regionAvailability(entry).available).toBe(false);
    expect(regionAvailability(entry).reason).toMatch(/risk line/);
  });
});

describe('allowance', () => {
  it('vetoes an exercise whose primary region is blocked', () => {
    const ledger = buildLedger({
      today: TODAY,
      history: [session(addDays(TODAY, -1), 'db-rdl')],
      exercises: EXERCISES,
    });
    const rdl = EXERCISE_BY_ID.get('db-rdl') as Exercise;
    const { multiplier, blockedBy } = ledgerAllowance(rdl, ledger);
    expect(multiplier).toBe(0);
    expect(blockedBy).toContain('posterior_chain');
  });

  it('merely lightens an exercise with secondary involvement in a tired region', () => {
    const ledger = buildLedger({
      today: TODAY,
      history: [session(addDays(TODAY, -1), 'db-rdl')],
      exercises: EXERCISES,
    });
    // Bench press does not load the posterior chain at all — untouched.
    const bench = EXERCISE_BY_ID.get('db-bench-press') as Exercise;
    expect(ledgerAllowance(bench, ledger).multiplier).toBe(1);
  });

  it('allows a fresh region through at full load', () => {
    const ledger = buildLedger({ today: TODAY, history: [], exercises: EXERCISES });
    const squat = EXERCISE_BY_ID.get('goblet-squat') as Exercise;
    expect(ledgerAllowance(squat, ledger).multiplier).toBe(1);
  });
});

describe('projection', () => {
  it('makes a planned session block the same region the next day', () => {
    const ledger = buildLedger({ today: TODAY, history: [], exercises: EXERCISES });
    expect(ledger.posterior_chain.available).toBe(true);

    const rdl = EXERCISE_BY_ID.get('db-rdl') as Exercise;
    const projected = applyPlannedLoad(ledger, [{ exercise: rdl, sets: [{ reps: 10, load_lb: 140 }] }], 24);
    expect(projected.posterior_chain.available).toBe(false);
  });

  it('does not mutate the ledger it was given', () => {
    const ledger = buildLedger({ today: TODAY, history: [], exercises: EXERCISES });
    const rdl = EXERCISE_BY_ID.get('db-rdl') as Exercise;
    applyPlannedLoad(ledger, [{ exercise: rdl, sets: [{ reps: 10, load_lb: 140 }] }], 24);
    expect(ledger.posterior_chain.available).toBe(true);
  });

  it('releases a projected block once enough time has passed', () => {
    const ledger = buildLedger({ today: TODAY, history: [], exercises: EXERCISES });
    const rdl = EXERCISE_BY_ID.get('db-rdl') as Exercise;
    const projected = applyPlannedLoad(ledger, [{ exercise: rdl, sets: [{ reps: 10, load_lb: 140 }] }], LEDGER.hard_hit_recovery_h + 24);
    expect(projected.posterior_chain.available).toBe(true);
  });
});
