/**
 * Heart-rate zones: boundaries, zone minutes, HRmax resolution, compliance.
 *
 * This is the file that turns a chest-strap trace into the one number the whole
 * longevity thesis rests on — minutes in Zone 2 (RESEARCH §6.1: 180–240
 * min/week across 3–5 sessions, Zone 2 defined as 60–70% HRmax, conversational).
 *
 * We compute zones ourselves rather than calling `GET /activities/{id}/zones`,
 * which requires a paid Strava subscription. See the note in `client.ts`.
 *
 * Nothing here does I/O and nothing here throws: bad input yields all-zero zone
 * minutes, which the caller can distinguish from a real all-zero activity by
 * checking `computeZoneMinutesDetailed().sampled_min`.
 */

import type { Athlete, CardioLog, CardioPrescription, ZoneMinutes } from '@longevity/engine';

/** The five zone keys, low to high. */
export const ZONE_KEYS = ['z1', 'z2', 'z3', 'z4', 'z5'] as const;
export type ZoneKey = (typeof ZONE_KEYS)[number];

/** Inclusive-lower, exclusive-upper bpm bounds per zone (top zone is closed). */
export type ZoneBoundaries = Record<ZoneKey, [number, number]>;

export type ZoneMethod = 'hrmax' | 'karvonen';

/**
 * The five standard zones as FRACTIONS of intensity.
 *
 * Zone 2 = 60–70% is the number RESEARCH §6.1 pins the weekly target to; the
 * rest follow the conventional five-zone model. These fractions are applied to
 * HRmax directly (`hrmax` method) or to heart-rate reserve (`karvonen`).
 */
export const ZONE_FRACTIONS: Record<ZoneKey, [number, number]> = {
  z1: [0.5, 0.6],
  z2: [0.6, 0.7],
  z3: [0.7, 0.8],
  z4: [0.8, 0.9],
  z5: [0.9, 1.0],
};

/** Physiologically plausible HRmax window; anything outside is a strap artifact. */
export const HR_MAX_PLAUSIBLE: [number, number] = [120, 225];
/** Plausible instantaneous HR; samples outside are dropped as dropouts/spikes. */
export const HR_SAMPLE_PLAUSIBLE: [number, number] = [30, 240];

/**
 * Longest gap between two samples we still treat as continuous exercise.
 * Strava streams pause when the watch pauses; a 40-minute gap must not be
 * booked as 40 minutes in whatever zone the last sample happened to be in.
 */
export const MAX_SAMPLE_GAP_S = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Boundaries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zone boundaries in bpm.
 *
 * - `hrmax` (default): bounds are straight percentages of HRmax.
 * - `karvonen`: bounds are percentages of heart-rate RESERVE added to resting
 *   HR — `rest + pct × (max − rest)`. More accurate for anyone with a low
 *   resting HR, and it is why we sync Oura's sleeping RHR. Falls back to the
 *   `hrmax` method when no resting HR is supplied, rather than guessing one.
 *
 * Returns integer bpm; each zone's upper bound is the next zone's lower bound.
 */
export function zoneBoundaries(
  hrMax: number,
  restingHr?: number,
  method: ZoneMethod = 'hrmax',
): ZoneBoundaries {
  const max = clamp(Math.round(hrMax), HR_MAX_PLAUSIBLE[0], HR_MAX_PLAUSIBLE[1]);
  const useKarvonen =
    method === 'karvonen' &&
    typeof restingHr === 'number' &&
    Number.isFinite(restingHr) &&
    restingHr > 25 &&
    restingHr < max - 40;
  const rest = useKarvonen ? Math.round(restingHr as number) : 0;
  const reserve = useKarvonen ? max - rest : max;

  const at = (pct: number): number => Math.round(rest + pct * reserve);

  const out = {} as ZoneBoundaries;
  for (const key of ZONE_KEYS) {
    const [lo, hi] = ZONE_FRACTIONS[key];
    out[key] = [at(lo), key === 'z5' ? max : at(hi)];
  }
  return out;
}

