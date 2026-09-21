/**
 * Longevity OS — The Planner
 *
 * The single entry point. Takes everything known about Seth and today, and
 * returns what he should do — plus the next six days, the ledger it respected,
 * and the reasoning behind all of it.
 *
 * Pure and deterministic: identical input, identical output, every time
 * (CLAUDE.md invariant 1). The plan is recomputed on every open and never read
 * back from storage as truth (invariant 4).
 */

import { ASSEMBLY, WEEKLY } from './constants.js';
import {
  assemble,
  cooldownBlock,
  isProgramDay,
  resolvePhase,
  warmupBlock,
  weekInPhase,
  type AssemblyInput,
} from './assembly.js';
import {
  prescribeSprints,
  prescribeVo2,
  prescribeWalkRun,
  prescribeZone2,
  resolveHrMax,
  runMilesLast7,
  zone2Ceiling,
} from './cardio.js';
import { evaluateDeload } from './deload.js';
import { orderingViolations } from './exclusions.js';
import { applyPlannedLoad, buildLedger } from './ledger.js';
import { currentE1rm } from './progression.js';
import { assessReadiness, neutralReadiness } from './readiness.js';
import { chooseSessionType, type ProgramDayClaim } from './template.js';
import type {
  CardioLog,
  CardioPrescription,
  Exercise,
  PlanInput,
  PlanResult,
  PrescribedSession,
  SessionBlock,
  SessionLog,
  SessionType,
  WeekDay,
  ReadinessAssessment,
  DeloadState,
  Ledger,
} from './types.js';
import { addDays, dayOfWeek, hashString, round, stableStringify, withinDays } from './util.js';
import { ledgerNotes, phaseLabel, sessionWhy } from './why.js';
import { weeklyDose } from './weekly.js';

/**
 * Plan today and the week ahead.
 *
 * Future days are projections: they assume neutral readiness, because we do not
 * forecast Oura. They exist so Seth can see the shape of the week and pull a day
 * forward, not so he can trust Thursday's exact load on Monday.
 */
export function plan(input: PlanInput): PlanResult {
  const generated_at = new Date(0).toISOString(); // deterministic; callers may overwrite
  const warnings: string[] = [];

  const { hr_max } = resolveHrMax({
    athlete: input.athlete,
    cardioHistory: input.cardio_history,
    today: input.today,
    oura: input.oura_today,
  });

  const e1rmByExercise = new Map(
    input.exercises.map((e) => [e.id, currentE1rm(e.id, input.history)] as const),
  );

  const todaySession = planDay({
    input,
    date: input.today,
    isToday: true,
    hrMax: hr_max,
    e1rmByExercise,
    priorPlanned: [],
    projected: { sessions: [], cardio: [] },
  });

  // The week: each day sees the projected load of the days before it, so a
  // Tuesday leg session actually blocks Wednesday's.
  const week: WeekDay[] = [
    { date: input.today, day_index: dayOfWeek(input.today), session: todaySession.session, is_today: true },
  ];

  const plannedSoFar: { date: string; blocks: SessionBlock[] }[] = [
    { date: input.today, blocks: todaySession.session.blocks },
  ];

  // Today counts toward the week as soon as it is planned, so tomorrow does not
  // re-prescribe it.
  const accumulated: { sessions: SessionLog[]; cardio: CardioLog[] } = {
    sessions: [asLoggedSession(todaySession.session)],
    cardio: asLoggedCardio(todaySession.session),
  };

  for (let i = 1; i <= 6; i++) {
    const date = addDays(input.today, i);
    const projectedDay = planDay({
      input,
      date,
      isToday: false,
      hrMax: hr_max,
      e1rmByExercise,
      priorPlanned: plannedSoFar,
      projected: { sessions: [...accumulated.sessions], cardio: [...accumulated.cardio] },
    });
    week.push({ date, day_index: dayOfWeek(date), session: projectedDay.session, is_today: false });
    plannedSoFar.push({ date, blocks: projectedDay.session.blocks });
    accumulated.sessions.push(asLoggedSession(projectedDay.session));
    accumulated.cardio.push(...asLoggedCardio(projectedDay.session));
  }

  const ledger = todaySession.ledger;
  const dose = weeklyDose({
    today: input.today,
    history: input.history,
    cardioHistory: input.cardio_history,
    exercises: input.exercises,
    ouraSteps: input.oura_history.filter((d) => withinDays(d.date, input.today, 7)).map((d) => d.steps ?? 0),
  });

  warnings.push(...orderingViolations(todaySession.session.blocks));

  // Compare like with like: when the settings put warm-up and cool-down outside
  // the stated budget, they are not an overrun — the budget is the working time.
  const bookends = input.goals.warmup_outside_budget
    ? (input.goals.warmup_min || ASSEMBLY.default_warmup_min) + (input.goals.cooldown_min || ASSEMBLY.default_cooldown_min)
    : 0;
  const allowed = input.budget_min + bookends + ASSEMBLY.overrun_tolerance_min;
  if (todaySession.session.estimated_min > allowed) {
    warnings.push(
      `Session estimates ${Math.round(todaySession.session.estimated_min)} min against a ${input.budget_min} min budget.`,
    );
  }
  if (dose.zone2_min > dose.zone2_ceiling_min * 1.05) {
    warnings.push(`Zone 2 volume is ${Math.round(dose.zone2_min)} min, above this week's ${Math.round(dose.zone2_ceiling_min)} min ramp ceiling.`);
  }

  const signature = hashString(
    stableStringify({
      today: input.today,
      budget: input.budget_min,
      location: input.location.id,
      goal: input.goals.mode,
      readiness: todaySession.session.readiness.score,
      type: todaySession.session.type,
      exercises: todaySession.session.blocks.flatMap((b) => b.exercises.map((e) => [e.exercise_id, e.sets.length, e.sets[0]?.load_lb])),
    }),
  );

  return {
    generated_at,
    today: todaySession.session,
    week,
    ledger,
    deload: todaySession.deload,
    weekly: dose,
    warnings,
    signature,
  };
}

