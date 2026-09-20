/**
 * Longevity OS — Pairing Exclusions
 *
 * Hard constraints on what may share a session. RESEARCH §6.3, CLAUDE.md
 * invariant 5: a session that violates one of these is a bug, not a trade-off.
 *
 * Also enforces the concurrent-training ordering rule from RESEARCH §6.2 —
 * power work never follows aerobic work in the same session.
 */

import { PAIRING_EXCLUSIONS, type ExclusionMatcher, type PairingExclusion } from './constants.js';
import type { Exercise, Injury, Region, SessionBlock } from './types.js';

export interface ExclusionContext {
  /** Regions currently flagged by an unresolved injury. */
  flaggedRegions: Set<Region>;
  /** Intensity of the planned work, 0–1 relative to e1RM, keyed by exercise id. */
  intensityById?: Map<string, number>;
}

/**
 * Assumed intensity when the caller has not supplied one. A prescribed working
 * set IS heavy by default — assuming otherwise would quietly disable every
 * exclusion that carries a `min_intensity`, which is most of them.
 */
const ASSUMED_WORKING_INTENSITY = 0.8;

function matches(ex: Exercise, m: ExclusionMatcher, intensity: number): boolean {
  if (m.min_intensity !== undefined && intensity < m.min_intensity) return false;
  if (m.eccentric_dominant !== undefined && ex.eccentric_dominant !== m.eccentric_dominant) return false;
  if (m.patterns && !m.patterns.includes(ex.pattern)) return false;
  if (m.slug_contains && !m.slug_contains.some((frag) => ex.slug.includes(frag))) return false;
  if (m.regions) {
    const touches = m.regions.some((r) => (ex.region_loads[r] ?? 0) >= 0.5);
    if (!touches) return false;
  }
  return true;
}

/**
 * Would adding `candidate` to a session already containing `present` break a rule?
 * Returns the violated exclusion, or null when the pairing is fine.
 */
export function violatedExclusion(
  candidate: Exercise,
  present: Exercise[],
  ctx: ExclusionContext,
): { exclusion: PairingExclusion; conflictsWith: Exercise } | null {
  const candidateIntensity = ctx.intensityById?.get(candidate.id) ?? ASSUMED_WORKING_INTENSITY;

  for (const rule of PAIRING_EXCLUSIONS) {
    if (rule.only_if_region_flagged && !ctx.flaggedRegions.has(rule.only_if_region_flagged)) continue;

    for (const other of present) {
      const otherIntensity = ctx.intensityById?.get(other.id) ?? ASSUMED_WORKING_INTENSITY;
      const forward =
        matches(candidate, rule.a, candidateIntensity) && matches(other, rule.b, otherIntensity);
      const reverse =
        matches(candidate, rule.b, candidateIntensity) && matches(other, rule.a, otherIntensity);
      if (forward || reverse) return { exclusion: rule, conflictsWith: other };
    }
  }

  // Curated per-exercise contraindications, straight from the exercise library.
  for (const other of present) {
    if (candidate.contraindicated_with?.includes(other.slug)) {
      return {
        exclusion: {
          id: `curated:${candidate.slug}+${other.slug}`,
          reason: `${candidate.name} and ${other.name} are flagged as a bad pair in the exercise library.`,
          a: { slug_contains: [candidate.slug] },
          b: { slug_contains: [other.slug] },
        },
        conflictsWith: other,
      };
    }
    if (other.contraindicated_with?.includes(candidate.slug)) {
      return {
        exclusion: {
          id: `curated:${other.slug}+${candidate.slug}`,
          reason: `${other.name} and ${candidate.name} are flagged as a bad pair in the exercise library.`,
          a: { slug_contains: [other.slug] },
          b: { slug_contains: [candidate.slug] },
        },
        conflictsWith: candidate,
      };
    }
  }

  return null;
}

/** Regions with an unresolved injury. Feeds both exclusions and load caps. */
export function flaggedRegions(injuries: Injury[]): Set<Region> {
  return new Set(injuries.filter((i) => !i.resolved_on).map((i) => i.region));
}

/**
 * An exercise is contraindicated when an unresolved injury names it as an
 * aggravator, or when pain in a region it heavily loads is above the block
 * threshold — unless the exercise is explicitly rehabilitative FOR that region,
 * which is the whole point of Knees Over Toes.
 */
export function injuryBlocks(
  ex: Exercise,
  injuries: Injury[],
  painBlockThreshold: number,
): { blocked: boolean; reason?: string } {
  for (const injury of injuries) {
    if (injury.resolved_on) continue;

    const named = injury.aggravators.some(
      (a) => ex.slug.includes(slugify(a)) || ex.name.toLowerCase().includes(a.toLowerCase()),
    );
    if (named) {
      return { blocked: true, reason: `${ex.name} aggravates your ${injury.label}.` };
    }

    const weight = ex.region_loads[injury.region] ?? 0;
    if (weight >= 0.5 && injury.current_pain >= painBlockThreshold) {
      if (ex.rehab_for?.includes(injury.region)) continue; // rehab is allowed through
      return {
        blocked: true,
        reason: `${injury.label} is at ${injury.current_pain}/10 — nothing heavy through there today.`,
      };
    }
  }
  return { blocked: false };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Verify the concurrent-training ordering rule after assembly: no power or
 * sprint block may appear after a zone2 or conditioning block (RESEARCH §6.2).
 * Returns the violations found; an empty array means the session is legal.
 */
export function orderingViolations(blocks: SessionBlock[]): string[] {
  const out: string[] = [];
  let sawAerobic = false;
  for (const block of blocks) {
    if (block.kind === 'zone2' || block.kind === 'conditioning') sawAerobic = true;
    if (block.kind === 'power' && sawAerobic) {
      out.push('Power work is scheduled after aerobic work — interference risk (RESEARCH §6.2).');
    }
  }
  return out;
}
