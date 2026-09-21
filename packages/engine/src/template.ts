/**
 * Longevity OS — Weekly Template
 *
 * Chooses WHAT KIND of session today should be. Assembly then decides what goes
 * in it. Kept separate because the two questions have genuinely different
 * inputs: the template looks at the week's shape, assembly at the day's minutes.
 *
 * Evidence defaults from RESEARCH §6.1; the priority logic is the engine's own.
 */

import { WEEKLY } from './constants.js';
import { availableRegions } from './ledger.js';
import type {
  CardioLog,
  GoalMode,
  Injury,
  Ledger,
  ReadinessAssessment,
  Region,
  SessionLog,
  SessionType,
  WeeklyDose,
} from './types.js';
import { GOAL_BANDS, REGION_GROUPS } from './constants.js';
import { countThisWeek, deficits } from './weekly.js';
import { daysBetween, rankBy, withinDays } from './util.js';
import { daysSinceHardCardio } from './cardio.js';

/** What the active phase's calendar says about today. */
export interface ProgramDayClaim {
  /** True when this weekday is in the phase's `weekdays`. */
  scheduled: boolean;
  /** "Zero", "Dense", "Standards" — used in the note, so it reads as English. */
  phaseName: string;
  /** The phase's training weekdays, spelled out: "Mon, Wed and Fri". */
  scheduledDays: string;
}

export interface TemplateDecision {
  type: SessionType;
  /** Why this type, in one line. Feeds the session's why. */
  rationale: string;
  /** Candidate types considered, with their scores — surfaced in the audit view. */
  considered: { type: SessionType; score: number; note: string }[];
  /** Regions this session should target, given what is fresh. */
  targetRegions: Region[];
}

/**
 * Pick today's session type.
 *
 * Order of authority:
 *   1. Readiness `recovery` band — nothing else matters, today is recovery.
 *   2. A forced type from the week carousel — Seth asked for it.
 *   3. Hard constraints: the ledger, plyo spacing, no two hard run days running.
 *   4. Weekly deficits, weighted by goal mode emphasis.
 */