/**
 * A projected session, expressed as though it had been logged exactly as
 * prescribed. Only ever fed back into the SAME plan call's later days — it is
 * never persisted and never mixed with real history outside this function.
 */
function asLoggedSession(session: PrescribedSession): SessionLog {
  return {
    id: `projected:${session.date}`,
    date: session.date,
    type: session.type,
    location_id: session.location_id,
    duration_min: session.estimated_min,
    completed: true,
    exercises: session.blocks.flatMap((b) =>
      b.exercises.map((pe) => ({
        exercise_id: pe.exercise_id,
        sets: pe.sets.map((s) => ({
          set_index: s.set_index,
          reps: s.reps,
          load_lb: s.load_lb,
          rpe: s.rpe_target,
          completed: true,
          ...(s.duration_s ? { duration_s: s.duration_s } : {}),
        })),
      })),
    ),
  };
}

/** The cardio blocks of a projected session, as logs. */
function asLoggedCardio(session: PrescribedSession): CardioLog[] {
  return session.blocks
    .filter((b) => b.cardio)
    .map((b) => {
      const c = b.cardio!;
      const zone = c.target_zone;
      const minutes = c.duration_min;
      return {
        date: session.date,
        modality: c.modality,
        duration_min: minutes,
        distance_mi: c.distance_mi,
        source: 'manual' as const,
        // Credit the prescribed zone only. A projected 4×4 should count as one
        // VO2 session, not as 28 minutes of Zone 2.
        zone_minutes: {
          z1: zone === 'z1' ? minutes : 0,
          z2: zone === 'z2' ? minutes : 0,
          z3: zone === 'z3' ? minutes : 0,
          z4: zone === 'z4' ? minutes : 0,
          z5: zone === 'z5' ? minutes : 0,
        },
      };
    });
}

interface DayPlanArgs {
  input: PlanInput;
  date: string;
  isToday: boolean;
  hrMax: number;
  e1rmByExercise: Map<string, number>;
  priorPlanned: { date: string; blocks: SessionBlock[] }[];
  /**
   * The earlier days of this week's projection, as if they had been logged.
   *
   * Without these, every projected day recomputes the weekly dose from real
   * history alone, sees "no VO2 session yet this week", and picks VO2 — six days
   * running. A projected week has to accumulate against itself or it is not a
   * week, it is the same day drawn seven times.
   */
  projected: { sessions: SessionLog[]; cardio: CardioLog[] };
}

