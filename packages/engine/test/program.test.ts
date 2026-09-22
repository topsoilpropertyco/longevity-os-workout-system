/**
 * Phased programs: gating, weekday templates, load rules, per-side volume.
 *
 * Knees Over Toes is not one program, it is three run in sequence. Zero is
 * bodyweight for twelve weeks; Dense ramps load off the calendar; Standards
 * chases twelve benchmarks. Every test here exists because without it the
 * engine will hand Seth a later phase's prescription on an earlier phase's day
 * — which is the difference between a rehab programme and an injury.
 */
import { describe, expect, it } from 'vitest';
import { assemble, programDayFor, resolvePhase, orderedProgramSteps, phaseLoadFor, type AssemblyInput } from '../src/assembly.js';
import { buildLedger } from '../src/ledger.js';
import { neutralReadiness } from '../src/readiness.js';
import { plan } from '../src/plan.js';
import { DOCS_WORKED_EXAMPLE } from '../fixtures/days.js';
import type { PlanInput, ProgramProgress } from '../src/types.js';
import {
  EXERCISES,
  HOME,
  KOT,
  KOT_PROGRESS,
  KOT_PROGRESS_DENSE_WEEK_5,
  KOT_PROGRESS_STANDARDS,
} from '../fixtures/library.js';

/** 2026-09-21 is a Monday; Zero, Dense and Standards all train on Mondays. */
const MONDAY = '2026-09-21';
/** 2026-09-23 is a Wednesday: a Zero and a Dense day, but NOT a Standards day. */
const WEDNESDAY = '2026-09-23';
/** 2026-09-26 is a Saturday. No phase of this program trains on a Saturday. */
const SATURDAY = '2026-09-26';

function input(over: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    today: MONDAY,
    type: 'kot',
    budgetMin: 45,
    targetRegions: [],
    location: HOME,
    ledger: buildLedger({ today: MONDAY, history: [], exercises: EXERCISES }),
    readiness: neutralReadiness(),
    injuries: [],
    goal: 'tone',
    exercises: EXERCISES,
    history: [],
    bodyweightLb: 200,
    program: KOT,
    programProgress: KOT_PROGRESS,
    deloadVolumeMultiplier: 1,
    deloadLoadMultiplier: 1,
    verticalFocus: false,
    plyoContactsThisWeek: 0,
    ...over,
  };
}

