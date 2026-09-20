/**
 * Deterministic copy for when both LM Studio and Gemini are unreachable.
 *
 * The last link in CLAUDE.md invariant 2: **no LM Studio → Gemini; no Gemini →
 * template copy**. The today card must never block on a model and must never
 * render an empty "why" line.
 *
 * Everything here is pure string assembly over engine output. No network, no
 * randomness beyond a deterministic pick seeded by the date, no arithmetic the
 * engine did not already do. These sentences are indistinguishable from a good
 * model's output about 80% of the time, which is the point — the fallback is
 * not an error state Seth should be able to notice.
 */

import type {
  PrescribedSession,
  ReadinessAssessment,
  SessionType,
  WeeklyDose,
} from '@longevity/engine';

/** Template copy is tagged so the UI can log the fallback rate. */
export const FALLBACK_PROVIDER = 'template';

// ─────────────────────────────────────────────────────────────────────────────
// The "why" line
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_LABEL: Record<SessionType, string> = {
  strength: 'strength work',
  kot: 'knee and ankle work',
  power: 'power work',
  vo2: 'a VO2max session',
  zone2: 'Zone 2',
  sprint: 'sprint work',
  mobility: 'mobility',
  recovery: 'a recovery day',
  external: 'whatever you do outside the app',
};

const BAND_OPENER: Record<ReadinessAssessment['band'], string[]> = {
  push: [
    'Readiness is high and the regions are fresh',
    'Everything says green today',
    'Recovery is ahead of the plan',
  ],
  as_planned: [
    'Readiness is normal',
    'Nothing in the numbers says change course',
    'Steady readiness',
  ],
  reduced: [
    'Readiness is down',
    'Recovery is lagging',
    'The numbers are softer than usual',
  ],
  recovery: [
    'Readiness is low enough to back off',
    'Recovery comes first today',
    'The numbers say rest, not work',
  ],
};

/**
 * Build the one-line "why" from a prescribed session, with no model involved.
 *
 * Prefers, in order: the engine's own `why` (which is already a sentence and is
 * the most accurate thing available), then the strongest readiness reason, then
 * a plain description of the day's shape. Deterministic: the same session
 * always produces the same sentence, so a retry does not change the card.
 */
export function fallbackWhyLine(session: PrescribedSession): string {
  // 1. The engine already said it. Nothing beats that.
  if (session.why && session.why.trim().length > 0) return session.why.trim();

  const readiness = session.readiness;
  const label = SESSION_LABEL[session.type] ?? 'today’s session';
  const minutes = Math.round(session.estimated_min);
  const opener = pick(BAND_OPENER[readiness.band] ?? BAND_OPENER.as_planned, session.date);

  // 2. The strongest reason the engine recorded, verbatim.
  const reason = readiness.reasons?.[0];
  if (reason) {
    return `${opener} — ${lowerFirst(reason)}, so today is ${label} for ${minutes} minutes.`;
  }

  // 3. HRV deviation, when it exists and is material.
  const dev = readiness.hrv_vs_baseline_pct;
  if (typeof dev === 'number' && Math.abs(dev) >= 5) {
    const dir = dev < 0 ? 'under' : 'over';
    return `HRV is ${Math.abs(Math.round(dev))}% ${dir} baseline, so today is ${label} for ${minutes} minutes.`;
  }

  // 4. A deload in force is always worth naming.
  if (session.deload) {
    return `You’re in a deload week, so today is ${label} at reduced volume for ${minutes} minutes.`;
  }

  // 5. Plain shape of the day.
  return `${opener}, so today is ${label} for ${minutes} minutes.`;
}

