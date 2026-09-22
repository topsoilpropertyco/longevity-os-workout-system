import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_SUBSUMPTION,
  achievableLoad, availableEquipment, barWeightFor, describeLocation,
  isBarbellFreeLocation, isPerformableAt, loadCapability, resolveEquipment,
} from '../src/equipment.js';
import type { Equipment, Exercise, GymLocation } from '../src/types.js';
import { BODYWEIGHT_ONLY, EXERCISE_BY_ID, HOME, PLANET_FITNESS } from '../fixtures/library.js';

const barbellSquat = EXERCISE_BY_ID.get('barbell-back-squat') as Exercise;
const smithSquat = EXERCISE_BY_ID.get('smith-squat') as Exercise;
const splitSquat = EXERCISE_BY_ID.get('atg-split-squat') as Exercise;
const pullUp = EXERCISE_BY_ID.get('pull-up') as Exercise;
const legPress = EXERCISE_BY_ID.get('leg-press') as Exercise;

describe('Planet Fitness reality', () => {
  it('has no barbell and no rack', () => {
    const have = availableEquipment(PLANET_FITNESS);
    expect(have.has('barbell')).toBe(false);
    expect(have.has('power_rack')).toBe(false);
    expect(have.has('bumper_plates')).toBe(false);
    expect(have.has('chalk')).toBe(false);
  });

  it('is classified as a barbell-free location', () => {
    expect(isBarbellFreeLocation(PLANET_FITNESS)).toBe(true);
    expect(isBarbellFreeLocation(HOME)).toBe(true);
  });

  it('refuses to make a barbell squat performable there', () => {
    expect(isPerformableAt(barbellSquat, PLANET_FITNESS)).toBe(false);
    expect(isPerformableAt(smithSquat, PLANET_FITNESS)).toBe(true);
  });

  it('uses the counterbalanced Smith bar weight, not 45 lb', () => {
    expect(barWeightFor('smith', 'smith_machine', PLANET_FITNESS)).toBe(20);
    expect(PLANET_FITNESS.smith_bar_weight_lb).toBeLessThanOrEqual(20);
  });

  it('includes the Smith bar in the prescribed total load', () => {
    const cap = loadCapability(smithSquat, PLANET_FITNESS);
    expect(cap.bar_lb).toBe(20);
    // Ask for 135 total: the plates round, then the bar is added back.
    const { load_lb } = achievableLoad(135, cap);
    expect(load_lb).toBe(135);
  });
});

describe('home', () => {
  it('knows the Bowflex dumbbells cap at 52.5 lb per hand', () => {
    const cap = loadCapability(splitSquat, HOME);
    // Dumbbell specs are per hand; the prescription is the pair's total.
    expect(cap.max_lb).toBe(105);
    expect(cap.increment_lb).toBe(5);
  });

  it('caps a prescription that exceeds the rack and says so', () => {
    const cap = loadCapability(splitSquat, HOME);
    const { load_lb, capped } = achievableLoad(200, cap);
    expect(load_lb).toBe(105);
    expect(capped).toBe('max');
  });

  it('has a pull-up bar, which Planet Fitness does not', () => {
    expect(isPerformableAt(pullUp, HOME)).toBe(true);
    expect(isPerformableAt(pullUp, PLANET_FITNESS)).toBe(false);
  });

  it('has no leg press', () => {
    expect(isPerformableAt(legPress, HOME)).toBe(false);
    expect(isPerformableAt(legPress, PLANET_FITNESS)).toBe(true);
  });
});

describe('bodyweight only', () => {
  it('still allows bodyweight movements', () => {
    const pogo = EXERCISE_BY_ID.get('pogo-hop') as Exercise;
    expect(isPerformableAt(pogo, BODYWEIGHT_ONLY)).toBe(true);
  });

  it('allows anything with an empty equipment list', () => {
    const anywhere: Exercise = { ...pullUp, id: 'x', slug: 'x', equipment: [] };
    expect(isPerformableAt(anywhere, BODYWEIGHT_ONLY)).toBe(true);
  });
});

describe('equipment preference', () => {
  it('prefers free weights over machines when both exist', () => {
    expect(resolveEquipment(splitSquat, HOME)).toBe('adjustable_dumbbell');
  });

  it('returns null when nothing here can perform the movement', () => {
    expect(resolveEquipment(barbellSquat, PLANET_FITNESS)).toBeNull();
  });
});

describe('load rounding', () => {
  it('rounds down to the nearest achievable stack weight', () => {
    const cap = loadCapability(legPress, PLANET_FITNESS);
    const { load_lb } = achievableLoad(187, cap);
    expect(load_lb % cap.increment_lb).toBe(0);
  });

  it('reports when the lightest available option is still too heavy', () => {
    const cap = loadCapability(legPress, PLANET_FITNESS);
    const { capped } = achievableLoad(5, cap);
    expect(capped).toBe('min');
  });
});

