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

/**
 * What one piece of equipment can stand in for.
 *
 * ── Why this table exists ────────────────────────────────────────────────────
 * An exercise names the equipment it NEEDS; a location names what it HAS, and
 * the two vocabularies are written by different hands. `seated-good-morning`
 * asks for `bench_flat` or `dumbbell`; Home owns a `bench_adjustable` and a
 * pair of `adjustable_dumbbell`s. Matched by identity, the movement is
 * unreachable at Home — and a step the program authored disappears from the
 * session with nothing but a note to show for it (ENGINE.md §8: "a hole in an
 * authored session that nobody can see is indistinguishable from a bug").
 *
 * ── Why it is a table and not a string match ─────────────────────────────────
 * Fuzzy matching on names would pair `smith_machine` with `barbell` — the one
 * pairing RESEARCH §2 is explicit is FALSE, and the whole reason `barbell_free`
 * alternatives exist. Every entry here is a claim that Seth can physically make
 * the movement with what is in the room, and a wrong claim puts him under a bar
 * that is not there. So: enumerated, one-directional unless stated, and
 * conservative. When in doubt, leave it out — the cost of an omission is a
 * substitution, the cost of a wrong entry is an injury.
 *
 * ── The entries, and the reasoning ───────────────────────────────────────────
 *   `bench_adjustable` → `bench_flat`
 *       An adjustable bench drops to flat, so it does everything a flat bench
 *       does. NOT the reverse: a flat bench cannot incline, and an incline
 *       press performed flat is a different exercise on different fibres.
 *
 *   `adjustable_dumbbell` ↔ `dumbbell` (both ways)
 *       Both are a pair of dumbbells in his hands. The Bowflex selects its
 *       weight instead of being picked off a rack, which changes the increment
 *       and the ceiling — and those are read from the location's own spec, not
 *       from this table, so the direction is safe both ways.
 *
 *   `functional_trainer` → `cable_machine`
 *       A functional trainer IS a cable stack, with two independently
 *       adjustable pulleys rather than one column. Anything a cable machine
 *       does it does. NOT the reverse: a lone fixed-height cable column cannot
 *       reproduce the dual-pulley work (the low cable pull-in at ankle height,
 *       a face pull at eye height), and RESEARCH §2 lists the two as separate
 *       items on the Planet Fitness inventory precisely because a club may have
 *       one and not the other.
 *
 * ── Considered and deliberately LEFT OUT ─────────────────────────────────────
 *   `smith_machine` → `barbell`      RESEARCH §2. No barbell at Planet Fitness;
 *                                    the Smith bar is counterbalanced to 15–20
 *                                    lb, is fixed in one plane, and cannot be
 *                                    unracked or bailed like a free bar. This
 *                                    is the pairing the whole `barbell_free`
 *                                    mechanism exists to avoid.
 *   `power_rack` → `barbell`         A rack is not a bar. Nor is a bar a rack.
 *   `trap_bar` / `fixed_barbell` /
 *     `ez_curl_bar` → `barbell`      Different bar paths, different grips, and
 *                                    fixed bars do not load past ~70 lb.
 *   `barbell` → `fixed_barbell`      Arguably true, but no seeded location has
 *                                    a free barbell, so the entry would buy
 *                                    nothing and still have to be got right.
 *   `kettlebell` ↔ `dumbbell`        Same for a swing or a goblet squat, not
 *                                    for a press, a row or a bench — the offset
 *                                    centre of mass is the point of the tool.
 *   `leg_press`, `calf_machine`, …
 *     → `selectorized_machine`       Backwards: a club with a leg press has a
 *                                    selectorized machine, but the generic
 *                                    requirement stands for whichever station
 *                                    the movement names, and a seated calf
 *                                    raise cannot be done on a lat pulldown.
 *   `assisted_pullup_machine`
 *     → `pull_up_bar`                Some are kneeling-pad only: no dead hang,
 *                                    no hanging leg raise, no true pull-up.
 *   `rings` → `suspension_trainer`   True in a gym that has rings; no seeded
 *                                    location has either, so it is an untested
 *                                    claim earning nothing.
 *   `recumbent_bike` ↔
 *     `stationary_bike`,
 *     `arc_trainer` → `elliptical`   Close, and both fixture gyms list both
 *                                    anyway, so the entry buys nothing; the
 *                                    cardio module already picks the modality a
 *                                    location can support (`availableModalities`).
 *   `slam_ball` ↔ `medicine_ball`    A slammed medicine ball bounces back at
 *                                    his face; a slam ball cannot be used for
 *                                    a wall ball.
 *   `track_or_open_space` ↔
 *     `outdoor_route`                A field is not a three-mile route, and a
 *                                    route is not a measured straight.
 *   `bench_flat` → `plyo_box`        A box jump onto a bench is how people
 *                                    break shins.
 *   `bench_adjustable`
 *     → `nordic_support`             Only with a strap or a partner. The
 *                                    fixture bench happens to have a foot
 *                                    catch; benches in general do not, and this
 *                                    table is about the category, not one bench.
 *
 * Keyed by what the location HAS; the value is what that satisfies.
 */