/** Which zone a bpm reading falls in. Below Z1's floor counts as Z1. */
export function zoneForBpm(bpm: number, zones: ZoneBoundaries): ZoneKey | null {
  if (!Number.isFinite(bpm)) return null;
  if (bpm < HR_SAMPLE_PLAUSIBLE[0] || bpm > HR_SAMPLE_PLAUSIBLE[1]) return null;
  // Easy walking below the Z1 floor is still aerobic time; it is booked to Z1
  // so it never inflates the Zone 2 number the weekly target is judged on.
  if (bpm < zones.z1[0]) return 'z1';
  for (const key of ZONE_KEYS) {
    const [lo, hi] = zones[key];
    if (bpm >= lo && (bpm < hi || key === 'z5')) return key;
  }
  // Above HRmax — a genuine effort beyond the estimate, or a spike. Z5.
  return 'z5';
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone minutes
// ─────────────────────────────────────────────────────────────────────────────

/** A Strava stream set, or plain parallel arrays. Both are accepted. */
export interface HrStreamInput {
  time?: { data?: unknown } | number[] | undefined;
  heartrate?: { data?: unknown } | number[] | undefined;
  moving?: { data?: unknown } | boolean[] | undefined;
}

export interface ZoneMinutesDetail {
  minutes: ZoneMinutes;
  /** Total time actually attributed to a zone, in minutes. */
  sampled_min: number;
  /** Samples dropped as implausible or unusable. */
  dropped_samples: number;
  /** Seconds skipped because the gap between samples exceeded the cap. */
  gap_seconds: number;
  /** Median interval between samples. 1s for most straps; 5s+ for smart recording. */
  median_interval_s: number;
}

const EMPTY_ZONES = (): ZoneMinutes => ({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });

/**
 * Integrate a heart-rate stream into minutes per zone.
 *
 * The naive version multiplies the sample count by one second. That is wrong:
 * Strava's "smart recording" emits irregular samples (1s, 3s, 10s, more during
 * a pause), so we use the TIME stream and credit each sample with the real
 * interval to the next one. Gaps longer than `MAX_SAMPLE_GAP_S` are treated as
 * a paused watch and contribute nothing. The final sample is credited with the
 * median interval.
 *
 * Returns all-zero minutes for unusable input rather than throwing — a run with
 * no strap simply reports no zone data and the compliance score degrades.
 */
export function computeZoneMinutes(stream: HrStreamInput, zones: ZoneBoundaries): ZoneMinutes {
  return computeZoneMinutesDetailed(stream, zones).minutes;
}

/** `computeZoneMinutes` plus the diagnostics needed to trust the number. */
export function computeZoneMinutesDetailed(
  stream: HrStreamInput,
  zones: ZoneBoundaries,
): ZoneMinutesDetail {
  const hr = numberArray(stream?.heartrate);
  const t = numberArray(stream?.time);
  const moving = booleanArray(stream?.moving);
  const empty: ZoneMinutesDetail = {
    minutes: EMPTY_ZONES(),
    sampled_min: 0,
    dropped_samples: 0,
    gap_seconds: 0,
    median_interval_s: 0,
  };
  if (!hr || hr.length === 0) return empty;

  // No time stream: fall back to the 1 Hz assumption, which is what Strava
  // actually delivers for a paired chest strap. Flagged via median_interval_s.
  const times = t && t.length === hr.length ? t : hr.map((_, i) => i);

  const intervals: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const dt = (times[i] as number) - (times[i - 1] as number);
    if (Number.isFinite(dt) && dt > 0) intervals.push(dt);
  }
  const medianInterval = intervals.length > 0 ? median(intervals) : 1;

  const seconds = EMPTY_ZONES();
  let dropped = 0;
  let gapSeconds = 0;

  for (let i = 0; i < hr.length; i += 1) {
    const bpm = hr[i];
    const rawDt =
      i < hr.length - 1
        ? (times[i + 1] as number) - (times[i] as number)
        : medianInterval;

    if (!Number.isFinite(rawDt) || rawDt <= 0) {
      dropped += 1;
      continue;
    }
    // A paused watch, a tunnel, a dead strap: credit nothing but record it.
    if (rawDt > MAX_SAMPLE_GAP_S) {
      gapSeconds += rawDt;
      continue;
    }
    // Honour the `moving` stream when Strava gave us one — standing at a
    // crosswalk with HR at 130 is not Zone 3 training time.
    if (moving && moving.length === hr.length && moving[i] === false) {
      gapSeconds += rawDt;
      continue;
    }
    const zone = typeof bpm === 'number' ? zoneForBpm(bpm, zones) : null;
    if (!zone) {
      dropped += 1;
      continue;
    }
    seconds[zone] += rawDt;
  }

  const minutes = EMPTY_ZONES();
  let total = 0;
  for (const key of ZONE_KEYS) {
    minutes[key] = round1(seconds[key] / 60);
    total += seconds[key];
  }

  return {
    minutes,
    sampled_min: round1(total / 60),
    dropped_samples: dropped,
    gap_seconds: Math.round(gapSeconds),
    median_interval_s: round1(medianInterval),
  };
}

