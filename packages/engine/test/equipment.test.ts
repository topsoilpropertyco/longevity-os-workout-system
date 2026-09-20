import { describe, expect, it } from 'vitest';
import {
  achievableLoad, availableEquipment, barWeightFor, describeLocation,
  isBarbellFreeLocation, isPerformableAt, loadCapability, resolveEquipment,
} from '../src/equipment.js';
import type { Exercise } from '../src/types.js';
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