function planDay(args: DayPlanArgs): { session: PrescribedSession; ledger: Ledger; deload: DeloadState } {
  const { input, date, isToday, hrMax, e1rmByExercise, priorPlanned, projected } = args;

  // Real history plus whatever this week's earlier projected days imply. Used
  // for the ledger, the weekly dose and the session-type choice. Predictions
  // deliberately keep using REAL history only — projecting a load off a load we
  // projected yesterday compounds a guess into a number Seth would read as fact.
  const effectiveHistory = [...input.history, ...projected.sessions];
  const effectiveCardio = [...input.cardio_history, ...projected.cardio];

  // ── Readiness ──────────────────────────────────────────────────────────────
  const readiness: ReadinessAssessment = isToday
    ? assessReadiness({
        today: date,
        oura: input.oura_today,
        ouraHistory: input.oura_history,
        selfReport: input.self_report,
      })
    : neutralReadiness();

  // ── Ledger, including whatever the earlier days of the week have planned ───
  let ledger = buildLedger({
    today: date,
    history: effectiveHistory,
    exercises: input.exercises,
    e1rmByExercise,
  });

  const byId = new Map(input.exercises.map((e) => [e.id, e]));
  for (const prior of priorPlanned) {
    if (prior.date >= date) continue;
    const hoursFrom = (new Date(date).getTime() - new Date(prior.date).getTime()) / 3_600_000;
    const planned = prior.blocks.flatMap((b) =>
      b.exercises
        .map((pe) => {
          const ex = byId.get(pe.exercise_id);
          return ex ? { exercise: ex, sets: pe.sets.map((s) => ({ reps: s.reps, load_lb: s.load_lb })) } : null;
        })
        .filter((x): x is { exercise: Exercise; sets: { reps: number; load_lb: number }[] } => x !== null),
    );
    ledger = applyPlannedLoad(ledger, planned, hoursFrom);
  }

  // ── Deload ─────────────────────────────────────────────────────────────────
  const deload = evaluateDeload({
    today: date,
    ouraHistory: input.oura_history,
    selfReports: input.recent_self_reports,
    history: effectiveHistory,
  });

  // ── Weekly dose and session type ───────────────────────────────────────────
  const dose = weeklyDose({
    today: date,
    history: effectiveHistory,
    cardioHistory: effectiveCardio,
    exercises: input.exercises,
  });

  const phase = resolvePhase(input.program, input.program_progress);
  const scheduled = isProgramDay(input.program, input.program_progress, date);
  const programToday: ProgramDayClaim | undefined =
    phase && scheduled !== undefined
      ? { scheduled, phaseName: phaseLabel(phase.name), scheduledDays: weekdayList(phase.weekdays) }
      : undefined;

  const decision = chooseSessionType({
    today: date,
    readiness,
    dose,
    ledger,
    history: effectiveHistory,
    cardioHistory: effectiveCardio,
    injuries: input.injuries,
    goal: input.goals.mode,
    budgetMin: input.budget_min,
    hasProgram: Boolean(input.program),
    ...(programToday ? { programToday } : {}),
    forcedType: isToday ? input.forced_session_type : undefined,
    deload: deload.active,
  });

  // ── Budget: warm-up and cool-down sit on top when settings say so ──────────
  const warmupMin = input.goals.warmup_min || ASSEMBLY.default_warmup_min;
  const cooldownMin = input.goals.cooldown_min || ASSEMBLY.default_cooldown_min;
  const workingBudget = input.goals.warmup_outside_budget
    ? input.budget_min
    : Math.max(ASSEMBLY.min_block_min, input.budget_min - warmupMin - cooldownMin);

  // ── Cardio first on a cardio day ───────────────────────────────────────────
  //
  // On a VO2 or Zone 2 day the cardio IS the session. Assembling strength and
  // mobility first would spend the budget and then append a 32-minute interval
  // block on top of it — which is how a 30-minute day became a 66-minute one.
  const CARDIO_LED: SessionType[] = ['vo2', 'zone2', 'sprint', 'recovery'];
  const cardioLed = CARDIO_LED.includes(decision.type);

  const leadCardio = cardioLed
    ? buildCardioBlock({
        type: decision.type,
        input,
        date,
        hrMax,
        remainingMin: workingBudget,
        deloadActive: deload.active,
      })
    : null;

  const strengthBudget = leadCardio
    ? Math.max(0, round(workingBudget - leadCardio.estimated_min, 2))
    : workingBudget;

  // ── Assemble ───────────────────────────────────────────────────────────────
  const assemblyInput: AssemblyInput = {
    today: date,
    type: decision.type,
    budgetMin: strengthBudget,
    targetRegions: decision.targetRegions,
    location: input.location,
    ledger,
    readiness,
    injuries: input.injuries.filter((i) => !i.resolved_on),
    goal: input.goals.mode,
    exercises: input.exercises,
    history: input.history,
    bodyweightLb: latestBodyweight(input),
    program: input.program,
    programProgress: input.program_progress,
    deloadVolumeMultiplier: deload.volume_multiplier,
    deloadLoadMultiplier: deload.load_multiplier,
    verticalFocus: input.goals.vertical_jump_focus,
    plyoContactsThisWeek: dose.plyo_contacts,
  };

  const assembled = assemble(assemblyInput);
  const blocks = [...assembled.blocks];
  const notes = [...assembled.notes];

  // ── Cardio ─────────────────────────────────────────────────────────────────
  const cardioBlock =
    leadCardio ??
    buildCardioBlock({
      type: decision.type,
      input,
      date,
      hrMax,
      remainingMin: Math.max(0, workingBudget - assembled.estimatedMin),
      deloadActive: deload.active,
    });
  if (cardioBlock) blocks.push(cardioBlock);

  // ── Bookends ───────────────────────────────────────────────────────────────
  if (decision.type !== 'recovery') {
    blocks.unshift(warmupBlock(warmupMin, decision.targetRegions));
    blocks.push(cooldownBlock(cooldownMin, decision.targetRegions));
  }

  const estimated_min = round(blocks.reduce((a, b) => a + b.estimated_min, 0), 1);

  notes.push(...ledgerNotes(ledger));
  for (const c of decision.considered.filter((c) => c.score === 0)) {
    notes.push(`Not ${c.type} today: ${c.note}`);
  }

  const session: PrescribedSession = {
    date,
    type: decision.type,
    title: titleFor(decision.type, input),
    location_id: input.location.id,
    why: sessionWhy({
      type: decision.type,
      rationale: decision.rationale,
      readiness,
      dose,
      deload,
      budgetMin: input.budget_min,
      ...(decision.type === 'kot' && input.program && phase
        ? {
            program: {
              name: input.program.name,
              phaseName: phaseLabel(phase.name),
              week: weekInPhase(input.program_progress),
            },
          }
        : {}),
    }),
    blocks,
    estimated_min,
    readiness,
    notes,
    deload: deload.active,
  };

  return { session, ledger, deload };
}