function stepIds(result: ReturnType<typeof assemble>): string[] {
  return result.blocks
    .filter((b) => b.kind === 'program')
    .flatMap((b) => b.exercises.map((e) => e.program_step_id ?? '?'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Phase gating
// ─────────────────────────────────────────────────────────────────────────────

describe('phase gating', () => {
  it('resolves the phase from the progress record', () => {
    expect(resolvePhase(KOT, KOT_PROGRESS)?.id).toBe('zero');
    expect(resolvePhase(KOT, KOT_PROGRESS_DENSE_WEEK_5)?.id).toBe('dense');
  });

  it('falls back to the program\'s current_phase_id when progress names none', () => {
    expect(resolvePhase(KOT, undefined)?.id).toBe('zero');
    expect(resolvePhase(KOT, { ...KOT_PROGRESS, phase_id: undefined })?.id).toBe('zero');
  });

  it('keeps only the active phase\'s steps in play', () => {
    const steps = orderedProgramSteps(KOT, KOT_PROGRESS, MONDAY);
    expect(steps.every((s) => s.phase_id === 'zero')).toBe(true);
  });

  // The bug this whole module exists for.
  it('never puts a Standards benchmark in a Zero week-1 session', () => {
    const stale: ProgramProgress = { ...KOT_PROGRESS, current_step_ids: [] };
    const ids = stepIds(assemble(input({ programProgress: stale, budgetMin: 90 })));
    expect(ids).not.toContain('kot-standards-rdl');
    expect(ids).not.toContain('kot-standards-split-squat');
    expect(ids.every((id) => id.startsWith('kot-zero-'))).toBe(true);
  });

  it('a step with no phase_id stays in play, so a flat program is unchanged', () => {
    const flat = { ...KOT, phases: undefined, days: undefined, current_phase_id: undefined,
      steps: KOT.steps.map((s) => ({ ...s, phase_id: undefined })) };
    const steps = orderedProgramSteps(flat, undefined, MONDAY);
    expect(steps.length).toBe(KOT.steps.length);
  });

  it('a phased program still honours a step that declares no phase', () => {
    // Off the day-template path — where a template exists it is the authority
    // on what runs, phase or no phase.
    const withGlobal = { ...KOT, days: undefined, steps: [...KOT.steps, {
      id: 'kot-every-phase-breathing', order: 99, block: 'mobility', name: 'Breathing',
      standard_text: '2 min.', exercise_slug: 'couch-stretch', standard: { hold_s: 120 },
    }] };
    // Empty `current_step_ids` is the case that used to open the whole pool.
    const steps = orderedProgramSteps(withGlobal, { ...KOT_PROGRESS, current_step_ids: [] }, MONDAY);
    expect(steps.map((s) => s.id)).toContain('kot-every-phase-breathing');
    expect(steps.every((s) => !s.phase_id || s.phase_id === 'zero')).toBe(true);
  });

  it('a day template is the authority on what runs, not the phase filter', () => {
    const steps = orderedProgramSteps(KOT, KOT_PROGRESS, MONDAY);
    expect(steps.map((s) => s.id)).toEqual([
      'kot-zero-walk', 'kot-zero-tib-raise', 'kot-zero-calf-raise', 'kot-zero-tib-raise',
      'kot-zero-patrick-step', 'kot-zero-split-squat', 'kot-zero-nordic',
      'kot-zero-elephant-walk', 'kot-zero-couch-stretch', 'kot-zero-body-squat',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Weekday templates
// ─────────────────────────────────────────────────────────────────────────────

describe('weekday templates', () => {
  it('finds the day template for (phase, weekday)', () => {
    expect(programDayFor(KOT, KOT_PROGRESS, MONDAY)?.title).toBe('Zero — same session every day');
    expect(programDayFor(KOT, KOT_PROGRESS_DENSE_WEEK_5, WEDNESDAY)?.title).toBe('Dense — Wednesday');
  });

  it('returns nothing on a weekday the phase does not train', () => {
    expect(programDayFor(KOT, KOT_PROGRESS, SATURDAY)).toBeUndefined();
    expect(programDayFor(KOT, KOT_PROGRESS_STANDARDS, WEDNESDAY)).toBeUndefined();
  });

  it('runs the day template\'s steps, in the day template\'s order', () => {
    const ids = stepIds(assemble(input({ budgetMin: 90 })));
    expect(ids.slice(0, 4)).toEqual([
      'kot-zero-walk', 'kot-zero-tib-raise', 'kot-zero-calf-raise', 'kot-zero-tib-raise',
    ]);
    // The optional body squat is listed last, after the stretches — not hoisted
    // into the first "Knee ability" block just because the title matches.
    expect(ids[ids.length - 1]).toBe('kot-zero-body-squat');
  });

  it('keeps a step that the day lists twice, twice', () => {
    const ids = stepIds(assemble(input({ budgetMin: 90 })));
    expect(ids.filter((id) => id === 'kot-zero-tib-raise')).toHaveLength(2);
  });

  it('keeps two blocks that share a title as two blocks', () => {
    const result = assemble(input({ budgetMin: 90 }));
    const titles = result.blocks.filter((b) => b.kind === 'program').map((b) => b.title);
    expect(titles.filter((t) => t.includes('Knee ability'))).toHaveLength(2);
  });

  it('gives a Dense Tuesday the Dense Tuesday session, not the Monday one', () => {
    const tuesday = '2026-09-22';
    const ids = stepIds(assemble(input({
      today: tuesday, programProgress: KOT_PROGRESS_DENSE_WEEK_5,
      ledger: buildLedger({ today: tuesday, history: [], exercises: EXERCISES }), budgetMin: 90,
    })));
    expect(ids).toContain('kot-dense-row');
    expect(ids).not.toContain('kot-dense-patrick-step');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Weekday scheduling in the template
// ─────────────────────────────────────────────────────────────────────────────

describe('the weekly template respects the phase calendar', () => {
  function withProgress(progress: ProgramProgress, today: string): PlanInput {
    return { ...DOCS_WORKED_EXAMPLE, today, program: KOT, program_progress: progress, history: [], cardio_history: [] };
  }

  it('never schedules a program day on a weekday the phase does not train', () => {
    const result = plan(withProgress(KOT_PROGRESS, MONDAY));
    for (const day of result.week) {
      if (day.session.type !== 'kot') continue;
      expect(KOT.phases![0]!.weekdays).toContain(day.day_index);
    }
  });

  it('plans KOT on a scheduled Monday when the knees are fresh', () => {
    expect(plan(withProgress(KOT_PROGRESS, MONDAY)).today.type).toBe('kot');
  });

  it('refuses a scheduled program day when the knees are still cooked', () => {
    // Wednesday IS a Zero day, and the knees took a hard session on Tuesday, so
    // they are 24 h into a 48 h window. The calendar says train; the ledger says
    // no; the ledger wins (CLAUDE.md invariant 5, and the comment at the head of
    // the KOT branch in template.ts).
    const heavy = DOCS_WORKED_EXAMPLE.history.find((s) => s.id === 'mon-kot')!;
    const result = plan({
      ...DOCS_WORKED_EXAMPLE,
      today: WEDNESDAY,
      program: KOT,
      program_progress: KOT_PROGRESS,
      history: [{ ...heavy, date: '2026-09-22' }],
      cardio_history: [],
    });
    expect(result.today.type).not.toBe('kot');
    expect(result.today.notes.join(' ')).toMatch(/Lower body is still recovering/);
  });

  it('says which days the phase trains when today is not one of them', () => {
    const result = plan({ ...DOCS_WORKED_EXAMPLE, today: SATURDAY, program: KOT,
      program_progress: KOT_PROGRESS, history: [], cardio_history: [] });
    expect(result.today.type).not.toBe('kot');
    expect(result.today.notes.join(' ')).toMatch(/Zero trains Mon, Wed and Fri — today is not one of them/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Load rules
// ─────────────────────────────────────────────────────────────────────────────

describe('phase load rules', () => {
  it('bodyweight_only prescribes no external load anywhere', () => {
    const result = assemble(input({ budgetMin: 90 }));
    for (const block of result.blocks) {
      for (const pe of block.exercises) {
        for (const set of pe.sets) expect(set.load_lb).toBe(0);
      }
    }
  });

  it('bodyweight_only beats the equipment floor', () => {
    // The lightest Bowflex pair is 10 lb, and `achievableLoad` rounds UP to it.
    // A phase that says bodyweight has to survive that, or Zero week 1 opens
    // with a loaded split squat.
    const result = assemble(input({ budgetMin: 90 }));
    const split = result.blocks.flatMap((b) => b.exercises).find((e) => e.program_step_id === 'kot-zero-split-squat');
    expect(split?.sets[0]?.load_lb).toBe(0);
    expect(split?.why).not.toMatch(/lightest available/);
  });

  it('shows no prediction band on a bodyweight phase, even with loaded history', () => {
    // Seth runs KOT twice through (PRD §3): the second Zero starts with a year
    // of loaded split squats behind it.
    const loaded = [{
      id: 'h1', date: '2026-09-14', type: 'kot' as const, duration_min: 30, completed: true,
      exercises: [{ exercise_id: 'atg-split-squat', sets: [
        { set_index: 0, reps: 5, load_lb: 80, rpe: 8 as const, completed: true },
      ] }],
    }];
    const result = assemble(input({ history: loaded, budgetMin: 90 }));
    const split = result.blocks.flatMap((b) => b.exercises).find((e) => e.program_step_id === 'kot-zero-split-squat');
    expect(split?.sets[0]?.load_lb).toBe(0);
    expect(split?.prediction?.probable).toBe(0);
    expect(split?.prediction?.max).toBe(0);
  });

  it('percent_bw_ramp: week 1 is bodyweight', () => {
    expect(phaseLoadFor({ phase: KOT.phases![1]!, weekInPhase: 1, bodyweightLb: 200 })).toBe(0);
  });

  it('percent_bw_ramp: week 2 starts at start_pct', () => {
    expect(phaseLoadFor({ phase: KOT.phases![1]!, weekInPhase: 2, bodyweightLb: 200 })).toBe(50);
  });

  it('percent_bw_ramp: every week after week 2 adds the increment', () => {
    const phase = KOT.phases![1]!;
    expect(phaseLoadFor({ phase, weekInPhase: 3, bodyweightLb: 200 })).toBe(60);
    expect(phaseLoadFor({ phase, weekInPhase: 5, bodyweightLb: 200 })).toBe(80);
  });

  it('standards_driven has no calendar ramp at all', () => {
    const phase = KOT.phases![2]!;
    expect(phaseLoadFor({ phase, weekInPhase: 1, bodyweightLb: 200 })).toBeNull();
    expect(phaseLoadFor({ phase, weekInPhase: 9, bodyweightLb: 200 })).toBeNull();
  });

  it('a ramped load still passes through readiness', () => {
    const reduced = { ...neutralReadiness(), band: 'reduced' as const, load_multiplier: 0.9, score: 60 };
    const full = assemble(input({ today: WEDNESDAY, programProgress: KOT_PROGRESS_DENSE_WEEK_5, budgetMin: 90 }));
    const eased = assemble(input({
      today: WEDNESDAY, programProgress: KOT_PROGRESS_DENSE_WEEK_5, budgetMin: 90, readiness: reduced,
    }));
    const loadOf = (r: typeof full): number =>
      r.blocks.flatMap((b) => b.exercises).find((e) => e.program_step_id === 'kot-dense-split-squat')?.sets[0]?.load_lb ?? -1;
    expect(loadOf(full)).toBeGreaterThan(0);
    expect(loadOf(eased)).toBeLessThan(loadOf(full));
  });

  it('a ramped load still passes through the deload multiplier', () => {
    const full = assemble(input({ today: WEDNESDAY, programProgress: KOT_PROGRESS_DENSE_WEEK_5, budgetMin: 90 }));
    const deloaded = assemble(input({
      today: WEDNESDAY, programProgress: KOT_PROGRESS_DENSE_WEEK_5, budgetMin: 90, deloadLoadMultiplier: 0.875,
    }));
    const loadOf = (r: typeof full): number =>
      r.blocks.flatMap((b) => b.exercises).find((e) => e.program_step_id === 'kot-dense-split-squat')?.sets[0]?.load_lb ?? -1;
    expect(loadOf(deloaded)).toBeLessThan(loadOf(full));
  });

  it('a ramped load is rounded to something the location can actually make', () => {
    const result = assemble(input({ today: WEDNESDAY, programProgress: KOT_PROGRESS_DENSE_WEEK_5, budgetMin: 90 }));
    for (const pe of result.blocks.flatMap((b) => b.exercises)) {
      if (pe.exercise.load_style !== 'total_dumbbell_pair') continue;
      expect(pe.sets[0]!.load_lb % 5).toBe(0);
      expect(pe.sets[0]!.load_lb).toBeLessThanOrEqual(105);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. per_side and rest_s
// ─────────────────────────────────────────────────────────────────────────────

describe('per-side volume and prescribed rest', () => {
  it('doubles the reps on a per-side step, because both sides are the work', () => {
    const result = assemble(input({ budgetMin: 90 }));
    const patrick = result.blocks.flatMap((b) => b.exercises).find((e) => e.program_step_id === 'kot-zero-patrick-step');
    expect(patrick?.sets[0]?.reps).toBe(50);
    expect(patrick?.sets[0]?.per_side).toBe(true);
  });

  it('doubles a per-side hold as well as a per-side rep count', () => {
    const result = assemble(input({ budgetMin: 90 }));
    const couch = result.blocks.flatMap((b) => b.exercises).find((e) => e.program_step_id === 'kot-zero-couch-stretch');
    expect(couch?.sets[0]?.duration_s).toBe(120);
  });

  it('leaves a step that is not per-side alone', () => {
    const result = assemble(input({ budgetMin: 90 }));
    const nordic = result.blocks.flatMap((b) => b.exercises).find((e) => e.program_step_id === 'kot-zero-nordic');
    expect(nordic?.sets[0]?.reps).toBe(5);
    expect(nordic?.sets[0]?.per_side).toBeUndefined();
  });

  it('honours the rest the step states', () => {
    const result = assemble(input({ budgetMin: 90 }));
    const split = result.blocks.flatMap((b) => b.exercises).find((e) => e.program_step_id === 'kot-zero-split-squat');
    expect(split?.sets[0]?.rest_s).toBe(30);
  });

  it('charges a per-side step for twice the time', () => {
    const result = assemble(input({ budgetMin: 90 }));
    const ex = result.blocks.flatMap((b) => b.exercises);
    const patrick = ex.find((e) => e.program_step_id === 'kot-zero-patrick-step')!;
    // 50 reps at 3.5 s plus 60 s setup, single set: ~3.7 min, not ~2.4.
    expect(patrick.estimated_min).toBeGreaterThan(3);
  });
});

describe('the program\'s own number beats the movement\'s default shape', () => {
  // `elephant-walk` is `force: static, pattern: mobility`, so the engine reaches
  // for its 30-second default hold — and Zero's 25 reps, the dose the checklist
  // actually prints, are thrown away. A standard that names a count IS the dose.
  it('keeps the reps a static mobility movement was given', () => {
    const result = assemble(input({ budgetMin: 90 }));
    const elephant = result.blocks
      .flatMap((b) => b.exercises)
      .find((e) => e.program_step_id === 'kot-zero-elephant-walk');
    expect(elephant?.sets[0]?.reps).toBe(25);
    expect(elephant?.sets[0]?.duration_s).toBeUndefined();
  });

  it('charges the budget for the reps, not for half a minute', () => {
    const result = assemble(input({ budgetMin: 90 }));
    const elephant = result.blocks
      .flatMap((b) => b.exercises)
      .find((e) => e.program_step_id === 'kot-zero-elephant-walk');
    // 60 s setup + 25 × 3.5 s = 147 s ≈ 2.45 min, not the 1.5 min a 30 s hold costs.
    expect(elephant?.estimated_min ?? 0).toBeGreaterThan(2);
  });

  it('still gives a hold to a static movement the program gave no count', () => {
    // The default is not being deleted, only outvoted. `kot-zero-couch-stretch`
    // states a hold and keeps it.
    const result = assemble(input({ budgetMin: 90 }));
    const couch = result.blocks
      .flatMap((b) => b.exercises)
      .find((e) => e.program_step_id === 'kot-zero-couch-stretch');
    expect(couch?.sets[0]?.duration_s).toBe(120);
    expect(couch?.sets[0]?.reps).toBe(0);
  });
});

describe('a distance standard is prescribed as a distance', () => {
  // `ProgramStandard.distance_mi` was read by nothing at all: Standards' quarter
  // mile bodyweight walk came out as the goal mode's "10 reps", and the minutes
  // it takes were never charged to the budget.
  const standardsMonday = { today: MONDAY, programProgress: KOT_PROGRESS_STANDARDS, budgetMin: 90 };

  it('prescribes the distance rather than a rep count', () => {
    const result = assemble(input(standardsMonday));
    const walk = result.blocks
      .flatMap((b) => b.exercises)
      .find((e) => e.program_step_id === 'kot-standards-walk');
    expect(walk?.sets[0]?.distance_mi).toBe(0.25);
    expect(walk?.sets[0]?.reps).toBe(0);
  });

  it('gives it no RPE target — "walk a quarter mile at RPE 8" is not an instruction', () => {
    const result = assemble(input(standardsMonday));
    const walk = result.blocks
      .flatMap((b) => b.exercises)
      .find((e) => e.program_step_id === 'kot-standards-walk');
    expect(walk?.sets[0]?.rpe_target).toBeUndefined();
  });

  it('estimates the minutes the distance takes instead of guessing', () => {
    const result = assemble(input(standardsMonday));
    const walk = result.blocks
      .flatMap((b) => b.exercises)
      .find((e) => e.program_step_id === 'kot-standards-walk');
    // A quarter mile at an easy 20 min/mi is 5 minutes, plus a minute of setup.
    expect(walk?.estimated_min ?? 0).toBeCloseTo(6, 1);
  });
});
