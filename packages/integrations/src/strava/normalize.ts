/**
 * Strava activity + streams → the engine's `CardioLog`.
 *
 * UNITS ARE THE WHOLE JOB. Strava is metric and SI: metres, metres per second,
 * seconds. The engine and the UI are imperial: miles, mph, minutes (CLAUDE.md
 * "pounds and miles in UI"). **No metric value may leave this file.** If you
 * ever see a `_m` or `_mps` field escaping into a `CardioLog`, that is a bug.
 */

import type { CardioLog, CardioModality, ZoneMinutes } from '@longevity/engine';
import { computeZoneMinutes, type HrStreamInput, type ZoneBoundaries } from './zones.js';

// ─────────────────────────────────────────────────────────────────────────────
// Unit conversions — the only place these constants exist
// ─────────────────────────────────────────────────────────────────────────────

const METRES_PER_MILE = 1609.344;

/** Metres → miles. */
export function metresToMiles(m: number): number {
  return m / METRES_PER_MILE;
}

/** Metres per second → miles per hour. */
export function mpsToMph(mps: number): number {
  return (mps * 3600) / METRES_PER_MILE;
}

/** Seconds → minutes. */
export function secondsToMinutes(s: number): number {
  return s / 60;
}

/** Metres per second → minutes per mile (pace). `undefined` when stopped. */
export function mpsToMinPerMile(mps: number): number | undefined {
  if (!Number.isFinite(mps) || mps <= 0.1) return undefined;
  return METRES_PER_MILE / mps / 60;
}

// ─────────────────────────────────────────────────────────────────────────────
// sport_type → CardioModality
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strava's `sport_type` (the modern field; `type` is the deprecated one) mapped
 * onto our `CardioModality`. Anything unrecognised becomes `'other'` rather
 * than being dropped — an unmapped sport still counts as a session.
 */
export const SPORT_TYPE_TO_MODALITY: Record<string, CardioModality> = {
  Run: 'run',
  TrailRun: 'run',
  VirtualRun: 'run',
  Treadmill: 'run',
  Walk: 'walk',
  Hike: 'walk',
  Snowshoe: 'walk',
  Ride: 'bike',
  VirtualRide: 'bike',
  MountainBikeRide: 'bike',
  GravelRide: 'bike',
  EBikeRide: 'bike',
  EMountainBikeRide: 'bike',
  Velomobile: 'bike',
  Handcycle: 'bike',
  Rowing: 'row',
  VirtualRow: 'row',
  Kayaking: 'row',
  Canoeing: 'row',
  StandUpPaddling: 'row',
  NordicSki: 'ski_erg',
  BackcountrySki: 'ski_erg',
  AlpineSki: 'other',
  RollerSki: 'ski_erg',
  Elliptical: 'elliptical',
  StairStepper: 'stair',
  Swim: 'swim',
  Wheelchair: 'other',
  Workout: 'other',
  WeightTraining: 'other',
  Crossfit: 'other',
  Yoga: 'other',
  Pilates: 'other',
  HighIntensityIntervalTraining: 'other',
};

/**
 * Map a Strava `sport_type` (or the legacy `type`) to a `CardioModality`.
 *
 * Rucking is not a Strava sport type: a walk or hike carrying weight looks like
 * a `Walk`. Pass `hints.rucking` (from the activity name, a gear tag, or Seth's
 * own confirmation) to book it as `'ruck'`.
 */