/** Sum of all five zones, in minutes. */
export function totalZoneMinutes(z: ZoneMinutes): number {
  return round1(ZONE_KEYS.reduce((acc, k) => acc + (z[k] ?? 0), 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// HRmax resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Whatever the caller can offer from Oura as an HRmax hint. */
export type OuraHrMaxHint = number | { max_hr?: number; hr_max?: number } | undefined | null;

export interface ResolvedHrMax {
  bpm: number;
  /** Matches `Athlete['hr_max_source']`, so it can be written straight back. */
  source: 'measured_strava' | 'oura' | 'formula';
  /** One line for the settings screen and the audit view. */
  basis: string;
}

/**
 * Resolve the HRmax every zone boundary hangs off.
 *
 * Precedence, settled in PRD §13: **measured Strava max over the last 90 days >
 * Oura > 220 − age**. A measured max is a real observation; the formula is a
 * population average with a ±10–12 bpm standard deviation, so it is the last
 * resort. Implausible candidates (strap spikes over 225, dropouts under 120)
 * are rejected and the next source is used.
 *
 * A manual override typed into settings is applied by the CALLER before this
 * runs — this function only arbitrates between the three measured sources. When
 * no fresh 90-day max is passed but the athlete already carries a stored
 * `hr_max` with `hr_max_source: 'measured_strava'`, that stored value is used.
 */
export function resolveHrMax(
  athlete: Pick<Athlete, 'birth_date' | 'hr_max' | 'hr_max_source'>,
  stravaMax90d?: number | null,
  oura?: OuraHrMaxHint,
): ResolvedHrMax {
  const strava = plausibleHrMax(stravaMax90d);
  if (strava !== undefined) {
    return {
      bpm: strava,
      source: 'measured_strava',
      basis: 'highest heart rate recorded in Strava over the last 90 days',
    };
  }

  // No fresh window, but a previously measured max is still better than Oura.
  if (athlete.hr_max_source === 'measured_strava') {
    const stored = plausibleHrMax(athlete.hr_max);
    if (stored !== undefined) {
      return {
        bpm: stored,
        source: 'measured_strava',
        basis: 'previously measured Strava max (no activity with HR in the last 90 days)',
      };
    }
  }

  const ouraValue = plausibleHrMax(
    typeof oura === 'number' ? oura : (oura?.max_hr ?? oura?.hr_max),
  );
  if (ouraValue !== undefined) {
    return { bpm: ouraValue, source: 'oura', basis: 'highest heart rate observed by Oura' };
  }

  const age = ageFromBirthDate(athlete.birth_date);
  const formula = clamp(Math.round(220 - age), HR_MAX_PLAUSIBLE[0], HR_MAX_PLAUSIBLE[1]);
  return {
    bpm: formula,
    source: 'formula',
    basis: `220 − ${age} (age-predicted estimate; ±10–12 bpm — replace with a measured max when one exists)`,
  };
}

/**
 * Highest heart rate across a set of Strava activities inside the trailing
 * window. Feed the result to `resolveHrMax`.
 */
export function stravaMaxHrOverWindow(
  activities: { max_heartrate?: unknown; start_date?: unknown; start_date_local?: unknown }[],
  days = 90,
  now: Date = new Date(),
): number | undefined {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  let best: number | undefined;
  for (const a of activities) {
    const started = Date.parse(String(a.start_date ?? a.start_date_local ?? ''));
    if (Number.isFinite(started) && started < cutoff) continue;
    const hr = plausibleHrMax(a.max_heartrate);
    if (hr !== undefined && (best === undefined || hr > best)) best = hr;
  }
  return best;
}

/** Whole years between a birth date and `now`. */
export function ageFromBirthDate(birthDate: string, now: Date = new Date()): number {
  const born = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return 40; // conservative, never NaN downstream
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const m = now.getUTCMonth() - born.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return clamp(age, 5, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance
// ─────────────────────────────────────────────────────────────────────────────

export interface ComplianceDetail {
  /** 0–1 overall. */
  score: number;
  /** 0–1 for time spent in (or adjacent to) the prescribed zone. */
  zone_score: number;
  /** 0–1 for hitting the prescribed duration. */
  duration_score: number;
  /** Minutes actually spent in the prescribed zone, when a stream existed. */
  in_zone_min?: number;
  /** How the zone part was judged. */
  basis: 'zone_minutes' | 'average_hr' | 'duration_only';
  /** One line for the bot summary. */
  note: string;
}

/**
 * Did the run do what it was told? 0 = nothing like it, 1 = exactly on plan.
 *
 * Weighted 60% zone / 40% duration: being in the right zone is the point, but a
 * perfect 12-minute Zone 2 shuffle is not a 45-minute Zone 2 session.
 *
 * Grading rules:
 *   - Full credit for minutes in the prescribed zone; HALF credit for the zones
 *     immediately either side, because a strap's zone edges are ±3 bpm noisy
 *     and drifting one zone up on a hill is not a failed session.
 *   - No HR stream → fall back to average HR against the prescribed bpm band;
 *     no HR at all → duration only, capped at 0.7 since we cannot verify effort.
 *   - Going long is not rewarded: duration credit caps at 1.0 and decays past
 *     150% of prescription, which is a ≤10%/week ramp violation, not compliance.
 */
export function scoreCompliance(
  prescription: Pick<CardioPrescription, 'target_zone' | 'duration_min' | 'target_bpm'>,
  actual: Pick<CardioLog, 'duration_min' | 'zone_minutes' | 'avg_hr'>,
): number {
  return explainCompliance(prescription, actual).score;
}

/** `scoreCompliance` with the breakdown, for the audit view and the bot copy. */
export function explainCompliance(
  prescription: Pick<CardioPrescription, 'target_zone' | 'duration_min' | 'target_bpm'>,
  actual: Pick<CardioLog, 'duration_min' | 'zone_minutes' | 'avg_hr'>,
): ComplianceDetail {
  const prescribedMin = Math.max(1, prescription.duration_min || 0);
  const actualMin = Math.max(0, actual.duration_min || 0);

  // Duration: linear up to 1.0, then decaying for a big overshoot.
  const ratio = actualMin / prescribedMin;
  const durationScore =
    ratio <= 1 ? clamp(ratio, 0, 1) : clamp(1 - Math.max(0, ratio - 1.5) * 0.5, 0.6, 1);

  const target = prescription.target_zone;
  const targetIndex = ZONE_KEYS.indexOf(target);

  if (actual.zone_minutes) {
    const z = actual.zone_minutes;
    const inZone = z[target] ?? 0;
    const below = targetIndex > 0 ? (z[ZONE_KEYS[targetIndex - 1] as ZoneKey] ?? 0) : 0;
    const above =
      targetIndex < ZONE_KEYS.length - 1 ? (z[ZONE_KEYS[targetIndex + 1] as ZoneKey] ?? 0) : 0;
    const credited = inZone + 0.5 * (below + above);
    // Judged against the shorter of prescribed and actual so that a session cut
    // short is penalised by the duration term, not twice.
    const denominator = Math.max(1, Math.min(prescribedMin, Math.max(actualMin, totalZoneMinutes(z))));
    const zoneScore = clamp(credited / denominator, 0, 1);
    return {
      score: round2(0.6 * zoneScore + 0.4 * durationScore),
      zone_score: round2(zoneScore),
      duration_score: round2(durationScore),
      in_zone_min: round1(inZone),
      basis: 'zone_minutes',
      note: `${round1(inZone)} of ${round1(actualMin)} min in ${target.toUpperCase()} against ${prescribedMin} min prescribed`,
    };
  }

  if (typeof actual.avg_hr === 'number' && Number.isFinite(actual.avg_hr)) {
    const [lo, hi] = prescription.target_bpm;
    const avg = actual.avg_hr;
    let zoneScore: number;
    if (avg >= lo && avg <= hi) zoneScore = 1;
    else {
      // Lose 10% of the zone score per bpm outside the band, floored at 0.
      const miss = avg < lo ? lo - avg : avg - hi;
      zoneScore = clamp(1 - miss * 0.1, 0, 1);
    }
    return {
      score: round2(0.6 * zoneScore + 0.4 * durationScore),
      zone_score: round2(zoneScore),
      duration_score: round2(durationScore),
      basis: 'average_hr',
      note: `average ${Math.round(avg)} bpm against a ${lo}–${hi} bpm target (no HR stream)`,
    };
  }

  // Nothing but a duration. Credit the work, but never call it verified.
  return {
    score: round2(clamp(durationScore * 0.7, 0, 0.7)),
    zone_score: 0,
    duration_score: round2(durationScore),
    basis: 'duration_only',
    note: `${round1(actualMin)} of ${prescribedMin} min logged, no heart-rate data to verify intensity`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Accept either a Strava `{ data: [...] }` stream or a bare array. */
function numberArray(src: unknown): number[] | null {
  const raw = Array.isArray(src) ? src : (src as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const v of raw) out.push(typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  return out;
}

/** Same, for the boolean `moving` stream. */
function booleanArray(src: unknown): boolean[] | null {
  const raw = Array.isArray(src) ? src : (src as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(raw)) return null;
  return raw.map((v) => v === true);
}

/** Reject strap artifacts before they become an athlete's HRmax. */
function plausibleHrMax(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (n < HR_MAX_PLAUSIBLE[0] || n > HR_MAX_PLAUSIBLE[1]) return undefined;
  return Math.round(n);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length === 0) return 0;
  return s.length % 2 === 0 ? ((s[mid - 1] as number) + (s[mid] as number)) / 2 : (s[mid] as number);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