export function chooseSessionType(args: {
  today: string;
  readiness: ReadinessAssessment;
  dose: WeeklyDose;
  ledger: Ledger;
  history: SessionLog[];
  cardioHistory: CardioLog[];
  injuries: Injury[];
  goal: GoalMode;
  budgetMin: number;
  hasProgram: boolean;
  /**
   * The active phase's claim on today, when the program has one. A phased
   * program names the weekdays it trains — KOT's Zero is Monday/Wednesday/
   * Friday — and that calendar, not a weekly session count, is what decides
   * whether today is a program day.
   */
  programToday?: ProgramDayClaim;
  forcedType?: SessionType;
  deload: boolean;
}): TemplateDecision {
  const {
    today, readiness, dose, ledger, history, cardioHistory, goal, budgetMin, hasProgram, programToday,
    forcedType, deload,
  } = args;

  const considered: TemplateDecision['considered'] = [];
  const fresh = availableRegions(ledger);

  // 1. Recovery overrides everything. This is the "never tear down" goal made literal.
  if (readiness.band === 'recovery') {
    return {
      type: 'recovery',
      rationale:
        readiness.reasons.find((r) => r.includes('HRV')) ??
        `Readiness ${Math.round(readiness.score)} — today is mobility, an easy walk, and breathing.`,
      considered: [{ type: 'recovery', score: 1, note: 'Forced by the readiness band.' }],
      targetRegions: [],
    };
  }

  // 2. Seth pulled a day forward from the carousel.
  if (forcedType) {
    return {
      type: forcedType,
      rationale: 'You moved this one to today.',
      considered: [{ type: forcedType, score: 1, note: 'Requested from the week carousel.' }],
      targetRegions: targetRegionsFor(forcedType, fresh),
    };
  }

  const def = deficits(dose);
  const emphasis = GOAL_BANDS[goal].emphasis;
  const lastType = mostRecentType(history, today);
  const daysSinceHardRun = daysSinceHardCardio(cardioHistory, today);
  const lastPlyo = daysSinceType(history, today, 'power');

  const score = (type: SessionType, base: number, note: string): void => {
    considered.push({ type, score: base * (emphasis[type] ?? 1), note });
  };

  // ── Knees Over Toes: the active program gets first claim on the week ────────
  if (hasProgram) {
    const kotThisWeek = countThisWeek(history, today, 'kot');
    const kotTarget = WEEKLY.kot_sessions[deload ? 0 : 1];
    // KOT is a knee program. Fresh calves are not a reason to run it on cooked
    // quads — the region that carries the work has to be the one that is ready.
    const lowerFresh = fresh.includes('knees_quads');

    if (programToday && !programToday.scheduled) {
      // The phase trains on named weekdays. Running its session on a day it does
      // not train is not "extra program work", it is a different program.
      considered.push({
        type: 'kot',
        score: 0,
        note: `${programToday.phaseName} trains ${programToday.scheduledDays} — today is not one of them.`,
      });
    } else if (!lowerFresh) {
      // A scheduled day loses to the ledger. The calendar is the program's
      // claim; ≥48 h between hard hits on the same region is a hard constraint
      // (CLAUDE.md invariant 5), and a hard constraint cannot be outvoted by a
      // schedule any more than by a deficit.
      considered.push({ type: 'kot', score: 0, note: 'Lower body is still recovering.' });
    } else if (programToday) {
      // A scheduled, legal program day. No weekly count gate: the phase's own
      // weekday list already bounds how often this fires (three times a week in
      // Zero, five in Dense), and refusing Thursday because three sessions are
      // already logged would mean not running the phase as written.
      score('kot', 0.95, `${programToday.phaseName} trains ${programToday.scheduledDays}, and today is one.`);
    } else if (kotThisWeek < kotTarget) {
      // An unphased program, or a phase with no weekday list: fall back to the
      // weekly session count.
      score('kot', 0.9 - kotThisWeek * 0.2, `${kotThisWeek}/${kotTarget} KOT sessions done this week.`);
    }
  }

  // ── Power / plyometrics: only when fresh, only with spacing, never on a deload ──
  if (!deload && readiness.band !== 'reduced') {
    const powerThisWeek = countThisWeek(history, today, 'power');
    const spaced = lastPlyo === null || lastPlyo >= 2;
    // Plyometrics land on the knees, calves and posterior chain at once, so all
    // three must be genuinely available. Checking ACWR instead would read the
    // "unknown" value of 0 as safe, which is precisely backwards.
    const legsFresh = (['knees_quads', 'calves_achilles', 'posterior_chain'] as const).every((r) =>
      fresh.includes(r),
    );
    if (powerThisWeek < WEEKLY.power_blocks[1] && spaced && legsFresh && budgetMin >= 30) {
      score('power', 0.75 - powerThisWeek * 0.25, 'Power work goes first and fresh, or not at all.');
    } else if (!spaced) {
      considered.push({ type: 'power', score: 0, note: 'Plyometrics need a day between them.' });
    }
  }

  // ── VO2: one a week, never the day after a hard run ────────────────────────
  if (!deload && readiness.band !== 'reduced' && budgetMin >= 25) {
    const canGoHard = daysSinceHardRun === null || daysSinceHardRun >= 2;
    if (dose.vo2_sessions < WEEKLY.vo2_sessions && canGoHard) {
      score('vo2', 0.85 * (0.5 + def.vo2 / 2), 'The single highest-leverage session for lifespan.');
    } else if (!canGoHard) {
      considered.push({ type: 'vo2', score: 0, note: 'Hard cardio yesterday — no two in a row.' });
    }
  }

  // ── Strength ───────────────────────────────────────────────────────────────
  const strengthSessions = countThisWeek(history, today, 'strength');
  const anyFresh = fresh.length > 0;
  if (anyFresh && dose.strength_min < WEEKLY.strength_hard_cap_min) {
    score(
      'strength',
      0.7 * (0.4 + def.strength * 0.6) - (strengthSessions >= WEEKLY.strength_sessions[1] ? 0.4 : 0),
      `${dose.strength_min} of ${WEEKLY.strength_min_range[0]}–${WEEKLY.strength_min_range[1]} weekly strength minutes.`,
    );
  } else if (dose.strength_min >= WEEKLY.strength_hard_cap_min) {
    considered.push({ type: 'strength', score: 0, note: 'Past the point where more lifting adds longevity benefit.' });
  }

  // ── Zone 2: the workhorse, capped by the 10%/week ramp ─────────────────────
  const zone2Room = dose.zone2_ceiling_min - dose.zone2_min;
  if (zone2Room > 10) {
    score('zone2', 0.65 * (0.3 + def.zone2 * 0.7), `${Math.round(zone2Room)} min of Zone 2 left under this week's ramp.`);
  } else {
    considered.push({ type: 'zone2', score: 0.1, note: 'At this week\'s aerobic ceiling — more would break the 10% rule.' });
  }

  // ── Mobility / yoga ────────────────────────────────────────────────────────
  score('mobility', 0.45 * (0.3 + def.mobility * 0.7), `${dose.mobility_sessions} of ${WEEKLY.mobility_sessions_min} mobility sessions this week.`);

  // ── Short days lean toward what fits ───────────────────────────────────────
  if (budgetMin <= 20) {
    for (const c of considered) {
      if (c.type === 'vo2' || c.type === 'power') c.score *= 0.4;
      if (c.type === 'mobility' || c.type === 'zone2') c.score *= 1.35;
    }
  }

  // ── Do not repeat yesterday's type two days running, unless it is Zone 2 ───
  //
  // A scheduled program day is exempt: Dense trains Monday through Friday, and
  // the phase saying "train again today" is not the engine drifting into a rut.
  // The ledger still decides whether the body can take it.
  if (lastType && lastType !== 'zone2' && lastType !== 'mobility') {
    for (const c of considered) {
      if (c.type !== lastType) continue;
      if (c.type === 'kot' && programToday?.scheduled) continue;
      c.score *= 0.55;
    }
  }

  // ── Reduced readiness: steer away from the hardest options ─────────────────
  if (readiness.band === 'reduced') {
    for (const c of considered) {
      if (c.type === 'vo2' || c.type === 'power' || c.type === 'sprint') c.score *= 0.2;
      if (c.type === 'zone2' || c.type === 'mobility') c.score *= 1.2;
    }
  }

  const ranked = rankBy(considered.filter((c) => c.score > 0), (c) => c.score, (c) => c.type);
  const winner = ranked[0];

  if (!winner) {
    // Everything is blocked. Something physical every day is goal 2, so the
    // answer is never "nothing" — it is the gentlest thing that still counts.
    return {
      type: 'recovery',
      rationale: 'Everything else is still recovering — walk, breathe, and move what does not hurt.',
      considered,
      targetRegions: [],
    };
  }

  return {
    type: winner.type,
    rationale: winner.note,
    considered: rankBy(considered, (c) => c.score, (c) => c.type),
    targetRegions: targetRegionsFor(winner.type, fresh),
  };
}

