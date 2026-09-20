/**
 * Longevity OS — Cardio Prescription
 *
 * Zone boundaries, the Zone 2 ramp, the Norwegian 4×4, walk-run progression,
 * and sprint dosing. RESEARCH §4, §6.1, §6.3.
 */

import { HR_MAX_FORMULA, HR_ZONE_BOUNDS, RUNNING, VO2_PROTOCOLS, WEEKLY } from './constants.js';
import type {
  Athlete,
  CardioLog,
  CardioModality,
  CardioPrescription,
  GymLocation,
  OuraDaily,
} from './types.js';
import { clamp, daysBetween, round, sum, withinDays } from './util.js';

/**
 * HRmax, by the precedence the research doc settles on:
 * measured Strava max over 90 days > Oura > 220 − age.
 */
export function resolveHrMax(args: {
  athlete: Athlete;
  cardioHistory: CardioLog[];
  today: string;
  oura?: OuraDaily;
}): { hr_max: number; source: 'measured_strava' | 'oura' | 'formula' } {
  const { athlete, cardioHistory, today } = args;

  const measured = cardioHistory
    .filter((c) => typeof c.max_hr === 'number' && daysBetween(c.date, today) <= 90 && daysBetween(c.date, today) >= 0)
    .map((c) => c.max_hr as number);
  if (measured.length > 0) {
    const max = Math.max(...measured);
    // A plausible max only — a strap glitch reading 230 is not a training max.
    if (max >= 140 && max <= 220) return { hr_max: max, source: 'measured_strava' };
  }

  if (athlete.hr_max && athlete.hr_max_source === 'oura') {
    return { hr_max: athlete.hr_max, source: 'oura' };
  }
  if (athlete.hr_max && athlete.hr_max_source === 'measured_strava') {
    return { hr_max: athlete.hr_max, source: 'measured_strava' };
  }

  const age = ageOn(athlete.birth_date, today);
  return { hr_max: HR_MAX_FORMULA(age), source: 'formula' };
}

export function ageOn(birthDate: string, today: string): number {
  return Math.floor(daysBetween(birthDate, today) / 365.2425);
}

/**
 * Zone boundaries in bpm. `%HRmax` is the default; Karvonen (heart-rate reserve)
 * is available when a resting HR is known and is the more individualised choice.
 */
export function zoneBoundaries(
  hrMax: number,
  opts: { restingHr?: number; method?: 'hrmax' | 'karvonen' } = {},
): Record<'z1' | 'z2' | 'z3' | 'z4' | 'z5', [number, number]> {
  const method = opts.method ?? (opts.restingHr ? 'karvonen' : 'hrmax');
  const rest = opts.restingHr ?? 0;
  const reserve = hrMax - rest;

  const toBpm = (frac: number): number =>
    method === 'karvonen' && rest > 0 ? Math.round(rest + reserve * frac) : Math.round(hrMax * frac);

  return {
    z1: [toBpm(HR_ZONE_BOUNDS.z1[0]), toBpm(HR_ZONE_BOUNDS.z1[1])],
    z2: [toBpm(HR_ZONE_BOUNDS.z2[0]), toBpm(HR_ZONE_BOUNDS.z2[1])],
    z3: [toBpm(HR_ZONE_BOUNDS.z3[0]), toBpm(HR_ZONE_BOUNDS.z3[1])],
    z4: [toBpm(HR_ZONE_BOUNDS.z4[0]), toBpm(HR_ZONE_BOUNDS.z4[1])],
    z5: [toBpm(HR_ZONE_BOUNDS.z5[0]), toBpm(HR_ZONE_BOUNDS.z5[1])],
  };
}

/** Zone 2 minutes logged in the trailing 7 days. */
export function zone2MinutesLast7(cardio: CardioLog[], today: string): number {
  return round(
    sum(
      cardio
        .filter((c) => withinDays(c.date, today, 7))
        .map((c) => c.zone_minutes?.z2 ?? (isLikelyZone2(c) ? c.duration_min : 0)),
    ),
    0,
  );
}

/** Without an HR stream, a steady walk/ruck/bike is counted as Zone 2 on trust. */
function isLikelyZone2(c: CardioLog): boolean {
  if (c.zone_minutes) return false;
  return ['walk', 'ruck', 'bike', 'row', 'elliptical'].includes(c.modality) && c.duration_min >= 15;
}

/**
 * This week's Zone 2 ceiling: last week's volume plus the ≤10% ramp. Seth is at
 * roughly 0.5–1 mile a week of running, so the target is not the number that
 * governs early weeks — the ramp is.
 */
