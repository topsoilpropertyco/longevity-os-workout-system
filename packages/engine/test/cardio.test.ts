import { describe, expect, it } from 'vitest';
import {
  ageOn, availableModalities, daysSinceHardCardio, prescribeSprints, prescribeVo2,
  prescribeWalkRun, prescribeZone2, resolveHrMax, runMilesLast7, scoreCompliance,
  zone2Ceiling, zone2MinutesLast7, zoneBoundaries,
} from '../src/cardio.js';
import { WEEKLY } from '../src/constants.js';
import type { CardioLog } from '../src/types.js';
import { HOME, PLANET_FITNESS, SETH } from '../fixtures/library.js';
import { addDays } from '../src/util.js';

const TODAY = '2026-09-22';

function walk(date: string, z2: number, distance = 1.5): CardioLog {
  return {
    date, modality: 'walk', duration_min: z2 + 5, distance_mi: distance,
    zone_minutes: { z1: 5, z2, z3: 0, z4: 0, z5: 0 }, source: 'strava',
  };
}

describe('HRmax precedence', () => {
  it('prefers a measured Strava max within 90 days', () => {
    const history: CardioLog[] = [{ date: addDays(TODAY, -10), modality: 'run', duration_min: 30, max_hr: 191, source: 'strava' }];
    expect(resolveHrMax({ athlete: SETH, cardioHistory: history, today: TODAY })).toEqual({ hr_max: 191, source: 'measured_strava' });
  });

  it('ignores a measured max older than 90 days', () => {
    const history: CardioLog[] = [{ date: addDays(TODAY, -200), modality: 'run', duration_min: 30, max_hr: 191, source: 'strava' }];
    expect(resolveHrMax({ athlete: SETH, cardioHistory: history, today: TODAY }).source).toBe('formula');
  });

  it('rejects an implausible strap reading', () => {
    const history: CardioLog[] = [{ date: addDays(TODAY, -5), modality: 'run', duration_min: 30, max_hr: 240, source: 'strava' }];
    expect(resolveHrMax({ athlete: SETH, cardioHistory: history, today: TODAY }).source).toBe('formula');
  });

  it('falls back to 220 − age', () => {
    const { hr_max, source } = resolveHrMax({ athlete: SETH, cardioHistory: [], today: TODAY });
    expect(source).toBe('formula');
    expect(hr_max).toBe(220 - ageOn(SETH.birth_date, TODAY));
  });

  it('computes age correctly for the fixture athlete', () => {
    expect(ageOn(SETH.birth_date, TODAY)).toBe(34);
  });
});

describe('zones', () => {
  it('puts Zone 2 at 60–70% of HRmax', () => {
    const z = zoneBoundaries(186);
    expect(z.z2).toEqual([112, 130]);
  });

  it('uses heart-rate reserve when a resting HR is known', () => {
    const plain = zoneBoundaries(186);
    const karvonen = zoneBoundaries(186, { restingHr: 54 });
    expect(karvonen.z2[0]).toBeGreaterThan(plain.z2[0]);
  });

  it('keeps the bands contiguous and ascending', () => {
    const z = zoneBoundaries(186);
    expect(z.z2[0]).toBe(z.z1[1]);
    expect(z.z5[1]).toBe(186);
  });
});

describe('the 10% ramp', () => {
  it('lets a standing start begin at 60 minutes', () => {
    expect(zone2Ceiling([], TODAY)).toBe(60);
  });

  it('caps growth at 10% over last week', () => {
    const lastWeek = [walk(addDays(TODAY, -8), 50), walk(addDays(TODAY, -9), 50)];
    expect(zone2Ceiling(lastWeek, TODAY)).toBe(110);
  });

  it('never exceeds the stretch target however fast he ramps', () => {
    const huge = Array.from({ length: 6 }, (_, i) => walk(addDays(TODAY, -(8 + i)), 200));
    expect(zone2Ceiling(huge, TODAY)).toBeLessThanOrEqual(WEEKLY.zone2_stretch_min);
  });

  it('counts this week from the zone minutes on the logs', () => {
    expect(zone2MinutesLast7([walk(addDays(TODAY, -1), 30), walk(addDays(TODAY, -3), 25)], TODAY)).toBe(55);
  });

  it('credits a steady walk as Zone 2 when there is no HR stream', () => {
    const noHr: CardioLog = { date: addDays(TODAY, -1), modality: 'walk', duration_min: 40, source: 'manual' };
    expect(zone2MinutesLast7([noHr], TODAY)).toBe(40);
  });
});

