/**
 * Longevity OS — Readiness
 *
 * Turns Oura data and the three sliders into one band that modulates the whole
 * session. PRD §8.1, RESEARCH §6.4.
 *
 * Degradation path (CLAUDE.md invariant 2): Oura → sliders → a neutral default.
 * The today card never waits on a network call to answer this question.
 */

import {
  DEFAULT_READINESS_SCORE,
  HRV_RECOVERY_TRIGGER_PCT,
  READINESS_BANDS,
  SLIDER_WEIGHTS,
} from './constants.js';
import type { OuraDaily, ReadinessAssessment, ReadinessBand, SelfReport } from './types.js';
import { clamp, mean, round } from './util.js';

/**
 * Mean HRV over the trailing `days` of Oura history, excluding today.
 * Returns null when there is not enough data to make the comparison meaningful.
 */
export function hrvBaseline(history: OuraDaily[], today: string, days = 28): number | null {
  const values = history
    .filter((d) => d.date < today && typeof d.hrv_ms === 'number')
    .slice(-days)
    .map((d) => d.hrv_ms as number);
  // Fewer than a week of nights is noise, not a baseline.
  if (values.length < 7) return null;
  return mean(values);
}

/** Today's HRV as a percentage deviation from baseline. Negative means suppressed. */
export function hrvDeviationPct(todayHrv: number | undefined, baseline: number | null): number | undefined {
  if (typeof todayHrv !== 'number' || baseline === null || baseline === 0) return undefined;
  return round(((todayHrv - baseline) / baseline) * 100, 1);
}

/**
 * Sliders → a 0–100 score on the same scale as Oura readiness.
 *
 * Soreness and energy read 1 (bad) to 5 (good). Stress is inverted: a 5 means
 * maxed out, so it is flipped before weighting.
 *
 * The mapping is piecewise-linear rather than a flat ×100, and that detail
 * matters more than it looks. Oura's neutral day is not 50 — it is around 75, in
 * the middle of the as-planned band. Mapping a neutral 3/3/3 to 50 would put the
 * two signals on different scales, so every ordinary self-report would look like
 * a 20-point disagreement with the ring and trip the caution rule below. So:
 *
 *   all-bad (0.0) → 0 · neutral (0.5) → 75 · all-good (1.0) → 100
 *
 * A neutral report now says "nothing unusual", which is what Seth means when he
 * taps three threes, rather than "half dead".
 */
export function scoreFromSliders(r: SelfReport): number {
  const soreness = (r.soreness - 1) / 4;
  const energy = (r.energy - 1) / 4;
  const stress = (5 - r.stress) / 4;
  const composite =
    soreness * SLIDER_WEIGHTS.soreness + energy * SLIDER_WEIGHTS.energy + stress * SLIDER_WEIGHTS.stress;

  const score =
    composite <= 0.5
      ? (composite / 0.5) * DEFAULT_READINESS_SCORE
      : DEFAULT_READINESS_SCORE + ((composite - 0.5) / 0.5) * (100 - DEFAULT_READINESS_SCORE);

  return round(clamp(score, 0, 100), 1);
}

function bandFor(score: number): ReadinessBand {
  if (score >= READINESS_BANDS.push.min) return 'push';
  if (score >= READINESS_BANDS.as_planned.min) return 'as_planned';
  if (score >= READINESS_BANDS.reduced.min) return 'reduced';
  return 'recovery';
}

/**
 * The full assessment. Both Oura and sliders present → blend, weighting Oura
 * more heavily but letting a genuinely terrible self-report drag the score down.
 * Seth knows something the ring does not when he says he is wrecked.
 */
export function assessReadiness(args: {
  today: string;
  oura?: OuraDaily;
  ouraHistory: OuraDaily[];
  selfReport?: SelfReport;
}): ReadinessAssessment {
  const { today, oura, ouraHistory, selfReport } = args;
  const reasons: string[] = [];

  const baseline = hrvBaseline(ouraHistory, today);
  const hrvDev = hrvDeviationPct(oura?.hrv_ms, baseline);

  const ouraScore = typeof oura?.readiness_score === 'number' ? oura.readiness_score : undefined;
  const sliderScore = selfReport ? scoreFromSliders(selfReport) : undefined;

  let score: number;
  let source: ReadinessAssessment['source'];

  if (ouraScore !== undefined && sliderScore !== undefined) {
    // 70/30 toward Oura, but the lower of the two pulls harder when they disagree
    // sharply — a 20-point gap means one of them is missing something real.
    const blended = ouraScore * 0.7 + sliderScore * 0.3;
    const gap = Math.abs(ouraScore - sliderScore);
    score = gap > 20 ? Math.min(blended, Math.min(ouraScore, sliderScore) + 10) : blended;
    source = 'blend';
    reasons.push(`Oura ${Math.round(ouraScore)}, your sliders read ${Math.round(sliderScore)}.`);
    if (gap > 20) reasons.push('Ring and sliders disagree — the engine trusts the more cautious one.');
  } else if (ouraScore !== undefined) {
    score = ouraScore;
    source = 'oura';
    reasons.push(`Oura readiness ${Math.round(ouraScore)}.`);
  } else if (sliderScore !== undefined) {
    score = sliderScore;
    source = 'sliders';
    reasons.push(`No ring data today — going off your sliders (${Math.round(sliderScore)}).`);
  } else {
    score = DEFAULT_READINESS_SCORE;
    source = 'default';
    reasons.push('No readiness data — assuming a normal day.');
  }

  score = round(clamp(score, 0, 100), 1);
  let band = bandFor(score);

  // HRV well below baseline overrides the score outright. A good readiness number
  // on a badly suppressed HRV is the exact case this rule exists to catch.
  if (hrvDev !== undefined && hrvDev <= HRV_RECOVERY_TRIGGER_PCT) {
    if (band !== 'recovery') {
      reasons.push(`HRV is ${Math.abs(hrvDev)}% below your 28-day baseline — today is recovery regardless of the score.`);
    }
    band = 'recovery';
  } else if (hrvDev !== undefined) {
    reasons.push(`HRV ${hrvDev >= 0 ? '+' : ''}${hrvDev}% vs baseline.`);
  }

  // Sleep score in the basement is worth a note even when readiness looks fine.
  if (typeof oura?.sleep_score === 'number' && oura.sleep_score < 60) {
    reasons.push(`Sleep score ${Math.round(oura.sleep_score)} — expect less out of yourself today.`);
  }

  const spec = READINESS_BANDS[band];
  return {
    band,
    score,
    source,
    load_multiplier: spec.load_multiplier,
    rpe_cap: spec.rpe_cap,
    set_delta: spec.set_delta,
    hrv_vs_baseline_pct: hrvDev,
    reasons,
  };
}

/**
 * Projected readiness for a future day in the week carousel. We do not pretend
 * to forecast Oura, so future days assume the neutral band — the plan for
 * Thursday is what Thursday looks like if Thursday is ordinary.
 */
export function neutralReadiness(): ReadinessAssessment {
  return {
    band: 'as_planned',
    score: DEFAULT_READINESS_SCORE,
    source: 'default',
    load_multiplier: READINESS_BANDS.as_planned.load_multiplier,
    rpe_cap: READINESS_BANDS.as_planned.rpe_cap,
    set_delta: 0,
    reasons: ['Projected — assumes an ordinary day.'],
  };
}
