import { describe, expect, it } from 'vitest';
import {
  assemble,
  candidatePool,
  cooldownBlock,
  estimateMinutes,
  prescribe,
  warmupBlock,
  type AssemblyInput,
} from '../src/assembly.js';
import { buildLedger } from '../src/ledger.js';
import { neutralReadiness } from '../src/readiness.js';
import { ASSEMBLY, PLYO_CONTACTS } from '../src/constants.js';
import type { Exercise, Injury, PrescribedSet } from '../src/types.js';
import { BASELINE_INJURIES, EXERCISES, EXERCISE_BY_ID, HOME, KOT, PLANET_FITNESS } from '../fixtures/library.js';

const TODAY = '2026-09-22';

function input(over: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    today: TODAY,
    type: 'strength',
    budgetMin: 45,
    targetRegions: [],
    location: HOME,
    ledger: buildLedger({ today: TODAY, history: [], exercises: EXERCISES }),
    readiness: neutralReadiness(),
    injuries: [],
    goal: 'tone',
    exercises: EXERCISES,
    history: [],
    bodyweightLb: 205,
    deloadVolumeMultiplier: 1,
    deloadLoadMultiplier: 1,
    verticalFocus: false,
    plyoContactsThisWeek: 0,
    ...over,
  };
}

describe('time estimation', () => {
  it('accounts for setup, work, and rest', () => {
    const sets: PrescribedSet[] = [
      { set_index: 0, reps: 10, load_lb: 100, rest_s: 60 },
      { set_index: 1, reps: 10, load_lb: 100, rest_s: 60 },
    ];
    // 60s setup + 2×10×3.5s work + 1×60s rest = 190s ≈ 3.17 min
    expect(estimateMinutes(sets)).toBeCloseTo(3.17, 1);
  });

  it('does not charge rest after the final set', () => {
    const one: PrescribedSet[] = [{ set_index: 0, reps: 10, load_lb: 100, rest_s: 300 }];
    expect(estimateMinutes(one)).toBeLessThan(2);
  });
});

describe('candidate pool', () => {
  it('excludes anything the location cannot perform', () => {
    const pool = candidatePool(input({ location: PLANET_FITNESS }));
    expect(pool.map((c) => c.exercise.id)).not.toContain('barbell-back-squat');
    expect(pool.map((c) => c.exercise.id)).not.toContain('pull-up');
  });

  it('excludes exercises blocked by a painful region', () => {
    const flare: Injury[] = [{ ...BASELINE_INJURIES[0]!, current_pain: 8, aggravators: [] }];
    const pool = candidatePool(input({ injuries: flare }));
    expect(pool.map((c) => c.exercise.id)).not.toContain('goblet-squat');
  });

  it('keeps rehab movements for the painful region', () => {
    const flare: Injury[] = [{ ...BASELINE_INJURIES[0]!, current_pain: 8, aggravators: [] }];
    const pool = candidatePool(input({ injuries: flare }));
    expect(pool.map((c) => c.exercise.id)).toContain('atg-split-squat');
  });

  it('excludes exercises the ledger has vetoed', () => {
    const ledger = buildLedger({
      today: TODAY,
      history: [{
        id: 'x', date: '2026-09-21', type: 'strength', duration_min: 40, completed: true,
        exercises: [{ exercise_id: 'db-rdl', sets: [{ set_index: 0, reps: 8, load_lb: 200, rpe: 9, completed: true }] }],
      }],
      exercises: EXERCISES,
    });
    const pool = candidatePool(input({ ledger }));
    expect(pool.map((c) => c.exercise.id)).not.toContain('db-rdl');
  });

  it('ranks exercises hitting the target regions above the rest', () => {
    const pool = candidatePool(input({ targetRegions: ['chest'] }));
    expect(pool[0]!.exercise.region_loads.chest ?? 0).toBeGreaterThan(0);
  });
});