export function zone2Ceiling(cardio: CardioLog[], today: string): number {
  const lastWeek = round(
    sum(
      cardio
        .filter((c) => {
          const age = daysBetween(c.date, today);
          return age >= 7 && age < 14;
        })
        .map((c) => c.zone_minutes?.z2 ?? (isLikelyZone2(c) ? c.duration_min : 0)),
    ),
    0,
  );
  // From a standing start, 60 minutes in a week is a reasonable first ask.
  if (lastWeek < 20) return 60;
  return Math.min(round(lastWeek * (1 + WEEKLY.aerobic_ramp_max_pct), 0), WEEKLY.zone2_stretch_min);
}

/** Running mileage in the trailing 7 days, for the 10% rule and the ACWR. */
export function runMilesLast7(cardio: CardioLog[], today: string): number {
  return round(
    sum(cardio.filter((c) => c.modality === 'run' && withinDays(c.date, today, 7)).map((c) => c.distance_mi ?? 0)),
    2,
  );
}

/** Days since the last hard aerobic session. No two hard run days in a row. */
export function daysSinceHardCardio(cardio: CardioLog[], today: string): number | null {
  const hard = cardio
    .filter((c) => (c.zone_minutes ? (c.zone_minutes.z4 + c.zone_minutes.z5) >= 5 : (c.rpe ?? 0) >= 8))
    .map((c) => daysBetween(c.date, today))
    .filter((d) => d >= 0);
  return hard.length ? Math.min(...hard) : null;
}

/** Modalities this location can actually support. */
export function availableModalities(location: GymLocation): CardioModality[] {
  const have = new Set(location.equipment.filter((e) => e.available).map((e) => e.equipment));
  const out: CardioModality[] = ['walk'];
  if (have.has('treadmill')) out.push('run');
  if (have.has('outdoor_route') || have.has('track_or_open_space')) {
    out.push('run', 'ruck');
  }
  if (have.has('stationary_bike') || have.has('recumbent_bike') || have.has('assault_bike')) out.push('bike');
  if (have.has('rower')) out.push('row');
  if (have.has('ski_erg')) out.push('ski_erg');
  if (have.has('elliptical') || have.has('arc_trainer')) out.push('elliptical');
  if (have.has('stair_climber')) out.push('stair');
  return [...new Set(out)];
}

/**
 * A Zone 2 prescription that respects the ramp ceiling and the location.
 *
 * Modality preference follows RESEARCH §6.2: bike or row within 24 h of heavy
 * lower-body work, running only on upper-body or recovery days.
 */
export function prescribeZone2(args: {
  minutes: number;
  hrMax: number;
  restingHr?: number;
  location: GymLocation;
  heavyLowerRecently: boolean;
}): CardioPrescription {
  const zones = zoneBoundaries(args.hrMax, { restingHr: args.restingHr });
  const available = availableModalities(args.location);

  const preference: CardioModality[] = args.heavyLowerRecently
    ? ['bike', 'row', 'elliptical', 'ski_erg', 'walk', 'run']
    : ['run', 'ruck', 'bike', 'row', 'elliptical', 'walk'];
  const modality = preference.find((m) => available.includes(m)) ?? 'walk';

  const why = args.heavyLowerRecently
    ? 'Bike or row today — your legs took a beating and running would stack fatigue on the same tissue.'
    : 'Conversational pace. If you cannot talk in full sentences, slow down.';

  return {
    modality,
    structure: 'steady',
    duration_min: args.minutes,
    target_bpm: zones.z2,
    target_zone: 'z2',
    why,
  };
}