describe('prescriptions', () => {
  it('sends him to the bike within a day of heavy lower-body work', () => {
    const p = prescribeZone2({ minutes: 30, hrMax: 186, location: PLANET_FITNESS, heavyLowerRecently: true });
    expect(['bike', 'row', 'elliptical', 'ski_erg']).toContain(p.modality);
    expect(p.why).toMatch(/legs/);
  });

  it('prefers running on a fresh day when a route exists', () => {
    const p = prescribeZone2({ minutes: 30, hrMax: 186, location: HOME, heavyLowerRecently: false });
    expect(p.modality).toBe('run');
  });

  it('builds a Norwegian 4×4 when there is time for it', () => {
    const p = prescribeVo2({ hrMax: 186, location: PLANET_FITNESS, minutesAvailable: 45 });
    expect(p.intervals).toEqual({ work_min: 4, rest_min: 3, rounds: 4, work_bpm: [158, 177] });
    expect(p.target_zone).toBe('z4');
  });

  it('falls back to a shorter protocol on a tight day', () => {
    const p = prescribeVo2({ hrMax: 186, location: PLANET_FITNESS, minutesAvailable: 20 });
    expect(p.intervals!.rounds).toBeGreaterThan(4);
  });

  it('scales walk-run intervals to his actual running base', () => {
    const beginner = prescribeWalkRun({ minutes: 30, hrMax: 186, weeklyRunMiles: 0 });
    const further = prescribeWalkRun({ minutes: 30, hrMax: 186, weeklyRunMiles: 4 });
    expect(further.intervals!.work_min).toBeGreaterThan(beginner.intervals!.work_min);
  });

  it('doses sprints inside the researched range', () => {
    const p = prescribeSprints({ hrMax: 186, distanceM: 20, reps: 8 });
    expect(p.intervals!.rounds).toBe(8);
    expect(p.target_zone).toBe('z5');
  });

  it('clamps sprint reps to the safe range even when asked for more', () => {
    expect(prescribeSprints({ hrMax: 186, reps: 40 }).intervals!.rounds).toBe(10);
  });
});

describe('location modalities', () => {
  it('knows Planet Fitness has the full cardio deck', () => {
    const m = availableModalities(PLANET_FITNESS);
    expect(m).toEqual(expect.arrayContaining(['run', 'bike', 'row', 'elliptical', 'stair']));
  });

  it('knows home is walking and outdoor running only', () => {
    const m = availableModalities(HOME);
    expect(m).toEqual(expect.arrayContaining(['walk', 'run', 'ruck']));
    expect(m).not.toContain('row');
  });
});

describe('history queries', () => {
  it('sums running miles over the trailing week', () => {
    const logs: CardioLog[] = [
      { date: addDays(TODAY, -2), modality: 'run', duration_min: 20, distance_mi: 1.5, source: 'strava' },
      { date: addDays(TODAY, -10), modality: 'run', duration_min: 20, distance_mi: 5, source: 'strava' },
    ];
    expect(runMilesLast7(logs, TODAY)).toBe(1.5);
  });

  it('finds the last hard aerobic day', () => {
    const logs: CardioLog[] = [{
      date: addDays(TODAY, -1), modality: 'run', duration_min: 30, source: 'strava',
      zone_minutes: { z1: 5, z2: 5, z3: 5, z4: 10, z5: 5 },
    }];
    expect(daysSinceHardCardio(logs, TODAY)).toBe(1);
  });

  it('returns null when nothing hard has happened', () => {
    expect(daysSinceHardCardio([walk(addDays(TODAY, -1), 30)], TODAY)).toBeNull();
  });
});

describe('compliance', () => {
  it('scores a session that hit its zone and duration highly', () => {
    const p = prescribeZone2({ minutes: 30, hrMax: 186, location: HOME, heavyLowerRecently: false });
    const actual: CardioLog = {
      date: TODAY, modality: 'run', duration_min: 30, source: 'strava',
      zone_minutes: { z1: 2, z2: 26, z3: 2, z4: 0, z5: 0 },
    };
    expect(scoreCompliance(p, actual)).toBeGreaterThan(0.9);
  });

  it('penalises a session that came up short', () => {
    const p = prescribeZone2({ minutes: 40, hrMax: 186, location: HOME, heavyLowerRecently: false });
    const actual: CardioLog = {
      date: TODAY, modality: 'run', duration_min: 10, source: 'strava',
      zone_minutes: { z1: 2, z2: 8, z3: 0, z4: 0, z5: 0 },
    };
    expect(scoreCompliance(p, actual)).toBeLessThan(0.5);
  });

  it('neither credits nor blames a manual log with no HR data', () => {
    const p = prescribeZone2({ minutes: 30, hrMax: 186, location: HOME, heavyLowerRecently: false });
    const actual: CardioLog = { date: TODAY, modality: 'walk', duration_min: 30, source: 'manual' };
    expect(scoreCompliance(p, actual)).toBeCloseTo(0.75, 2);
  });
});