function buildCardioBlock(args: {
  type: SessionType;
  input: PlanInput;
  date: string;
  hrMax: number;
  remainingMin: number;
  deloadActive: boolean;
}): SessionBlock | null {
  const { type, input, date, hrMax, remainingMin } = args;
  const restingHr = input.athlete.resting_hr ?? input.oura_today?.resting_hr;
  const heavyLowerRecently = hadHeavyLowerWithin(input, date, 1);

  let cardio: CardioPrescription | null = null;

  switch (type) {
    case 'vo2':
      cardio = prescribeVo2({
        hrMax,
        restingHr,
        location: input.location,
        // What is actually left, not what was asked for at the top of the day.
        minutesAvailable: remainingMin,
        heavyLowerRecently,
      });
      break;
    case 'zone2': {
      const ceiling = zone2Ceiling(input.cardio_history, date);
      const already = input.cardio_history
        .filter((c) => withinDays(c.date, date, 7))
        .reduce((a, c) => a + (c.zone_minutes?.z2 ?? 0), 0);
      const room = Math.max(10, Math.min(remainingMin, ceiling - already));
      const weeklyRunMiles = runMilesLast7(input.cardio_history, date);
      cardio =
        weeklyRunMiles < 3
          ? prescribeWalkRun({ minutes: room, hrMax, restingHr, weeklyRunMiles })
          : prescribeZone2({ minutes: room, hrMax, restingHr, location: input.location, heavyLowerRecently });
      break;
    }
    case 'sprint':
      cardio = prescribeSprints({ hrMax });
      break;
    case 'recovery':
      cardio = {
        modality: 'walk',
        structure: 'steady',
        duration_min: Math.min(30, remainingMin),
        target_bpm: [Math.round(hrMax * 0.5), Math.round(hrMax * 0.6)],
        target_zone: 'z1',
        why: `An easy walk still counts toward the ${WEEKLY.steps_floor.toLocaleString('en-US')}-step floor, and it moves blood through everything that hurts.`,
      };
      break;
    default:
      // Strength and program days pick up Zone 2 only if there is real time left.
      if (remainingMin >= 15 && input.goals.mode !== 'bulk') {
        cardio = prescribeZone2({
          minutes: Math.min(remainingMin, 25),
          hrMax,
          restingHr,
          location: input.location,
          heavyLowerRecently: true, // it is the same session as the lifting
        });
      }
      break;
  }

  if (!cardio) return null;

  // Last line of defence: whatever the protocol wanted, it cannot exceed the
  // minutes it was given.
  if (cardio.duration_min > remainingMin && remainingMin > 0) {
    cardio = { ...cardio, duration_min: round(remainingMin, 0) };
  }
  if (cardio.duration_min <= 0) return null;

  return {
    kind: cardio.target_zone === 'z2' || cardio.target_zone === 'z1' ? 'zone2' : 'conditioning',
    title: cardioTitle(cardio),
    exercises: [],
    cardio,
    estimated_min: cardio.duration_min,
  };
}