describe('prescription', () => {
  it('rounds the load to what the rack holds', () => {
    const splitSquat = EXERCISE_BY_ID.get('atg-split-squat') as Exercise;
    const p = prescribe({ exercise: splitSquat, input: input(), isPrimary: true, why: 'test' });
    // Bowflex: 2.5 lb per hand → 5 lb total increments.
    expect(p.sets[0]!.load_lb % 5).toBe(0);
    expect(p.sets[0]!.load_lb).toBeLessThanOrEqual(105);
  });

  it('caps load at the heaviest dumbbell and says so', () => {
    const splitSquat = EXERCISE_BY_ID.get('atg-split-squat') as Exercise;
    const history = Array.from({ length: 6 }, (_, i) => ({
      id: `h${i}`, date: `2026-08-${String(10 + i).padStart(2, '0')}`, type: 'kot' as const,
      duration_min: 30, completed: true,
      exercises: [{ exercise_id: 'atg-split-squat', sets: [{ set_index: 0, reps: 5, load_lb: 300, rpe: 8 as const, completed: true }] }],
    }));
    const p = prescribe({ exercise: splitSquat, input: input({ history }), isPrimary: true, why: 'test' });
    expect(p.sets[0]!.load_lb).toBe(105);
    expect(p.why).toMatch(/heaviest here/);
  });

  it('prescribes zero load for a movement with no load concept', () => {
    const walk = EXERCISE_BY_ID.get('backward-walk') as Exercise;
    const p = prescribe({ exercise: walk, input: input(), isPrimary: false, why: 'test' });
    expect(p.sets[0]!.load_lb).toBe(0);
  });

  it('honours the readiness RPE cap on every set', () => {
    const bench = EXERCISE_BY_ID.get('db-bench-press') as Exercise;
    const capped = { ...neutralReadiness(), rpe_cap: 7 as const };
    const p = prescribe({ exercise: bench, input: input({ readiness: capped }), isPrimary: true, why: 'test' });
    expect(p.sets.every((s) => (s.rpe_target ?? 10) <= 7)).toBe(true);
  });

  it('lightens a cautioned region and explains why', () => {
    const squat = EXERCISE_BY_ID.get('goblet-squat') as Exercise;
    const sore: Injury[] = [{ ...BASELINE_INJURIES[0]!, current_pain: 4, aggravators: [] }];
    const p = prescribe({ exercise: squat, input: input({ injuries: sore }), isPrimary: true, why: 'test' });
    expect(p.why).toMatch(/flagged region/);
  });
});

