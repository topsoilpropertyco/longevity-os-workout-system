import { describe, expect, it } from 'vitest';
import { ledgerNotes, sessionWhy, weekDiff, weeklyNarrative } from '../src/why.js';
import { buildLedger } from '../src/ledger.js';
import { neutralReadiness } from '../src/readiness.js';
import { WEEKLY } from '../src/constants.js';
import type { DeloadState, PrescribedSession, WeeklyDose } from '../src/types.js';
import { EXERCISES } from '../fixtures/library.js';

const NO_DELOAD: DeloadState = {
  active: false, triggers: [], volume_multiplier: 1, load_multiplier: 1, weeks_since_last: 2,
};

const DOSE: WeeklyDose = {
  zone2_min: 90, zone2_target_min: WEEKLY.zone2_target_min, zone2_ceiling_min: 120,
  vo2_sessions: 1, strength_min: 80, strength_target_min: WEEKLY.strength_min_range,
  mobility_sessions: 2, plyo_contacts: 40, tonnage_lb: 24_500, sessions: 5,
};

describe('session why', () => {
  it('opens with the session type', () => {
    const why = sessionWhy({
      type: 'kot', rationale: '1/3 KOT sessions done.', readiness: neutralReadiness(),
      dose: DOSE, deload: NO_DELOAD, budgetMin: 30,
    });
    expect(why.startsWith('Knees Over Toes.')).toBe(true);
  });

  it('says green light on a push day', () => {
    const why = sessionWhy({
      type: 'strength', rationale: 'r', budgetMin: 45, dose: DOSE, deload: NO_DELOAD,
      readiness: { ...neutralReadiness(), band: 'push', score: 91 },
    });
    expect(why).toMatch(/green light/);
    expect(why).toMatch(/91/);
  });

  it('states the RPE cap on a reduced day', () => {
    const why = sessionWhy({
      type: 'strength', rationale: 'r', budgetMin: 45, dose: DOSE, deload: NO_DELOAD,
      readiness: { ...neutralReadiness(), band: 'reduced', score: 62 },
    });
    expect(why).toMatch(/RPE 7/);
  });

  it('leads with the deload when one is active', () => {
    const why = sessionWhy({
      type: 'strength', rationale: 'r', budgetMin: 45, dose: DOSE,
      readiness: neutralReadiness(),
      deload: { ...NO_DELOAD, active: true, triggers: ['7-day readiness averaging 60'] },
    });
    expect(why).toMatch(/Deload week/);
    expect(why).toMatch(/readiness averaging 60/);
  });

  it('surfaces the HRV reason on a recovery day', () => {
    const why = sessionWhy({
      type: 'recovery', rationale: 'r', budgetMin: 30, dose: DOSE, deload: NO_DELOAD,
      readiness: { ...neutralReadiness(), band: 'recovery', score: 44, reasons: ['HRV is 14% below your 28-day baseline.'] },
    });
    expect(why).toMatch(/HRV is 14%/);
  });

  it('does not state the minutes — the card shows the estimate right above it', () => {
    // Printing the 45-minute BUDGET under a 33-minute ESTIMATE reads as a
    // contradiction. The bot, which has no card, composes its own.
    const why = sessionWhy({ type: 'zone2', rationale: 'r', budgetMin: 20, dose: DOSE, deload: NO_DELOAD, readiness: neutralReadiness() });
    expect(why).not.toMatch(/\d+ minutes/);
  });

  it('does not repeat itself when the rationale echoes the opener', () => {
    const why = sessionWhy({
      type: 'mobility', rationale: 'Mobility.', budgetMin: 15, dose: DOSE, deload: NO_DELOAD,
      readiness: neutralReadiness(),
    });
    expect(why.match(/Mobility\./g)).toHaveLength(1);
  });
});

describe('weekly narrative', () => {
  it('reports Zone 2 against this week\'s ceiling, not the distant target', () => {
    expect(weeklyNarrative(DOSE)).toMatch(/Zone 2 at 90 of 120 min/);
  });

  it('says the target is met when it is', () => {
    expect(weeklyNarrative({ ...DOSE, zone2_min: 130 })).toMatch(/target met/);
  });

  it('notes an owed VO2 session', () => {
    expect(weeklyNarrative({ ...DOSE, vo2_sessions: 0 })).toMatch(/VO2 session still owed/);
  });

  it('warns when strength volume passes the point of added benefit', () => {
    expect(weeklyNarrative({ ...DOSE, strength_min: 160 })).toMatch(/past the point of added benefit/);
  });

  it('notes when strength is short of the window', () => {
    expect(weeklyNarrative({ ...DOSE, strength_min: 30 })).toMatch(/short of 60/);
  });

  it('formats tonnage with thousands separators', () => {
    expect(weeklyNarrative(DOSE)).toMatch(/24,500 lb moved/);
  });
});

describe('ledger notes', () => {
  it('is empty for a fully recovered athlete', () => {
    expect(ledgerNotes(buildLedger({ today: '2026-09-22', history: [], exercises: EXERCISES }))).toHaveLength(0);
  });

  it('explains each blocked region in plain words', () => {
    const ledger = buildLedger({
      today: '2026-09-22',
      history: [{
        id: 'x', date: '2026-09-21', type: 'strength', duration_min: 40, completed: true,
        exercises: [{ exercise_id: 'db-rdl', sets: [{ set_index: 0, reps: 8, load_lb: 200, rpe: 9, completed: true }] }],
      }],
      exercises: EXERCISES,
    });
    const notes = ledgerNotes(ledger);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.join(' ')).toMatch(/posterior chain/);
    expect(notes.join(' ')).not.toMatch(/_/);
  });
});

describe('week diff', () => {
  const day = (date: string, type: PrescribedSession['type']): PrescribedSession => ({
    date, type, title: type, location_id: 'loc', why: '', blocks: [], estimated_min: 30,
    readiness: neutralReadiness(), notes: [], deload: false,
  });

  it('says so when nothing moved', () => {
    const week = [day('2026-09-22', 'strength'), day('2026-09-23', 'zone2')];
    expect(weekDiff(week, week)).toBe('Rest of the week is unchanged.');
  });

  it('names a single change with its weekday', () => {
    const before = [day('2026-09-22', 'strength'), day('2026-09-23', 'zone2')];
    const after = [day('2026-09-22', 'strength'), day('2026-09-23', 'kot')];
    expect(weekDiff(before, after)).toBe('Wed zone2 → kot.');
  });

  it('summarises when many days moved', () => {
    const before = ['strength', 'zone2', 'kot', 'mobility'].map((t, i) => day(`2026-09-2${2 + i}`, t as never));
    const after = ['kot', 'strength', 'zone2', 'vo2'].map((t, i) => day(`2026-09-2${2 + i}`, t as never));
    expect(weekDiff(before, after)).toMatch(/and 2 more/);
  });
});
