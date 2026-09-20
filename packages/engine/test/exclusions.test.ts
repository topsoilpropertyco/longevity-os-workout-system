import { describe, expect, it } from 'vitest';
import { flaggedRegions, injuryBlocks, orderingViolations, violatedExclusion } from '../src/exclusions.js';
import { INJURY } from '../src/constants.js';
import type { Exercise, Injury, SessionBlock } from '../src/types.js';
import { BASELINE_INJURIES, EXERCISE_BY_ID } from '../fixtures/library.js';

const nordic = EXERCISE_BY_ID.get('nordic-curl') as Exercise;
const depthJump = EXERCISE_BY_ID.get('depth-jump') as Exercise;
const sprint = EXERCISE_BY_ID.get('sprint-accel') as Exercise;
const trapBar = EXERCISE_BY_ID.get('trap-bar-deadlift') as Exercise;
const splitSquat = EXERCISE_BY_ID.get('atg-split-squat') as Exercise;
const bench = EXERCISE_BY_ID.get('db-bench-press') as Exercise;

const noFlags = { flaggedRegions: new Set<never>() } as never;

describe('pairing exclusions', () => {
  it('refuses Nordics with depth jumps', () => {
    const v = violatedExclusion(depthJump, [nordic], { flaggedRegions: new Set() });
    expect(v).not.toBeNull();
    expect(v!.exclusion.id).toBe('nordics_plus_depth_jumps');
  });

  it('is symmetric — order of discovery does not matter', () => {
    expect(violatedExclusion(nordic, [depthJump], { flaggedRegions: new Set() })).not.toBeNull();
  });

  it('refuses heavy spinal loading with max-effort sprints', () => {
    const v = violatedExclusion(sprint, [trapBar], { flaggedRegions: new Set() });
    expect(v).not.toBeNull();
    expect(v!.exclusion.id).toBe('spinal_load_plus_max_sprint');
  });

  it('allows an ordinary pairing through', () => {
    expect(violatedExclusion(bench, [splitSquat], { flaggedRegions: new Set() })).toBeNull();
  });

  it('applies the shoulder rule only when the shoulder is actually flagged', () => {
    const ohp = EXERCISE_BY_ID.get('db-overhead-press') as Exercise;
    expect(violatedExclusion(ohp, [bench], { flaggedRegions: new Set() })).toBeNull();
    const flagged = violatedExclusion(ohp, [bench], { flaggedRegions: new Set(['shoulders']) });
    expect(flagged).not.toBeNull();
  });

  it('honours a curated contraindication on the exercise record', () => {
    const a: Exercise = { ...bench, id: 'a', slug: 'a', contraindicated_with: ['b'] };
    const b: Exercise = { ...bench, id: 'b', slug: 'b' };
    expect(violatedExclusion(a, [b], { flaggedRegions: new Set() })).not.toBeNull();
    expect(violatedExclusion(b, [a], { flaggedRegions: new Set() })).not.toBeNull();
  });
});

describe('injury blocking', () => {
  const kneeFlare: Injury[] = [{ ...BASELINE_INJURIES[0]!, current_pain: 8, aggravators: [] }];

  it('blocks heavy loading of a painful region', () => {
    const squat = EXERCISE_BY_ID.get('smith-squat') as Exercise;
    expect(injuryBlocks(squat, kneeFlare, INJURY.pain_block_threshold).blocked).toBe(true);
  });

  it('lets rehab movements for that exact region through — that is the point of KOT', () => {
    expect(splitSquat.rehab_for).toContain('knees_quads');
    expect(injuryBlocks(splitSquat, kneeFlare, INJURY.pain_block_threshold).blocked).toBe(false);
  });

  it('blocks a named aggravator regardless of pain level', () => {
    const named: Injury[] = [{ ...BASELINE_INJURIES[0]!, current_pain: 1, aggravators: ['nordic'] }];
    expect(injuryBlocks(nordic, named, INJURY.pain_block_threshold).blocked).toBe(true);
  });

  it('ignores resolved injuries', () => {
    const resolved: Injury[] = [{ ...kneeFlare[0]!, resolved_on: '2026-09-01' }];
    const squat = EXERCISE_BY_ID.get('smith-squat') as Exercise;
    expect(injuryBlocks(squat, resolved, INJURY.pain_block_threshold).blocked).toBe(false);
  });

  it('does not block an unrelated region', () => {
    expect(injuryBlocks(bench, kneeFlare, INJURY.pain_block_threshold).blocked).toBe(false);
  });
});

describe('flagged regions', () => {
  it('lists unresolved injuries only', () => {
    const set = flaggedRegions([
      BASELINE_INJURIES[0]!,
      { ...BASELINE_INJURIES[1]!, resolved_on: '2026-09-01' },
    ]);
    expect(set.has('knees_quads')).toBe(true);
    expect(set.has('low_back')).toBe(false);
  });
});

describe('concurrent-training ordering', () => {
  const block = (kind: SessionBlock['kind']): SessionBlock => ({ kind, title: kind, exercises: [], estimated_min: 10 });

  it('flags power scheduled after aerobic work', () => {
    const v = orderingViolations([block('zone2'), block('power')]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/interference/);
  });

  it('accepts power before aerobic work', () => {
    expect(orderingViolations([block('power'), block('strength'), block('zone2')])).toHaveLength(0);
  });
});