describe('assembly', () => {
  it('fits inside the budget', () => {
    const result = assemble(input({ budgetMin: 30 }));
    expect(result.estimatedMin).toBeLessThanOrEqual(30 + ASSEMBLY.overrun_tolerance_min);
  });

  it('produces something even on a 15-minute budget', () => {
    const result = assemble(input({ budgetMin: 15 }));
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.estimatedMin).toBeLessThanOrEqual(15 + ASSEMBLY.overrun_tolerance_min);
  });

  it('never prescribes an exercise the location cannot perform', () => {
    const result = assemble(input({ location: PLANET_FITNESS, budgetMin: 60 }));
    const ids = result.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id));
    expect(ids).not.toContain('barbell-back-squat');
    expect(ids).not.toContain('pull-up');
  });

  it('orders blocks power → program → strength → conditioning → zone2 → mobility', () => {
    const result = assemble(input({ type: 'kot', program: KOT, budgetMin: 60 }));
    const order = ['warmup', 'power', 'program', 'strength', 'conditioning', 'zone2', 'mobility', 'cooldown'];
    const seen = result.blocks.map((b) => order.indexOf(b.kind));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('takes its dose from the program standard, not the goal mode', () => {
    const result = assemble(input({ type: 'kot', program: KOT, budgetMin: 60 }));
    const program = result.blocks.find((b) => b.kind === 'program');
    const tib = program?.exercises.find((e) => e.exercise.slug === 'tibialis-raise');
    // Phase 1 Zero runs the tibialis raise twice a session at 25 reps. The dose
    // comes from that standard, not from the 'tone' goal mode's 3 × 10.
    expect(tib?.sets).toHaveLength(2);
    expect(tib?.sets[0]!.reps).toBe(25);
  });

  it('prescribes timed program work as a clock, not as reps', () => {
    const result = assemble(input({ type: 'kot', program: KOT, budgetMin: 60 }));
    const program = result.blocks.find((b) => b.kind === 'program');
    const walk = program?.exercises.find((e) => e.exercise.slug === 'backward-walk');
    expect(walk?.sets[0]!.reps).toBe(0);
    expect(walk?.sets[0]!.duration_s).toBeGreaterThan(0);
    // "Hold this for ten minutes at RPE 8" is not an instruction anyone can follow.
    expect(walk?.sets[0]!.rpe_target).toBeUndefined();
  });

  it('charges timed work its duration, so a ten-minute walk costs ten minutes', () => {
    const result = assemble(input({ type: 'kot', program: KOT, budgetMin: 90 }));
    const walk = result.blocks
      .find((b) => b.kind === 'program')
      ?.exercises.find((e) => e.exercise.slug === 'backward-walk');
    expect(walk!.estimated_min).toBeGreaterThan(5);
  });

  it('compresses timed program work rather than dropping the signature movement', () => {
    // On a short day the ATG split squat must survive. A shortened backward walk
    // is still Knees Over Toes; a session without the split squat is not.
    const result = assemble(input({ type: 'kot', program: KOT, budgetMin: 30 }));
    const slugs = result.blocks.flatMap((b) => b.exercises.map((e) => e.exercise.slug));
    expect(slugs).toContain('atg-split-squat');
    expect(slugs).toContain('backward-walk');
    const walk = result.blocks
      .find((b) => b.kind === 'program')
      ?.exercises.find((e) => e.exercise.slug === 'backward-walk');
    expect(walk!.sets[0]!.duration_s).toBeLessThan(600);
    expect(walk!.sets[0]!.duration_s).toBeGreaterThanOrEqual(180);
  });

  it('follows the program ground-up ordering', () => {
    const result = assemble(input({ type: 'kot', program: KOT, budgetMin: 60 }));
    const program = result.blocks.find((b) => b.kind === 'program');
    expect(program).toBeDefined();
    const slugs = program!.exercises.map((e) => e.exercise.slug);
    const backwardIdx = slugs.indexOf('backward-walk');
    const splitIdx = slugs.indexOf('atg-split-squat');
    if (backwardIdx >= 0 && splitIdx >= 0) expect(backwardIdx).toBeLessThan(splitIdx);
  });

  it('adds the McGill Big 3 when the low back is flagged', () => {
    const result = assemble(input({ injuries: [BASELINE_INJURIES[1]!], budgetMin: 45 }));
    const slugs = result.blocks.flatMap((b) => b.exercises.map((e) => e.exercise.slug));
    expect(slugs).toEqual(expect.arrayContaining(['mcgill-curl-up']));
  });

  it('refuses plyometrics once the weekly contact budget is spent', () => {
    const result = assemble(input({ type: 'power', plyoContactsThisWeek: PLYO_CONTACTS.intermediate[1] + 10 }));
    expect(result.notes.join(' ')).toMatch(/contacts for the week are used up/);
    expect(result.blocks.find((b) => b.kind === 'power')).toBeUndefined();
  });

  it('gates depth jumps behind a strength base', () => {
    const result = assemble(input({ type: 'power', budgetMin: 45 }));
    const ids = result.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id));
    expect(ids).not.toContain('depth-jump');
  });

  it('never puts the same movement pattern in twice', () => {
    const result = assemble(input({ budgetMin: 60 }));
    const strength = result.blocks.find((b) => b.kind === 'strength');
    if (strength) {
      const patterns = strength.exercises.map((e) => e.exercise.pattern);
      expect(new Set(patterns).size).toBe(patterns.length);
    }
  });

  it('pairs push with pull on a short budget', () => {
    const result = assemble(input({ budgetMin: 25 }));
    expect(result.notes.join(' ')).toMatch(/Paired push with pull/);
  });

  it('records a note when the constraints ran out of safe options', () => {
    const everythingBlocked = input({
      budgetMin: 60,
      injuries: EXERCISES.map((e, i) => ({
        id: `i${i}`, region: 'knees_quads' as const, label: 'knees', onset: '2020-01-01',
        kind: 'longstanding' as const, current_pain: 9 as const, aggravators: [],
      })).slice(0, 1),
    });
    const result = assemble(everythingBlocked);
    expect(result.blocks.length + result.notes.length).toBeGreaterThan(0);
  });

  it('shrinks volume under a deload', () => {
    const normal = assemble(input({ budgetMin: 45 }));
    const deloaded = assemble(input({ budgetMin: 45, deloadVolumeMultiplier: 0.6, deloadLoadMultiplier: 0.875 }));
    const setsOf = (r: typeof normal) => r.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets)).length;
    expect(setsOf(deloaded)).toBeLessThanOrEqual(setsOf(normal));
  });
});