/** The Norwegian 4×4, or a substitute protocol. RESEARCH §6.1 */
export function prescribeVo2(args: {
  hrMax: number;
  restingHr?: number;
  location: GymLocation;
  minutesAvailable: number;
  protocolId?: '4x4' | '8x2' | '30_30';
}): CardioPrescription {
  const zones = zoneBoundaries(args.hrMax, { restingHr: args.restingHr });
  const available = availableModalities(args.location);
  const modality: CardioModality =
    (['run', 'bike', 'row', 'ski_erg', 'elliptical'] as CardioModality[]).find((m) => available.includes(m)) ?? 'walk';

  // 4×4 needs ~28 min with the warm-up; fall back to shorter protocols on a tight day.
  const wanted =
    args.protocolId ?? (args.minutesAvailable >= 35 ? '4x4' : args.minutesAvailable >= 25 ? '8x2' : '30_30');
  const protocol = VO2_PROTOCOLS.find((p) => p.id === wanted) ?? VO2_PROTOCOLS[0];

  const workBpm: [number, number] = [
    Math.round(args.hrMax * protocol.intensity[0]),
    Math.round(args.hrMax * protocol.intensity[1]),
  ];

  const total = protocol.rounds * (protocol.work_min + protocol.rest_min);

  return {
    modality,
    structure: 'intervals',
    duration_min: round(total, 0),
    target_bpm: workBpm,
    target_zone: 'z4',
    intervals: {
      work_min: protocol.work_min,
      rest_min: protocol.rest_min,
      rounds: protocol.rounds,
      work_bpm: workBpm,
    },
    why: `${protocol.label} at 85–95% max. VO2max carries the strongest dose-response with all-cause mortality of anything in this app — roughly 12–15% lower risk per MET gained. Recovery between rounds is active, not stopped. Zone 2 window for reference: ${zones.z2[0]}–${zones.z2[1]} bpm.`,
  };
}

/** Walk-run progression from wherever he actually is. RESEARCH §6.3 */
export function prescribeWalkRun(args: {
  minutes: number;
  hrMax: number;
  restingHr?: number;
  weeklyRunMiles: number;
}): CardioPrescription {
  const zones = zoneBoundaries(args.hrMax, { restingHr: args.restingHr });
  // Run intervals grow with the weekly base: 1 min at zero base, up to 5.
  const runMin = clamp(Math.floor(args.weeklyRunMiles) + 1, 1, 5);
  const walkMin = clamp(4 - Math.floor(args.weeklyRunMiles / 2), 1, 4);
  const rounds = Math.max(2, Math.floor(args.minutes / (runMin + walkMin)));

  return {
    modality: 'run',
    structure: 'walk_run',
    duration_min: args.minutes,
    target_bpm: zones.z2,
    target_zone: 'z2',
    intervals: { work_min: runMin, rest_min: walkMin, rounds, work_bpm: zones.z3 },
    why: `${runMin} min easy running, ${walkMin} min walking, ${rounds} rounds. Volume grows no more than 10% a week — that rule is the difference between running in a year and being injured in a month.`,
  };
}

/** Sprint dosing: 10–30 m, full recovery, 6–10 reps. RESEARCH §6.5 */
export function prescribeSprints(args: { hrMax: number; distanceM?: number; reps?: number }): CardioPrescription {
  const distanceM = args.distanceM ?? 20;
  const reps = clamp(args.reps ?? 8, RUNNING.sprint_reps[0], RUNNING.sprint_reps[1]);
  const recoveryMin = (distanceM / 10) * (RUNNING.sprint_recovery_s_per_10m / 60);

  return {
    modality: 'run',
    structure: 'sprints',
    duration_min: round(reps * (recoveryMin + 0.2) + 10, 0),
    target_bpm: [Math.round(args.hrMax * 0.9), args.hrMax],
    target_zone: 'z5',
    intervals: { work_min: round(distanceM / 100, 2), rest_min: round(recoveryMin, 1), rounds: reps, work_bpm: [Math.round(args.hrMax * 0.9), args.hrMax] },
    distance_mi: round((distanceM * reps) / 1609.34, 3),
    why: `${reps} × ${distanceM} m accelerations with full recovery. Quality over quantity — if the last one is slower than the first, you are done. Thorough warm-up first, no exceptions.`,
  };
}

/** Did the logged activity hit what was prescribed? 0–1. */
export function scoreCompliance(prescription: CardioPrescription, actual: CardioLog): number {
  const durationRatio = clamp(actual.duration_min / Math.max(prescription.duration_min, 1), 0, 1.2);
  const durationScore = clamp(1 - Math.abs(1 - durationRatio), 0, 1);

  let zoneScore = 0.5; // unknown without an HR stream — neither credit nor blame
  if (actual.zone_minutes) {
    const inZone = actual.zone_minutes[prescription.target_zone] ?? 0;
    zoneScore = clamp(inZone / Math.max(prescription.duration_min * 0.6, 1), 0, 1);
  } else if (typeof actual.avg_hr === 'number') {
    const [lo, hi] = prescription.target_bpm;
    zoneScore = actual.avg_hr >= lo && actual.avg_hr <= hi ? 1 : 0.4;
  }

  return round(durationScore * 0.5 + zoneScore * 0.5, 2);
}
