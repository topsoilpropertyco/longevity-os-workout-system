/**
 * Longevity OS — derivations from source metadata to engine fields
 *
 * Pure functions: source vocabulary in, canonical `Exercise` fields out. Each
 * one is driven by a table in `vocab.ts` so the judgement lives in one auditable
 * place.
 */

import type {
  Equipment,
  Force,
  Level,
  LoadStyle,
  Mechanic,
  MovementPattern,
  Region,
  RegionLoadMap,
} from '../../packages/engine/src/types';
import {
  BARBELL_GATED_EQUIPMENT,
  ECCENTRIC_DOMINANT_PATTERNS,
  LOWER_BODY_REGIONS,
  MUSCLE_REGION_WEIGHTS,
  NAME_EQUIPMENT_HINTS,
  PATTERN_RULES,
  PLYO_CONTACT_RULES,
} from './vocab';
import { cleanName } from './normalize';

/** Primary muscles count full; secondary muscles count at 0.4 (per the brief). */
export const PRIMARY_MUSCLE_WEIGHT = 1.0;
export const SECONDARY_MUSCLE_WEIGHT = 0.4;

export interface UnmappedRecord {
  kind: 'equipment' | 'muscle';
  source: string;
  value: string;
  exampleExercise: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 0–1 per region from primary + secondary muscle lists. Clamped, rounded, sorted. */
export function deriveRegionLoads(
  primary: string[],
  secondary: string[],
  onUnmapped?: (muscle: string) => void,
): RegionLoadMap {
  const acc = new Map<Region, number>();
  const add = (muscle: string, scale: number) => {
    const key = muscle.trim().toLowerCase();
    if (!key) return;
    const weights = MUSCLE_REGION_WEIGHTS[key];
    if (!weights) {
      onUnmapped?.(key);
      return;
    }
    for (const [region, weight] of Object.entries(weights) as [Region, number][]) {
      acc.set(region, (acc.get(region) ?? 0) + weight * scale);
    }
  };
  for (const m of primary) add(m, PRIMARY_MUSCLE_WEIGHT);
  for (const m of secondary) add(m, SECONDARY_MUSCLE_WEIGHT);

  const out: RegionLoadMap = {};
  for (const region of [...acc.keys()].sort()) {
    const value = round2(Math.min(1, acc.get(region)!));
    if (value >= 0.05) out[region] = value;
  }
  return out;
}

export function dominantRegion(loads: RegionLoadMap): Region | undefined {
  let best: Region | undefined;
  let bestValue = -1;
  for (const key of Object.keys(loads).sort()) {
    const region = key as Region;
    const value = loads[region] ?? 0;
    if (value > bestValue) {
      best = region;
      bestValue = value;
    }
  }
  return best;
}

/** Movement pattern: name rules first (vocab.PATTERN_RULES), then a region fallback. */
export function derivePattern(
  name: string,
  category: string | undefined,
  mechanic: Mechanic,
  loads: RegionLoadMap,
): MovementPattern {
  const n = cleanName(name).toLowerCase();
  for (const rule of PATTERN_RULES) {
    if (rule.pattern.test(n)) return rule.movement;
  }
  const cat = (category ?? '').toLowerCase();
  if (cat === 'cardio') return 'cardio_steady';
  if (cat === 'plyometrics') return 'jump';
  if (cat === 'stretching') return 'mobility';

  const region = dominantRegion(loads);
  const lower = region ? LOWER_BODY_REGIONS.includes(region) : false;
  if (mechanic === 'compound') {
    if (region === 'core' || region === 'spine') return 'anti_extension';
    return lower ? 'squat' : 'horizontal_push';
  }
  return lower ? 'isolation_lower' : 'isolation_upper';
}

/** Equipment hints from the exercise name, used when the source value is absent/unmapped. */
export function equipmentFromName(name: string): Equipment[] {
  const n = cleanName(name).toLowerCase();
  for (const hint of NAME_EQUIPMENT_HINTS) {
    if (hint.pattern.test(n)) return [...hint.equipment];
  }
  return [];
}

/** Dedupe + sort so the output is deterministic. */
export function normalizeEquipmentList(list: Equipment[]): Equipment[] {
  return [...new Set(list)].sort();
}

/**
 * How load is entered for this movement (see the LoadStyle doc comments in
 * types.ts). Order matters: the most specific implement wins.
 */
export function deriveLoadStyle(
  equipment: Equipment[],
  pattern: MovementPattern,
  name: string,
): LoadStyle {
  const has = (e: Equipment) => equipment.includes(e);
  const n = cleanName(name).toLowerCase();
  if (pattern === 'mobility' || pattern === 'cardio_steady' || pattern === 'cardio_interval') {
    return 'none';
  }
  if (has('assisted_pullup_machine') || /\bassisted\b/.test(n)) return 'assisted';
  if (has('smith_machine')) return 'smith';
  if (has('barbell') || has('ez_curl_bar') || has('fixed_barbell') || has('trap_bar')) return 'barbell';
  if (has('dumbbell') || has('adjustable_dumbbell')) return 'total_dumbbell_pair';
  if (has('resistance_bands')) return 'band';
  if (
    has('cable_machine') ||
    has('functional_trainer') ||
    has('selectorized_machine') ||
    has('lat_pulldown') ||
    has('seated_row') ||
    has('leg_press') ||
    has('leg_extension') ||
    has('leg_curl') ||
    has('hip_abductor_adductor') ||
    has('calf_machine') ||
    has('chest_press_machine') ||
    has('shoulder_press_machine') ||
    has('pec_deck') ||
    has('ab_crunch_machine')
  ) {
    return 'stack';
  }
  if (has('kettlebell') || has('medicine_ball') || has('slam_ball') || has('sled')) {
    return 'single_implement';
  }
  if (pattern === 'jump' || pattern === 'sprint' || pattern === 'gait' || pattern === 'carry') {
    return equipment.length && !has('bodyweight') ? 'single_implement' : 'bodyweight';
  }
  return 'bodyweight';
}

/** Viable at a barbell-free gym? (RESEARCH §2 — Planet Fitness has no barbells/racks/sleds.) */
export function deriveBarbellFree(equipment: Equipment[]): boolean {
  return !equipment.some((e) => BARBELL_GATED_EQUIPMENT.includes(e));
}

export function deriveEccentricDominant(name: string): boolean {
  const n = cleanName(name).toLowerCase();
  return ECCENTRIC_DOMINANT_PATTERNS.some((re) => re.test(n));
}

export function derivePlyoContacts(name: string, pattern: MovementPattern): number {
  const n = cleanName(name).toLowerCase();
  for (const rule of PLYO_CONTACT_RULES) {
    if (rule.pattern.test(n)) return rule.contacts;
  }
  return pattern === 'jump' ? 1 : 0;
}

export function normalizeForce(value: string | null | undefined): Force {
  const v = (value ?? '').toLowerCase();
  if (v === 'push' || v === 'pull' || v === 'static') return v;
  return 'unknown';
}

export function normalizeMechanic(value: string | null | undefined): Mechanic {
  const v = (value ?? '').toLowerCase();
  if (v === 'compound' || v === 'isolation') return v;
  return 'unknown';
}

export function normalizeLevel(value: string | null | undefined): Level {
  const v = (value ?? '').toLowerCase();
  if (v === 'beginner' || v === 'intermediate' || v === 'expert') return v;
  return 'intermediate';
}
