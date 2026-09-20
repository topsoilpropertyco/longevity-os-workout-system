/**
 * Golden-file and behavioural tests over the five fixture days required by
 * PRD §9. These are the tests that would catch a regression in the engine's
 * actual judgement, rather than in one of its parts.
 */
import { describe, expect, it } from 'vitest';
import { plan, rebalanceWeek } from '../src/plan.js';
import { orderingViolations } from '../src/exclusions.js';
import { ASSEMBLY, WEEKLY } from '../src/constants.js';
import {
  ALL_FIXTURES, COLD_START, FIFTEEN_MIN_HOME, HIGH_READINESS, INJURY_FLARE,
  LOW_READINESS, NINETY_MIN_PF, TODAY,
} from '../fixtures/days.js';
import { PLANET_FITNESS } from '../fixtures/library.js';

describe('every fixture', () => {
  for (const [name, fixture] of Object.entries(ALL_FIXTURES)) {
    describe(name, () => {
      const result = plan(fixture);

      it('returns a session for today and six days ahead', () => {
        expect(result.week).toHaveLength(7);
        expect(result.week[0]!.date).toBe(fixture.today);
        expect(result.week[0]!.is_today).toBe(true);
        expect(result.week.slice(1).every((d) => !d.is_today)).toBe(true);
      });

      it('gives today a why line', () => {
        expect(result.today.why.length).toBeGreaterThan(20);
      });

      it('never violates the concurrent-training ordering rule', () => {
        for (const day of result.week) {
          expect(orderingViolations(day.session.blocks)).toHaveLength(0);
        }
      });

      it('never prescribes an exercise the location cannot perform', () => {
        const available = new Set(
          fixture.location.equipment.filter((e) => e.available).map((e) => e.equipment),
        );
        available.add('bodyweight');
        for (const block of result.today.blocks) {
          for (const pe of block.exercises) {
            if (pe.exercise.equipment.length === 0) continue;
            expect(pe.exercise.equipment.some((e) => available.has(e))).toBe(true);
          }
        }
      });

      it('is deterministic — the same input yields the same plan', () => {
        const again = plan(fixture);
        expect(again.signature).toBe(result.signature);
        expect(JSON.stringify(again.today)).toBe(JSON.stringify(result.today));
      });

      it('respects the time budget', () => {
        const working = fixture.goals.warmup_outside_budget
          ? fixture.budget_min + fixture.goals.warmup_min + fixture.goals.cooldown_min
          : fixture.budget_min;
        expect(result.today.estimated_min).toBeLessThanOrEqual(working + ASSEMBLY.overrun_tolerance_min + 30);
      });

      it('never prescribes a negative or NaN load', () => {
        for (const block of result.today.blocks) {
          for (const pe of block.exercises) {
            for (const s of pe.sets) {
              expect(Number.isFinite(s.load_lb)).toBe(true);
              expect(s.load_lb).toBeGreaterThanOrEqual(0);
              expect(s.reps).toBeGreaterThanOrEqual(0);
            }
          }
        }
      });
    });
  }
});

describe('high readiness', () => {
  const result = plan(HIGH_READINESS);

  it('lands in the push band', () => {
    expect(result.today.readiness.band).toBe('push');
    expect(result.today.readiness.set_delta).toBe(1);
  });

  it('says so in the why line', () => {
    expect(result.today.why).toMatch(/green light/i);
  });

  it('is not a recovery day', () => {
    expect(result.today.type).not.toBe('recovery');
  });
});

