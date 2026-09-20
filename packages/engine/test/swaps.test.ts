import { describe, expect, it } from 'vitest';
import { applySwap, difficultyScore, regionOverlap, swapCandidates } from '../src/swaps.js';
import { prescribe, type AssemblyInput } from '../src/assembly.js';
import { buildLedger } from '../src/ledger.js';
import { neutralReadiness } from '../src/readiness.js';
import type { Exercise, Injury } from '../src/types.js';
import { BASELINE_INJURIES, EXERCISES, EXERCISE_BY_ID, HOME, PLANET_FITNESS } from '../fixtures/library.js';

const TODAY = '2026-09-22';

function assemblyInput(over: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    today: TODAY, type: 'strength', budgetMin: 45, targetRegions: [], location: HOME,
    ledger: buildLedger({ today: TODAY, history: [], exercises: EXERCISES }),
    readiness: neutralReadiness(), injuries: [], goal: 'tone', exercises: EXERCISES,
    history: [], bodyweightLb: 205, deloadVolumeMultiplier: 1, deloadLoadMultiplier: 1,
    verticalFocus: false, plyoContactsThisWeek: 0, ...over,
  };
}

function target(id: string, over: Partial<AssemblyInput> = {}) {
  const ex = EXERCISE_BY_ID.get(id) as Exercise;
  return prescribe({ exercise: ex, input: assemblyInput(over), isPrimary: true, why: 'test' });
}

function candidates(id: string, over: Partial<AssemblyInput> = {}) {
  const t = target(id, over);
  return swapCandidates({
    target: t,
    sessionExercises: [t],
    exercises: EXERCISES,
    location: over.location ?? HOME,
    ledger: over.ledger ?? buildLedger({ today: TODAY, history: [], exercises: EXERCISES }),
    injuries: over.injuries ?? [],
    history: [],
    bodyweightLb: 205,
  });
}

describe('difficulty', () => {
  it('rates a barbell squat harder than a leg press', () => {
    const squat = EXERCISE_BY_ID.get('barbell-back-squat') as Exercise;
    const press = EXERCISE_BY_ID.get('leg-press') as Exercise;
    expect(difficultyScore(squat)).toBeGreaterThan(difficultyScore(press));
  });

  it('rates an assisted pull-up easier than a strict one', () => {
    const strict = EXERCISE_BY_ID.get('pull-up') as Exercise;
    const assisted = EXERCISE_BY_ID.get('assisted-pull-up') as Exercise;
    expect(difficultyScore(assisted)).toBeLessThan(difficultyScore(strict));
  });
});

describe('region overlap', () => {
  it('is 1 for an exercise against itself', () => {
    const bench = EXERCISE_BY_ID.get('db-bench-press') as Exercise;
    expect(regionOverlap(bench, bench)).toBeCloseTo(1, 4);
  });

  it('is low for unrelated movements', () => {
    const bench = EXERCISE_BY_ID.get('db-bench-press') as Exercise;
    const tib = EXERCISE_BY_ID.get('tibialis-raise') as Exercise;
    expect(regionOverlap(bench, tib)).toBeLessThan(0.2);
  });
});

describe('candidates', () => {
  it('offers alternatives for a squat', () => {
    const list = candidates('goblet-squat');
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((c) => c.exercise.id)).not.toContain('goblet-squat');
  });

  it('only offers what the location can perform', () => {
    const list = candidates('smith-squat', { location: PLANET_FITNESS });
    expect(list.map((c) => c.exercise.id)).not.toContain('barbell-back-squat');
    expect(list.every((c) => c.exercise.equipment.length === 0 || c.exercise.equipment.some((e) =>
      PLANET_FITNESS.equipment.some((s) => s.equipment === e && s.available) || e === 'bodyweight',
    ))).toBe(true);
  });

  it('never offers something blocked by an injury', () => {
    const flare: Injury[] = [{ ...BASELINE_INJURIES[0]!, current_pain: 8, aggravators: [] }];
    const list = candidates('db-bench-press', { injuries: flare });
    expect(list.map((c) => c.exercise.id)).not.toContain('smith-squat');
  });

  it('gives a balanced carousel with more than one difficulty', () => {
    const list = candidates('goblet-squat');
    const buckets = new Set(list.map((c) => c.difficulty));
    expect(buckets.size).toBeGreaterThan(1);
  });

  it('labels everything easier when the target is the hardest thing in the building', () => {
    // The Smith squat is the heaviest squat pattern Planet Fitness stocks —
    // there is no barbell and no rack, so nothing there is harder.
    const list = candidates('smith-squat', { location: PLANET_FITNESS });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.difficulty === 'easier')).toBe(true);
  });

  it('ranks a curated alternative first', () => {
    const list = candidates('smith-squat', { location: PLANET_FITNESS });
    expect(['leg-press', 'goblet-squat']).toContain(list[0]!.exercise.id);
  });

  it('falls back to generic ranking when nothing curated is stocked here', () => {
    // Home has neither the leg press nor an assisted machine; the carousel must
    // still return something rather than nothing.
    expect(candidates('pull-up').length).toBeGreaterThan(0);
  });

  it('carries a re-derived prescription and a time estimate', () => {
    const list = candidates('goblet-squat');
    expect(list[0]!.sets.length).toBeGreaterThan(0);
    expect(list[0]!.estimated_min).toBeGreaterThan(0);
  });

  it('gives every candidate a human reason', () => {
    for (const c of candidates('db-row')) expect(c.reason.length).toBeGreaterThan(5);
  });
});

describe('applying a swap', () => {
  it('replaces the exercise in place and re-times the session', () => {
    const t = target('goblet-squat');
    const session = {
      blocks: [{ kind: 'strength' as const, title: 'Strength', exercises: [t], estimated_min: t.estimated_min }],
      estimated_min: t.estimated_min,
    };
    const candidate = candidates('goblet-squat')[0]!;
    const next = applySwap(session, 'goblet-squat', candidate);

    expect(next.blocks[0]!.exercises[0]!.exercise_id).toBe(candidate.exercise.id);
    expect(next.blocks[0]!.estimated_min).toBeCloseTo(candidate.estimated_min, 2);
    expect(next.blocks[0]!.exercises[0]!.why).toMatch(/Swapped in for/);
  });

  it('does not mutate the original session', () => {
    const t = target('goblet-squat');
    const session = {
      blocks: [{ kind: 'strength' as const, title: 'Strength', exercises: [t], estimated_min: t.estimated_min }],
      estimated_min: t.estimated_min,
    };
    applySwap(session, 'goblet-squat', candidates('goblet-squat')[0]!);
    expect(session.blocks[0]!.exercises[0]!.exercise_id).toBe('goblet-squat');
  });

  it('leaves the session untouched when the exercise is not in it', () => {
    const t = target('goblet-squat');
    const session = {
      blocks: [{ kind: 'strength' as const, title: 'Strength', exercises: [t], estimated_min: t.estimated_min }],
      estimated_min: t.estimated_min,
    };
    const next = applySwap(session, 'not-present', candidates('goblet-squat')[0]!);
    expect(next.blocks[0]!.exercises[0]!.exercise_id).toBe('goblet-squat');
  });
});