export const EQUIPMENT_SUBSUMPTION: Readonly<Partial<Record<Equipment, readonly Equipment[]>>> = {
  bench_adjustable: ['bench_flat'],
  adjustable_dumbbell: ['dumbbell'],
  dumbbell: ['adjustable_dumbbell'],
  functional_trainer: ['cable_machine'],
};

/** Does owning `owned` satisfy a requirement for `required`? */
export function satisfiesRequirement(owned: Equipment, required: Equipment): boolean {
  if (owned === required) return true;
  return (EQUIPMENT_SUBSUMPTION[owned] ?? []).includes(required);
}

/**
 * Literally what is in the room, with no substitution applied.
 *
 * This is the honest inventory: `isBarbellFreeLocation` and the location chip
 * both want to know what is physically there, not what could stand in for what.
 */
export function availableEquipment(location: GymLocation): Set<Equipment> {
  const set = new Set<Equipment>(ALWAYS_AVAILABLE);
  for (const spec of location.equipment) {
    if (spec.available) set.add(spec.equipment);
  }
  return set;
}

/**
 * Every requirement this location can meet — the inventory plus everything it
 * stands in for. Requirements are matched against THIS set; loads are still
 * priced off the real item (see `resolveEquipment`).
 */
export function effectiveEquipment(location: GymLocation): Set<Equipment> {
  const set = availableEquipment(location);
  for (const owned of [...set]) {
    for (const satisfied of EQUIPMENT_SUBSUMPTION[owned] ?? []) set.add(satisfied);
  }
  return set;
}

/**
 * The item in the room that meets this requirement, or null.
 *
 * An exact match always wins, so a location that owns both a rack of dumbbells
 * and a Bowflex resolves a `dumbbell` requirement to the rack. Otherwise the
 * location's own equipment list is scanned in its authored order, which keeps
 * the answer deterministic (invariant 1).
 */
function ownedSatisfying(required: Equipment, location: GymLocation): Equipment | null {
  const have = availableEquipment(location);
  if (have.has(required)) return required;
  for (const spec of location.equipment) {
    if (!spec.available) continue;
    if (satisfiesRequirement(spec.equipment, required)) return spec.equipment;
  }
  for (const always of ALWAYS_AVAILABLE) {
    if (satisfiesRequirement(always, required)) return always;
  }
  return null;
}

/**
 * Can this exercise be done here? An exercise with no equipment requirement is
 * bodyweight and always passes; otherwise ANY one of its listed options suffices
 * — met outright, or met by something that stands in for it.
 */
export function isPerformableAt(ex: Exercise, location: GymLocation): boolean {
  if (ex.equipment.length === 0) return true;
  const have = effectiveEquipment(location);
  return ex.equipment.some((e) => have.has(e));
}

/**
 * The equipment option this location would actually use for the exercise.
 *
 * Always a piece of equipment the location OWNS, never the requirement it
 * satisfied: `loadCapability` looks the answer up in `location.equipment` to
 * find the weights and the increment, and returning `dumbbell` for a house that
 * owns a Bowflex would price the prescription off a 5–75 lb rack in 5 lb steps
 * that is not in the room.
 */
export function resolveEquipment(ex: Exercise, location: GymLocation): Equipment | null {
  if (ex.equipment.length === 0) return 'bodyweight';
  // Preference order: free weights before machines before bands, because the
  // free-weight version is almost always the better training stimulus.
  const preference: Equipment[] = [
    'adjustable_dumbbell', 'dumbbell', 'kettlebell', 'barbell', 'trap_bar',
    'ez_curl_bar', 'fixed_barbell', 'smith_machine', 'cable_machine',
    'functional_trainer', 'selectorized_machine', 'resistance_bands', 'bodyweight',
  ];
  for (const p of preference) {
    if (!ex.equipment.includes(p)) continue;
    const owned = ownedSatisfying(p, location);
    if (owned) return owned;
  }
  for (const required of ex.equipment) {
    const owned = ownedSatisfying(required, location);
    if (owned) return owned;
  }
  return null;
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
  // Deliberately the literal inventory, not the effective one. Nothing in
  // `EQUIPMENT_SUBSUMPTION` claims to be a barbell or a rack and nothing ever
  // may (RESEARCH §2), so this asks the only question worth asking: is there a
  // bar in the room?
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