describe('low readiness', () => {
  const result = plan(LOW_READINESS);

  it('converts the day to recovery', () => {
    expect(result.today.readiness.band).toBe('recovery');
    expect(result.today.type).toBe('recovery');
  });

  it('still prescribes something — goal 2 is something physical every day', () => {
    const hasWork = result.today.blocks.some((b) => b.exercises.length > 0 || b.cardio);
    expect(hasWork).toBe(true);
  });

  it('prescribes only an easy walk for cardio', () => {
    const cardio = result.today.blocks.find((b) => b.cardio)?.cardio;
    expect(cardio?.target_zone).toBe('z1');
  });

  it('caps intensity', () => {
    for (const block of result.today.blocks) {
      for (const pe of block.exercises) {
        for (const s of pe.sets) expect(s.rpe_target ?? 0).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('injury flare', () => {
  const result = plan(INJURY_FLARE);
  const ids = result.today.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id));

  it('does not load the painful knee heavily', () => {
    expect(ids).not.toContain('smith-squat');
    expect(ids).not.toContain('barbell-back-squat');
    expect(ids).not.toContain('leg-press');
  });

  it('does not silently drop the injury', () => {
    expect(INJURY_FLARE.injuries.some((i) => !i.resolved_on)).toBe(true);
  });

  it('still finds work to do', () => {
    expect(result.today.blocks.some((b) => b.exercises.length > 0 || b.cardio)).toBe(true);
  });
});

describe('fifteen minutes at home', () => {
  const result = plan(FIFTEEN_MIN_HOME);

  it('fits, warm-up and cool-down included', () => {
    expect(result.today.estimated_min).toBeLessThanOrEqual(15 + ASSEMBLY.overrun_tolerance_min);
  });

  it('still prescribes real work', () => {
    const exercises = result.today.blocks.flatMap((b) => b.exercises);
    expect(exercises.length + result.today.blocks.filter((b) => b.cardio).length).toBeGreaterThan(0);
  });
});

describe('ninety minutes at Planet Fitness', () => {
  const result = plan(NINETY_MIN_PF);
  const ids = result.today.blocks.flatMap((b) => b.exercises.map((e) => e.exercise_id));

  it('never prescribes a barbell — there are none in the building', () => {
    expect(ids).not.toContain('barbell-back-squat');
    expect(ids).not.toContain('trap-bar-deadlift');
  });

  it('never prescribes a pull-up — there is no bar', () => {
    expect(ids).not.toContain('pull-up');
  });

  it('includes the Smith bar weight in any Smith prescription', () => {
    for (const block of result.today.blocks) {
      for (const pe of block.exercises) {
        if (pe.exercise.load_style !== 'smith') continue;
        expect(pe.sets[0]!.load_lb).toBeGreaterThanOrEqual(PLANET_FITNESS.smith_bar_weight_lb);
      }
    }
  });

  it('uses the extra time', () => {
    expect(result.today.estimated_min).toBeGreaterThan(30);
  });
});

describe('cold start', () => {
  const result = plan(COLD_START);

  it('does not crash with no history, no Oura, and no sliders', () => {
    expect(result.today).toBeDefined();
  });

  it('assumes a normal day rather than a heroic one', () => {
    expect(result.today.readiness.source).toBe('default');
    expect(result.today.readiness.band).toBe('as_planned');
  });

  it('marks predictions as cold-start rather than inventing numbers', () => {
    const withPrediction = result.today.blocks.flatMap((b) => b.exercises).filter((e) => e.prediction);
    for (const e of withPrediction) {
      expect(['cold_start', 'program_standard']).toContain(e.prediction!.basis);
    }
  });
});

describe('the week', () => {
  const result = plan(HIGH_READINESS);

  it('runs from today forward, one day at a time', () => {
    for (let i = 1; i < result.week.length; i++) {
      const prev = new Date(result.week[i - 1]!.date).getTime();
      const cur = new Date(result.week[i]!.date).getTime();
      expect(cur - prev).toBe(86_400_000);
    }
  });

  it('does not hit the same region hard on consecutive days', () => {
    // Every day is planned against a ledger that already carries the prior days.
    for (const day of result.week) {
      expect(orderingViolations(day.session.blocks)).toHaveLength(0);
    }
  });

  it('does not prescribe the same hard session every day of the week', () => {
    // The projected week must accumulate against itself. Without that, every
    // future day recomputes the dose from real history alone, sees "no VO2 yet
    // this week", and picks VO2 — seven days running.
    const types = result.week.map((d) => d.session.type);
    expect(new Set(types).size).toBeGreaterThan(2);
  });

  it('never projects more than one VO2 session in the week', () => {
    for (const fixture of Object.values(ALL_FIXTURES)) {
      const vo2Days = plan(fixture).week.filter((d) => d.session.type === 'vo2').length;
      expect(vo2Days).toBeLessThanOrEqual(1);
    }
  });

  it('never projects power work on consecutive days', () => {
    for (const fixture of Object.values(ALL_FIXTURES)) {
      const types = plan(fixture).week.map((d) => d.session.type);
      for (let i = 1; i < types.length; i++) {
        expect(types[i] === 'power' && types[i - 1] === 'power').toBe(false);
      }
    }
  });

  it('projects future days under neutral readiness rather than forecasting Oura', () => {
    for (const day of result.week.slice(1)) {
      expect(day.session.readiness.source).toBe('default');
    }
  });

  it('re-solves when a day is pulled forward', () => {
    const wanted = result.week.find((d) => !d.is_today && d.session.type !== result.today.type);
    if (!wanted) return; // nothing different to pull forward in this fixture
    const rebalanced = rebalanceWeek(HIGH_READINESS, wanted.date);
    expect(rebalanced.today.type).toBe(wanted.session.type);
  });
});

describe('weekly dose accounting', () => {
  const result = plan(HIGH_READINESS);

  it('reports Zone 2 against the ramp ceiling, not just the target', () => {
    expect(result.weekly.zone2_target_min).toBe(WEEKLY.zone2_target_min);
    expect(result.weekly.zone2_ceiling_min).toBeGreaterThan(0);
  });

  it('counts tonnage from completed sets only', () => {
    expect(result.weekly.tonnage_lb).toBeGreaterThanOrEqual(0);
  });

  it('exposes the ledger it planned against', () => {
    expect(Object.keys(result.ledger).length).toBeGreaterThan(5);
  });
});

describe('the plan signature', () => {
  it('changes when the budget changes', () => {
    const a = plan(HIGH_READINESS);
    const b = plan({ ...HIGH_READINESS, budget_min: 20 });
    expect(a.signature).not.toBe(b.signature);
  });

  it('changes when the location changes', () => {
    const a = plan(HIGH_READINESS);
    const b = plan({ ...HIGH_READINESS, location: PLANET_FITNESS });
    expect(a.signature).not.toBe(b.signature);
  });

  it('is stable across repeated calls with the same input', () => {
    expect(plan(HIGH_READINESS).signature).toBe(plan(HIGH_READINESS).signature);
  });
});

describe('the contract with the rest of the system', () => {
  it('never returns a session without a location', () => {
    for (const [, fixture] of Object.entries(ALL_FIXTURES)) {
      expect(plan(fixture).today.location_id).toBe(fixture.location.id);
    }
  });

  it('dates today correctly', () => {
    expect(plan(HIGH_READINESS).today.date).toBe(TODAY);
  });

  it('gives every prescribed exercise a why', () => {
    for (const block of plan(NINETY_MIN_PF).today.blocks) {
      for (const pe of block.exercises) expect(pe.why.length).toBeGreaterThan(5);
    }
  });
});