describe('descriptions', () => {
  it('summarises a location for the chip', () => {
    expect(describeLocation(HOME)).toMatch(/dumbbells to 52.5 lb/);
    expect(describeLocation(PLANET_FITNESS)).toMatch(/Smith \(20 lb bar\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Equipment subsumption
//
// The authored library names the equipment a movement NEEDS; a location names
// what it HAS. Without a table saying which of the second satisfies the first,
// `seated-good-morning` (bench_flat, dumbbell, smith_machine) is unreachable at
// Home, which owns an adjustable bench and a pair of adjustable dumbbells —
// and two steps of the program vanish from the session with only a note.
// ─────────────────────────────────────────────────────────────────────────────

/** A location with exactly one thing in it, for testing one edge of the table. */
function only(...equipment: Equipment[]): GymLocation {
  return {
    ...HOME,
    id: 'loc-test',
    name: 'test',
    equipment: equipment.map((e) => ({ equipment: e, available: true })),
  };
}

function needs(...equipment: Equipment[]): Exercise {
  return { ...splitSquat, id: 'test-ex', slug: 'test-ex', equipment };
}

describe('equipment subsumption', () => {
  it('lets an adjustable bench stand in for a flat bench', () => {
    expect(isPerformableAt(needs('bench_flat'), only('bench_adjustable'))).toBe(true);
  });

  it('does NOT let a flat bench stand in for an adjustable one', () => {
    // An incline press on a flat bench is a different exercise.
    expect(isPerformableAt(needs('bench_adjustable'), only('bench_flat'))).toBe(false);
  });

  it('treats adjustable dumbbells and dumbbells as the same pair of dumbbells', () => {
    expect(isPerformableAt(needs('dumbbell'), only('adjustable_dumbbell'))).toBe(true);
    expect(isPerformableAt(needs('adjustable_dumbbell'), only('dumbbell'))).toBe(true);
  });

  it('reaches the real seated good morning at home', () => {
    // The shape of `seated-good-morning` in data/curated-exercises.json, which
    // is a Dense step and a Standards benchmark.
    const seatedGoodMorning = needs('bench_flat', 'dumbbell', 'smith_machine');
    expect(isPerformableAt(seatedGoodMorning, HOME)).toBe(true);
    expect(isPerformableAt(seatedGoodMorning, PLANET_FITNESS)).toBe(true);
    expect(isPerformableAt(seatedGoodMorning, BODYWEIGHT_ONLY)).toBe(false);
  });

  it('prices the substitute off the equipment the room actually owns', () => {
    // The trap: matching `dumbbell` at Home and then pricing it as a dumbbell
    // rack gives 5–75 lb in 5 lb steps. Home has a Bowflex: 5–52.5 per hand in
    // 2.5 lb steps. A load he cannot physically select is worse than no load.
    const dbOnly = { ...needs('dumbbell'), load_style: 'total_dumbbell_pair' as const };
    expect(resolveEquipment(dbOnly, HOME)).toBe('adjustable_dumbbell');
    const cap = loadCapability(dbOnly, HOME);
    expect(cap.max_lb).toBe(105);
    expect(cap.increment_lb).toBe(5);
  });

  it('lets a functional trainer stand in for a cable machine, but not the reverse', () => {
    expect(isPerformableAt(needs('cable_machine'), only('functional_trainer'))).toBe(true);
    expect(isPerformableAt(needs('functional_trainer'), only('cable_machine'))).toBe(false);
  });

  it('never invents a barbell', () => {
    // RESEARCH §2: Planet Fitness has no barbell, and that is the whole reason
    // `barbell_free` alternatives exist. A Smith bar is not a barbell, a trap
    // bar is not a barbell, and a rack is not a bar.
    expect(isPerformableAt(needs('barbell'), only('smith_machine'))).toBe(false);
    expect(isPerformableAt(needs('barbell'), only('trap_bar'))).toBe(false);
    expect(isPerformableAt(needs('barbell'), only('power_rack'))).toBe(false);
    expect(isPerformableAt(needs('barbell'), PLANET_FITNESS)).toBe(false);
    expect(isBarbellFreeLocation(PLANET_FITNESS)).toBe(true);
  });

  it('keeps every claim in the table one the athlete could actually make', () => {
    // Guard against a future entry that would put him under a bar that is not
    // there: nothing may claim to satisfy a free barbell, a rack, or a Smith.
    for (const [owned, satisfied] of Object.entries(EQUIPMENT_SUBSUMPTION)) {
      for (const requirement of satisfied) {
        expect(requirement).not.toBe(owned);
        expect(['barbell', 'power_rack', 'smith_machine', 'trap_bar']).not.toContain(requirement);
      }
    }
  });
});