function cardioTitle(c: CardioPrescription): string {
  if (c.structure === 'intervals' && c.intervals) {
    return `${c.intervals.rounds} × ${c.intervals.work_min} min`;
  }
  if (c.structure === 'walk_run') return 'Walk-run';
  if (c.structure === 'sprints') return 'Sprints';
  return c.target_zone === 'z1' ? 'Easy walk' : 'Zone 2';
}

function hadHeavyLowerWithin(input: PlanInput, date: string, days: number): boolean {
  const byId = new Map(input.exercises.map((e) => [e.id, e]));
  return input.history.some((s) => {
    if (!withinDays(s.date, date, days + 1)) return false;
    return s.exercises.some((le) => {
      const ex = byId.get(le.exercise_id);
      if (!ex) return false;
      const lower = (ex.region_loads.knees_quads ?? 0) + (ex.region_loads.posterior_chain ?? 0);
      return lower >= 0.8 && le.sets.some((set) => set.completed && (set.rpe ?? 8) >= 7);
    });
  });
}

function latestBodyweight(input: PlanInput): number {
  const sorted = [...input.body_metrics].sort((a, b) => (a.date > b.date ? -1 : 1));
  return sorted[0]?.weight_lb ?? input.athlete.bodyweight_lb;
}

/** [1, 3, 5] → "Mon, Wed and Fri". For the note that says why today is not one. */
function weekdayList(weekdays: number[]): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const labels = [...weekdays].sort((a, b) => a - b).map((d) => names[d] ?? String(d));
  if (labels.length <= 1) return labels[0] ?? 'no days';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function titleFor(type: SessionType, input: PlanInput): string {
  switch (type) {
    case 'kot':
      return input.program?.name ?? 'Knees Over Toes';
    case 'strength':
      return 'Strength';
    case 'power':
      return 'Power';
    case 'vo2':
      return 'VO2 intervals';
    case 'zone2':
      return 'Zone 2';
    case 'sprint':
      return 'Sprints';
    case 'mobility':
      return 'Mobility';
    case 'recovery':
      return 'Recovery';
    default:
      return 'Session';
  }
}

/**
 * Re-solve the week when Seth pulls a future day forward. The engine replans
 * under the same constraints with the chosen type forced onto today, so the rest
 * of the week rearranges itself around the change.
 */
export function rebalanceWeek(input: PlanInput, pullForwardDate: string): PlanResult {
  const current = plan(input);
  const target = current.week.find((d) => d.date === pullForwardDate);
  if (!target) return current;
  return plan({ ...input, forced_session_type: target.session.type });
}