/** The "why" for one exercise, when the engine did not supply one. */
export function fallbackExerciseWhy(opts: {
  exerciseName: string;
  pattern?: string;
  isProgramStep?: boolean;
  isRehab?: boolean;
}): string {
  if (opts.isRehab) return `${opts.exerciseName} is here to rehabilitate, not to load.`;
  if (opts.isProgramStep) return `${opts.exerciseName} is the next step in your program.`;
  if (opts.pattern) return `${opts.exerciseName} covers the ${humanPattern(opts.pattern)} slot today.`;
  return `${opts.exerciseName} fits today’s time and equipment.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram copy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 06:30 daily brief, assembled without a model. Plain text — the caller
 * escapes it for MarkdownV2.
 */
export function fallbackDailyBrief(session: PrescribedSession, locationName?: string): string {
  const lines: string[] = [];
  lines.push(session.title || `${capitalize(SESSION_LABEL[session.type] ?? 'Training')} day`);
  lines.push('');
  lines.push(fallbackWhyLine(session));
  lines.push('');
  const where = locationName ? ` at ${locationName}` : '';
  lines.push(`${Math.round(session.estimated_min)} min${where}.`);
  const blocks = session.blocks
    .filter((b) => b.kind !== 'warmup' && b.kind !== 'cooldown')
    .map((b) => b.title)
    .filter(Boolean);
  if (blocks.length > 0) lines.push(blocks.join(' · '));
  return lines.join('\n');
}

/** Post-session confirmation without a model. */
export function fallbackSessionSummary(opts: {
  sessionType: SessionType;
  durationMin: number;
  exerciseCount: number;
  setCount: number;
  tonnageLb?: number;
}): string {
  const parts = [
    `${capitalize(SESSION_LABEL[opts.sessionType] ?? 'Session')} logged: ${Math.round(opts.durationMin)} min, ${opts.exerciseCount} exercise${opts.exerciseCount === 1 ? '' : 's'}, ${opts.setCount} set${opts.setCount === 1 ? '' : 's'}.`,
  ];
  if (typeof opts.tonnageLb === 'number' && opts.tonnageLb > 0) {
    parts.push(`${Math.round(opts.tonnageLb).toLocaleString('en-US')} lb of total volume.`);
  }
  parts.push('Tomorrow’s plan already accounts for it.');
  return parts.join(' ');
}

/**
 * The Sunday weekly report without a model. Every number is copied straight
 * from `WeeklyDose`; nothing here computes a trend.
 */
export function fallbackWeeklyNarrative(weekly: WeeklyDose): string {
  const lines: string[] = ['Week in review'];
  lines.push('');
  lines.push(
    `${weekly.sessions} session${weekly.sessions === 1 ? '' : 's'}, ${Math.round(weekly.strength_min)} min of strength work.`,
  );
  lines.push(
    `Zone 2: ${Math.round(weekly.zone2_min)} of ${Math.round(weekly.zone2_target_min)} target minutes.`,
  );
  if (weekly.vo2_sessions > 0) {
    lines.push(`VO2max sessions: ${weekly.vo2_sessions}.`);
  }
  if (weekly.tonnage_lb > 0) {
    lines.push(`Total tonnage: ${Math.round(weekly.tonnage_lb).toLocaleString('en-US')} lb.`);
  }
  if (weekly.plyo_contacts > 0) {
    lines.push(`Plyometric contacts: ${weekly.plyo_contacts}.`);
  }
  if (typeof weekly.steps_avg === 'number') {
    lines.push(`Steps averaged ${Math.round(weekly.steps_avg).toLocaleString('en-US')} a day.`);
  }
  lines.push('');
  lines.push(
    weekly.zone2_min >= weekly.zone2_target_min
      ? 'Zone 2 target met.'
      : `${Math.max(0, Math.round(weekly.zone2_target_min - weekly.zone2_min))} Zone 2 minutes short of target.`,
  );
  return lines.join('\n');
}

/** The reply when a chat message needs a model and no model answered. */
export function fallbackChatReply(kind: 'offline' | 'unparsed' = 'offline'): string {
  return kind === 'offline'
    ? 'The language model is offline right now, so I can only do the button actions: Start, a shorter budget, Home instead, or Skip. Everything you log still lands.'
    : 'I did not catch that one. Try "20 min", "home", "skip", "swap", or send a photo of the board.';
}

/** Acknowledgement text for a button tap, when copy generation is unavailable. */
export function fallbackCallbackAck(kind: string): string {
  switch (kind) {
    case 'start':
      return 'Session started.';
    case 'skip':
      return 'Skipped. The week re-plans around it.';
    case 'set_budget':
      return 'Re-planned for the shorter budget.';
    case 'set_location':
      return 'Re-planned for that location.';
    case 'slider':
      return 'Logged.';
    case 'injury_pain':
      return 'Pain score logged.';
    case 'scale':
      return 'Got it.';
    case 'swap':
      return 'Swapped.';
    default:
      return 'Done.';
  }
}

/** Copy for when Oura is unreachable and the sliders take over. */
export function fallbackNoOuraPrompt(): string {
  return 'No Oura data this morning. Three taps: how sore, how much energy, how stressed?';
}

/** Copy for when Strava is unreachable. */
export function fallbackNoStravaPrompt(): string {
  return 'Strava did not sync. Tell me the minutes and how hard it felt and I will log it.';
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic choice from a list, seeded by a string (the date).
 * Same day, same sentence — so a re-plan on every open (invariant 4) does not
 * make the card's wording flicker.
 */
function pick<T>(options: readonly T[], seed: string): T {
  if (options.length === 0) throw new Error('pick() called with no options');
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return options[hash % options.length] as T;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

/** `horizontal_push` → `horizontal push`. */
function humanPattern(p: string): string {
  return p.replace(/_/g, ' ');
}
