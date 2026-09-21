/**
 * Longevity OS — Deterministic "Why" Copy
 *
 * Every prescription carries a reason (PRD §8.1). The LLM writes a nicer version
 * when it is reachable, but it may only rephrase what is here — it never changes
 * a number and never invents a rationale (CLAUDE.md invariant 1).
 *
 * When LM Studio and Gemini are both unreachable, these strings ARE the copy.
 */

import { WEEKLY } from './constants.js';
import type {
  DeloadState,
  Ledger,
  PrescribedSession,
  ReadinessAssessment,
  SessionType,
  WeeklyDose,
} from './types.js';
import { REGIONS } from './types.js';


const TYPE_OPENERS: Record<SessionType, string> = {
  strength: 'Strength day.',
  kot: 'Knees Over Toes.',
  power: 'Power day.',
  vo2: 'VO2 day.',
  zone2: 'Easy aerobic day.',
  sprint: 'Sprint day.',
  mobility: 'Mobility.',
  recovery: 'Recovery day.',
  external: 'Logged from outside the app.',
};

/**
 * The one line Seth reads before deciding to show up. Ordered so the most
 * decision-relevant fact comes first: what today is, then why today, then the
 * one constraint worth knowing about.
 */
export function sessionWhy(args: {
  type: SessionType;
  rationale: string;
  readiness: ReadinessAssessment;
  dose: WeeklyDose;
  deload: DeloadState;
  budgetMin: number;
}): string {
  const { type, rationale, readiness, dose, deload, budgetMin } = args;
  const parts: string[] = [TYPE_OPENERS[type]];

  if (deload.active) {
    parts.push(`Deload week — ${deload.triggers[0] ?? 'time for a lighter one'}.`);
  } else {
    switch (readiness.band) {
      case 'push':
        parts.push(`Readiness ${Math.round(readiness.score)} — green light, take the extra set.`);
        break;
      case 'as_planned':
        parts.push(`Readiness ${Math.round(readiness.score)} — run it as written.`);
        break;
      case 'reduced':
        parts.push(`Readiness ${Math.round(readiness.score)} — 10% lighter, nothing above RPE 7.`);
        break;
      case 'recovery':
        parts.push(readiness.reasons[readiness.reasons.length - 1] ?? 'Recovery today.');
        break;
    }
  }

  parts.push(rationale);

  // Deliberately no minutes here. The card shows the ESTIMATE ("33 min · Home")
  // right above this line, and the budget is what Seth asked for — printing
  // "45 minutes" underneath "33 min" reads as a contradiction rather than as
  // two different facts. The Telegram brief, which has no card, adds its own.
  void budgetMin;

  return dedupe(parts).join(' ');
}

/** The weekly-dose sentence for the Sunday report and the dashboard. */
export function weeklyNarrative(dose: WeeklyDose): string {
  const bits: string[] = [];
  bits.push(`${dose.sessions} sessions.`);

  const z2Goal = Math.min(dose.zone2_ceiling_min, WEEKLY.zone2_target_min);
  if (dose.zone2_min >= z2Goal) {
    bits.push(`Zone 2 at ${Math.round(dose.zone2_min)} min — target met.`);
  } else {
    bits.push(
      `Zone 2 at ${Math.round(dose.zone2_min)} of ${Math.round(z2Goal)} min (this week's ceiling under the 10% ramp).`,
    );
  }

  bits.push(dose.vo2_sessions >= WEEKLY.vo2_sessions ? 'VO2 session done.' : 'VO2 session still owed.');

  const [lo, hi] = WEEKLY.strength_min_range;
  if (dose.strength_min < lo) bits.push(`Strength at ${dose.strength_min} min, short of ${lo}.`);
  else if (dose.strength_min > WEEKLY.strength_hard_cap_min) bits.push(`Strength at ${dose.strength_min} min — past the point of added benefit.`);
  else bits.push(`Strength at ${dose.strength_min} min, inside the ${lo}–${hi} window.`);

  if (dose.tonnage_lb > 0) bits.push(`${Math.round(dose.tonnage_lb).toLocaleString('en-US')} lb moved.`);

  return bits.join(' ');
}

/** Human-readable summary of what the ledger is currently blocking. */
export function ledgerNotes(ledger: Ledger): string[] {
  return REGIONS.filter((r) => !ledger[r].available && ledger[r].block_reason).map(
    (r) => `${r.replace(/_/g, ' ')}: ${ledger[r].block_reason}`,
  );
}

/** A compact one-line diff for the week carousel's rearrange confirmation. */
export function weekDiff(before: PrescribedSession[], after: PrescribedSession[]): string {
  const changes: string[] = [];
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const b = before[i];
    const a = after[i];
    if (!b || !a) continue;
    if (b.type !== a.type) changes.push(`${shortDay(a.date)} ${b.type} → ${a.type}`);
  }
  if (changes.length === 0) return 'Rest of the week is unchanged.';
  if (changes.length <= 2) return changes.join(', ') + '.';
  return `${changes.slice(0, 2).join(', ')}, and ${changes.length - 2} more.`;
}

function shortDay(iso: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const [y, m, d] = iso.split('-').map(Number);
  return days[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? iso;
}

function dedupe(parts: string[]): string[] {
  const seen = new Set<string>();
  return parts.filter((p) => {
    const key = p.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