describe('the bookend blocks', () => {
  // These reserve minutes and prescribe nothing on purpose, so the minutes have
  // to say what they are for. The focus string used to be computed and dropped.
  it('names the regions the warm-up is for', () => {
    const block = warmupBlock(5, ['knees_quads', 'hips_glutes']);
    expect(block.note).toBeDefined();
    expect(block.note).toContain('knees quads');
    expect(block.note).toContain('hips glutes');
    expect(block.note).not.toContain('_');
  });

  it('still says something useful when there is no region focus', () => {
    expect(warmupBlock(5, []).note).toBeTruthy();
    expect(cooldownBlock(5).note).toBeTruthy();
  });

  it('gives the cool-down the same treatment', () => {
    expect(cooldownBlock(5, ['posterior_chain']).note).toContain('posterior chain');
  });

  it('reserves the minutes it was asked for', () => {
    expect(warmupBlock(7, []).estimated_min).toBe(7);
    expect(cooldownBlock(3).estimated_min).toBe(3);
  });
});

describe('the why line reads as sentences', () => {
  // The reported line was:
  //   "Knees Over Toes — 25 reps, per side 10 lb is the lightest available…"
  // Two sentences joined by a bare space, so it reads "per side 10 lb". Seth
  // reads this on a card at 6 a.m.
  const splitSquat = EXERCISE_BY_ID.get('atg-split-squat')!;
  const programClause = 'Knees Over Toes — 25 reps, per side';

  it('punctuates between clauses', () => {
    const p = prescribe({ exercise: splitSquat, input: input(), isPrimary: true, why: programClause });
    expect(p.why).toContain('lightest available');
    expect(p.why).not.toContain('per side 10 lb');
    expect(p.why.startsWith(`${programClause}.`)).toBe(true);
  });

  it('does not double up punctuation a clause already has', () => {
    const p = prescribe({
      exercise: EXERCISE_BY_ID.get('goblet-squat')!,
      input: input(),
      isPrimary: true,
      why: 'Your main lift today — the one worth being fresh for.',
    });
    expect(p.why).not.toContain('..');
  });

  it('ends every clause of a multi-clause why with a stop', () => {
    const p = prescribe({
      exercise: splitSquat,
      input: input({ injuries: [{ ...BASELINE_INJURIES[0]!, current_pain: 4 }] }),
      isPrimary: true,
      why: programClause,
    });
    const clauses = p.why.split(/(?<=\.) /);
    expect(clauses.length).toBeGreaterThan(1);
    for (const clause of clauses) expect(clause.trim().endsWith('.')).toBe(true);
  });
});
