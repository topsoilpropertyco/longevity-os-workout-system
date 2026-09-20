/**
 * Longevity OS — Equipment & Location Resolution
 *
 * Answers two questions the rest of the engine keeps asking:
 *   1. Can this exercise be performed at this location?
 *   2. What load can actually be put on the bar, the rack, or the stack?
 *
 * Planet Fitness reality (RESEARCH §2) is the reason this module exists:
 * no Olympic barbells, no racks, no bumpers, no chalk, and a Smith bar that
 * weighs 15–20 lb rather than 45. Prescribing 185 on a bar that is not there is
 * exactly the kind of thing that makes Seth stop trusting the app.
 */

import type { Equipment, Exercise, GymLocation, LoadStyle } from './types.js';
import { round, roundToIncrement } from './util.js';

/** Bodyweight is always available, wherever he is. */
const ALWAYS_AVAILABLE: Equipment[] = ['bodyweight'];

export function availableEquipment(location: GymLocation): Set<Equipment> {
  const set = new Set<Equipment>(ALWAYS_AVAILABLE);
  for (const spec of location.equipment) {
    if (spec.available) set.add(spec.equipment);
  }
  return set;
}

/**
 * Can this exercise be done here? An exercise with no equipment requirement is
 * bodyweight and always passes; otherwise ANY one of its listed options suffices.
 */
export function isPerformableAt(ex: Exercise, location: GymLocation): boolean {
  if (ex.equipment.length === 0) return true;
  const have = availableEquipment(location);
  return ex.equipment.some((e) => have.has(e));
}

/** The equipment option this location would actually use for the exercise. */
export function resolveEquipment(ex: Exercise, location: GymLocation): Equipment | null {
  if (ex.equipment.length === 0) return 'bodyweight';
  const have = availableEquipment(location);
  // Preference order: free weights before machines before bands, because the
  // free-weight version is almost always the better training stimulus.
  const preference: Equipment[] = [
    'adjustable_dumbbell', 'dumbbell', 'kettlebell', 'barbell', 'trap_bar',
    'ez_curl_bar', 'fixed_barbell', 'smith_machine', 'cable_machine',
    'functional_trainer', 'selectorized_machine', 'resistance_bands', 'bodyweight',
  ];
  for (const p of preference) {
    if (ex.equipment.includes(p) && have.has(p)) return p;
  }
  return ex.equipment.find((e) => have.has(e)) ?? null;
}

export interface LoadCapability {
  /** Smallest load that can be put on this implement, INCLUDING the bar. */
  min_lb: number;
  /** Largest load available. Infinity when unconstrained (e.g. a plate-loaded bar). */
  max_lb: number;
  /** Smallest step between achievable loads. */
  increment_lb: number;
  /** Bar weight included in min/max, 0 when not applicable. */
  bar_lb: number;
  equipment: Equipment | null;
}

/**
 * What loads exist at this location for this exercise. Used to round every
 * prescription to something Seth can physically pick up.
 */
export function loadCapability(ex: Exercise, location: GymLocation): LoadCapability {
  const eq = resolveEquipment(ex, location);
  const spec = location.equipment.find((s) => s.equipment === eq && s.available);

  const bar_lb = barWeightFor(ex.load_style, eq, location);

  // Bodyweight and unloaded movements: added load only, from whatever is around.
  if (ex.load_style === 'bodyweight' || ex.load_style === 'none') {
    return { min_lb: 0, max_lb: spec?.max_lb ?? 0, increment_lb: spec?.increment_lb ?? 5, bar_lb: 0, equipment: eq };
  }

  if (ex.load_style === 'total_dumbbell_pair') {
    // Dumbbell specs are per hand; the prescription is the pair's total.
    const perHandMin = spec?.min_lb ?? 5;
    const perHandMax = spec?.max_lb ?? 75;
    const perHandInc = spec?.increment_lb ?? 5;
    return {
      min_lb: perHandMin * 2,
      max_lb: perHandMax * 2,
      increment_lb: perHandInc * 2,
      bar_lb: 0,
      equipment: eq,
    };
  }

  return {
    min_lb: spec?.min_lb ?? bar_lb,
    max_lb: spec?.max_lb ?? Infinity,
    increment_lb: spec?.increment_lb ?? (ex.load_style === 'stack' ? 10 : 5),
    bar_lb,
    equipment: eq,
  };
}

/**
 * The bar's own weight at this location.
 *
 * Planet Fitness Smith machines are counterbalanced: the effective bar weight is
 * roughly 15–20 lb, not the 45 lb people assume. Getting this wrong makes every
 * Smith prescription wrong by 25 lb, so it is a per-location setting.
 */
export function barWeightFor(style: LoadStyle, eq: Equipment | null, location: GymLocation): number {
  if (style === 'smith' || eq === 'smith_machine') return location.smith_bar_weight_lb;
  if (style === 'barbell' || eq === 'barbell' || eq === 'trap_bar') return location.bar_weight_lb;
  if (eq === 'ez_curl_bar') return 20;
  return 0;
}

/**
 * Round a desired total load to something achievable here, and say so when the
 * equipment could not deliver it. A capped load is not a failure — it is a fact
 * the "why" line should mention.
 */
export function achievableLoad(
  desiredTotalLb: number,
  cap: LoadCapability,
): { load_lb: number; capped: 'min' | 'max' | null } {
  if (cap.increment_lb <= 0) return { load_lb: round(desiredTotalLb, 1), capped: null };

  if (desiredTotalLb <= cap.min_lb) {
    return { load_lb: round(cap.min_lb, 1), capped: desiredTotalLb < cap.min_lb ? 'min' : null };
  }
  if (desiredTotalLb >= cap.max_lb) {
    return { load_lb: round(cap.max_lb, 1), capped: 'max' };
  }

  // Round the LOADED portion, then add the bar back — plates come in increments,
  // the bar does not.
  const loaded = desiredTotalLb - cap.bar_lb;
  const rounded = roundToIncrement(loaded, cap.increment_lb, 0, cap.max_lb - cap.bar_lb);
  return { load_lb: round(rounded + cap.bar_lb, 1), capped: null };
}

/**
 * A location with no barbell needs a `barbell_free` alternative for every
 * technical barbell lift (CLAUDE.md, RESEARCH §2). True when this location is
 * one of those.
 */
export function isBarbellFreeLocation(location: GymLocation): boolean {
  const have = availableEquipment(location);
  return !have.has('barbell') && !have.has('power_rack');
}

/** Human-readable equipment summary for the location chip and the why line. */
export function describeLocation(location: GymLocation): string {
  const have = availableEquipment(location);
  const highlights: string[] = [];
  if (have.has('adjustable_dumbbell') || have.has('dumbbell')) {
    const spec = location.equipment.find(
      (s) => (s.equipment === 'adjustable_dumbbell' || s.equipment === 'dumbbell') && s.available,
    );
    highlights.push(spec?.max_lb ? `dumbbells to ${spec.max_lb} lb` : 'dumbbells');
  }
  if (have.has('barbell')) highlights.push('barbell');
  else if (have.has('smith_machine')) highlights.push(`Smith (${location.smith_bar_weight_lb} lb bar)`);
  if (have.has('cable_machine') || have.has('functional_trainer')) highlights.push('cables');
  if (have.has('pull_up_bar') || have.has('assisted_pullup_machine')) highlights.push('pull-up');
  return highlights.join(' · ');
}