export function mapSportType(
  sportType: unknown,
  hints: { rucking?: boolean; name?: string } = {},
): CardioModality {
  const key = typeof sportType === 'string' ? sportType : '';
  const base = SPORT_TYPE_TO_MODALITY[key] ?? 'other';
  const name = (hints.name ?? '').toLowerCase();
  const looksRucked = hints.rucking === true || /\bruck|weighted (walk|hike)|sandbag\b/.test(name);
  if (looksRucked && (base === 'walk' || base === 'other')) return 'ruck';
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity → CardioLog
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizeActivityOptions {
  /** Zone boundaries in bpm; without these no zone minutes are computed. */
  zones?: ZoneBoundaries;
  /** Stream set from `getActivityStreams`. Optional — the log still works. */
  streams?: HrStreamInput | null;
  /** Force the modality (Seth corrected it in the bot). */
  modality?: CardioModality;
  /** Treat a walk/hike as a ruck. */
  rucking?: boolean;
  /** Fallback date if the activity carries no usable start date. */
  fallbackDate?: string;
}

/**
 * Convert one Strava activity (plus optional streams) into a `CardioLog`.
 *
 * Returns `null` only when the payload is not an activity at all. A missing
 * field becomes `undefined`, never 0 — same rule as Oura: the engine reads
 * `avg_hr: 0` as a dead athlete and `undefined` as "no strap today".
 *
 * `duration_min` prefers `moving_time` over `elapsed_time`: stopped-at-a-light
 * minutes are not training minutes, and the weekly dose in RESEARCH §6.1 is a
 * dose of actual work.
 */
export function normalizeActivity(
  activity: Record<string, unknown>,
  opts: NormalizeActivityOptions = {},
): CardioLog | null {
  if (!activity || typeof activity !== 'object') return null;
  const id = activity['id'];
  if (id === undefined || id === null) return null;

  const date = isoDayFromActivity(activity) ?? opts.fallbackDate;
  if (!date) return null;

  const movingS = num(activity['moving_time']);
  const elapsedS = num(activity['elapsed_time']);
  const durationS = movingS ?? elapsedS ?? 0;

  const distanceM = num(activity['distance']);
  const avgHr = num(activity['average_heartrate']);
  const maxHr = num(activity['max_heartrate']);

  const modality =
    opts.modality ??
    mapSportType(activity['sport_type'] ?? activity['type'], {
      ...(opts.rucking !== undefined ? { rucking: opts.rucking } : {}),
      name: String(activity['name'] ?? ''),
    });

  let zoneMinutes: ZoneMinutes | undefined;
  if (opts.zones && opts.streams) {
    const computed = computeZoneMinutes(opts.streams, opts.zones);
    const total = computed.z1 + computed.z2 + computed.z3 + computed.z4 + computed.z5;
    // All zeros means there was no usable HR stream. Leave it undefined so the
    // compliance scorer falls back to average HR instead of scoring a real zero.
    if (total > 0) zoneMinutes = computed;
  }

  const log: CardioLog = {
    date,
    modality,
    duration_min: round1(secondsToMinutes(durationS)),
    source: 'strava',
    strava_activity_id: String(id),
  };
  if (distanceM !== undefined && distanceM > 0) log.distance_mi = round2(metresToMiles(distanceM));
  if (avgHr !== undefined) log.avg_hr = Math.round(avgHr);
  if (maxHr !== undefined) log.max_hr = Math.round(maxHr);
  if (zoneMinutes) log.zone_minutes = zoneMinutes;

  return log;
}

/** Everything about an activity we show but the engine does not consume. */
export interface StravaActivitySummary {
  strava_activity_id: string;
  name: string;
  date: string;
  /** ISO instant the activity started, in the athlete's local time. */
  started_at?: string;
  modality: CardioModality;
  sport_type: string;
  duration_min: number;
  elapsed_min?: number;
  distance_mi?: number;
  /** Miles per hour. */
  avg_speed_mph?: number;
  max_speed_mph?: number;
  /** Minutes per mile. `undefined` for non-distance activities. */
  avg_pace_min_per_mi?: number;
  /** Feet, converted from Strava's metres. */
  elevation_gain_ft?: number;
  avg_hr?: number;
  max_hr?: number;
  avg_cadence?: number;
  /** True when Strava flagged the HR as device-measured rather than estimated. */
  has_heartrate: boolean;
  private: boolean;
  manual: boolean;
  trainer: boolean;
}

/** Display-layer summary of an activity. Still imperial-only. */
export function summarizeActivity(
  activity: Record<string, unknown>,
): StravaActivitySummary | null {
  if (!activity || typeof activity !== 'object' || activity['id'] === undefined) return null;
  const date = isoDayFromActivity(activity);
  if (!date) return null;

  const movingS = num(activity['moving_time']) ?? 0;
  const elapsedS = num(activity['elapsed_time']);
  const distanceM = num(activity['distance']);
  const avgSpeed = num(activity['average_speed']);
  const maxSpeed = num(activity['max_speed']);
  const elevM = num(activity['total_elevation_gain']);
  const sportType = String(activity['sport_type'] ?? activity['type'] ?? 'Workout');

  const out: StravaActivitySummary = {
    strava_activity_id: String(activity['id']),
    name: String(activity['name'] ?? 'Untitled'),
    date,
    modality: mapSportType(sportType, { name: String(activity['name'] ?? '') }),
    sport_type: sportType,
    duration_min: round1(secondsToMinutes(movingS)),
    has_heartrate: activity['has_heartrate'] === true,
    private: activity['private'] === true,
    manual: activity['manual'] === true,
    trainer: activity['trainer'] === true,
  };
  const startedAt = activity['start_date_local'] ?? activity['start_date'];
  if (typeof startedAt === 'string') out.started_at = startedAt;
  if (elapsedS !== undefined) out.elapsed_min = round1(secondsToMinutes(elapsedS));
  if (distanceM !== undefined && distanceM > 0) out.distance_mi = round2(metresToMiles(distanceM));
  if (avgSpeed !== undefined) {
    out.avg_speed_mph = round2(mpsToMph(avgSpeed));
    const pace = mpsToMinPerMile(avgSpeed);
    if (pace !== undefined) out.avg_pace_min_per_mi = round2(pace);
  }
  if (maxSpeed !== undefined) out.max_speed_mph = round2(mpsToMph(maxSpeed));
  if (elevM !== undefined) out.elevation_gain_ft = Math.round(elevM * 3.280839895);
  const avgHr = num(activity['average_heartrate']);
  const maxHr = num(activity['max_heartrate']);
  const cad = num(activity['average_cadence']);
  if (avgHr !== undefined) out.avg_hr = Math.round(avgHr);
  if (maxHr !== undefined) out.max_hr = Math.round(maxHr);
  if (cad !== undefined) out.avg_cadence = round1(cad);
  return out;
}

/**
 * Laps → interval splits, for scoring 4×4 VO2max compliance (RESEARCH §6.1).
 * Metric in, imperial out, same as everything else here.
 */
export interface LapSummary {
  lap_index: number;
  duration_min: number;
  distance_mi?: number;
  avg_hr?: number;
  max_hr?: number;
  avg_pace_min_per_mi?: number;
}

/** Normalize `activities/{id}/laps` into imperial lap summaries. */
export function normalizeLaps(laps: Record<string, unknown>[] | null | undefined): LapSummary[] {
  if (!Array.isArray(laps)) return [];
  return laps.map((lap, i) => {
    const movingS = num(lap['moving_time']) ?? num(lap['elapsed_time']) ?? 0;
    const distanceM = num(lap['distance']);
    const avgSpeed = num(lap['average_speed']);
    const out: LapSummary = {
      lap_index: num(lap['lap_index']) ?? i + 1,
      duration_min: round1(secondsToMinutes(movingS)),
    };
    if (distanceM !== undefined && distanceM > 0) out.distance_mi = round2(metresToMiles(distanceM));
    const avgHr = num(lap['average_heartrate']);
    const maxHr = num(lap['max_heartrate']);
    if (avgHr !== undefined) out.avg_hr = Math.round(avgHr);
    if (maxHr !== undefined) out.max_hr = Math.round(maxHr);
    if (avgSpeed !== undefined) {
      const pace = mpsToMinPerMile(avgSpeed);
      if (pace !== undefined) out.avg_pace_min_per_mi = round2(pace);
    }
    return out;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The local calendar day the activity belongs to.
 * `start_date_local` is already shifted into the athlete's timezone, so slicing
 * the first 10 characters is correct — and using `start_date` (UTC) instead
 * would file a 7 pm Pacific run on the following day.
 */
export function isoDayFromActivity(activity: Record<string, unknown>): string | undefined {
  const local = activity['start_date_local'];
  if (typeof local === 'string' && local.length >= 10) return local.slice(0, 10);
  const utc = activity['start_date'];
  if (typeof utc === 'string' && utc.length >= 10) return utc.slice(0, 10);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return v;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
