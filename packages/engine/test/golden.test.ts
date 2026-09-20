/**
 * Golden-file tests.
 *
 * These snapshot the engine's actual output for each fixture day. They are not
 * about correctness — the other suites cover that — they are about CHANGE
 * DETECTION: if a tweak to the ranking, the time estimate, or a constant quietly
 * alters what Seth is told to do, a diff appears here and a human decides
 * whether that was the intent.
 *
 * Update deliberately with `npx vitest run -u`, and read the diff before you do.
 */
import { describe, expect, it } from 'vitest';
import { plan } from '../src/plan.js';
import { ALL_FIXTURES, DOCS_WORKED_EXAMPLE } from '../fixtures/days.js';
import type { PlanResult, PrescribedSession } from '../src/types.js';

/** A compact, human-readable shape of a session — the part worth pinning. */
function summarize(session: PrescribedSession) {
  return {
    date: session.date,
    type: session.type,
    title: session.title,
    deload: session.deload,
    readiness: {
      band: session.readiness.band,
      score: session.readiness.score,
      source: session.readiness.source,
    },
    estimated_min: session.estimated_min,
    why: session.why,
    blocks: session.blocks.map((b) => ({
      kind: b.kind,
      title: b.title,
      minutes: b.estimated_min,
      cardio: b.cardio
        ? { modality: b.cardio.modality, structure: b.cardio.structure, minutes: b.cardio.duration_min, bpm: b.cardio.target_bpm }
        : undefined,
      exercises: b.exercises.map((e) => ({
        id: e.exercise_id,
        sets: e.sets.length,
        reps: e.sets[0]?.reps,
        load_lb: e.sets[0]?.load_lb,
        rpe: e.sets[0]?.rpe_target,
      })),
    })),
  };
}

function summarizePlan(result: PlanResult) {
  return {
    today: summarize(result.today),
    week: result.week.map((d) => ({ date: d.date, type: d.session.type, minutes: d.session.estimated_min })),
    weekly: result.weekly,
    warnings: result.warnings,
    signature: result.signature,
    blocked_regions: Object.values(result.ledger)
      .filter((e) => !e.available)
      .map((e) => e.region)
      .sort(),
  };
}

describe('golden plans', () => {
  for (const [name, fixture] of Object.entries(ALL_FIXTURES)) {
    it(`${name} is unchanged`, () => {
      expect(summarizePlan(plan(fixture))).toMatchSnapshot();
    });
  }
});

describe('the worked example in docs/ENGINE.md', () => {
  const result = plan(DOCS_WORKED_EXAMPLE);

  it('is unchanged', () => {
    expect(summarizePlan(result)).toMatchSnapshot();
  });

  // The documentation states these facts about this exact input. If one of them
  // stops being true, the doc is wrong and this test is how we find out.
  it('reads readiness 72 as the as-planned band', () => {
    expect(result.today.readiness.score).toBe(72);
    expect(result.today.readiness.band).toBe('as_planned');
    expect(result.today.readiness.load_multiplier).toBe(1);
    expect(result.today.readiness.rpe_cap).toBeUndefined();
  });

  it('fits a 30-minute budget with warm-up and cool-down on top', () => {
    expect(DOCS_WORKED_EXAMPLE.goals.warmup_outside_budget).toBe(true);
    const working = result.today.blocks
      .filter((b) => b.kind !== 'warmup' && b.kind !== 'cooldown')
      .reduce((a, b) => a + b.estimated_min, 0);
    expect(working).toBeLessThanOrEqual(32);
  });

  it('is not a deload and not a recovery day', () => {
    expect(result.today.deload).toBe(false);
    expect(result.today.type).not.toBe('recovery');
  });

  it('prescribes only what a home gym can do', () => {
    const ids = result.today.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id));
    expect(ids).not.toContain('leg-press');
    expect(ids).not.toContain('smith-squat');
    expect(ids).not.toContain('barbell-back-squat');
  });

  it('rounds every dumbbell load to a Bowflex notch', () => {
    for (const block of result.today.blocks) {
      for (const pe of block.exercises) {
        if (pe.exercise.load_style !== 'total_dumbbell_pair') continue;
        expect(pe.sets[0]!.load_lb % 5).toBe(0);
        expect(pe.sets[0]!.load_lb).toBeLessThanOrEqual(105);
      }
    }
  });
});