function targetRegionsFor(type: SessionType, fresh: Region[]): Region[] {
  switch (type) {
    case 'kot':
      return REGION_GROUPS.lower.filter((r) => fresh.includes(r));
    case 'strength': {
      // Prefer whichever half of the body has more freshness to work with.
      const lower = REGION_GROUPS.lower.filter((r) => fresh.includes(r));
      const upper = REGION_GROUPS.upper.filter((r) => fresh.includes(r));
      if (upper.length > lower.length) return [...upper, ...REGION_GROUPS.trunk.filter((r) => fresh.includes(r))];
      if (lower.length > upper.length) return [...lower, ...REGION_GROUPS.trunk.filter((r) => fresh.includes(r))];
      return fresh;
    }
    case 'power':
      return REGION_GROUPS.lower.filter((r) => fresh.includes(r));
    case 'mobility':
    case 'recovery':
      return [];
    default:
      return fresh;
  }
}

function mostRecentType(history: SessionLog[], today: string): SessionType | null {
  const sorted = history
    .filter((s) => s.completed && s.date < today && daysBetween(s.date, today) <= 3)
    .sort((a, b) => (a.date > b.date ? -1 : 1));
  return sorted[0]?.type ?? null;
}

function daysSinceType(history: SessionLog[], today: string, type: SessionType): number | null {
  const found = history
    .filter((s) => s.completed && s.type === type && s.date <= today)
    .map((s) => daysBetween(s.date, today));
  return found.length ? Math.min(...found) : null;
}

/** Sessions logged today already — used to avoid double-prescribing. */
export function sessionsToday(history: SessionLog[], today: string): SessionLog[] {
  return history.filter((s) => s.date === today && withinDays(s.date, today, 1));
}
