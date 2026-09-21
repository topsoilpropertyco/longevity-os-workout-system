import { EQUIPMENT } from '@longevity/engine';
import type {
  Equipment,
  Program,
  ProgramDay,
  ProgramPhase,
  ProgramProgress,
  ProgramStep,
} from '@longevity/engine';

/**
 * PROGRAM — Supabase rows → the engine's `Program`.
 *
 * `programs`, `program_steps` and `program_progress` are the database's shape:
 * two integer columns for a range, jsonb for anything structured, and a
 * `step_key` where the engine says `id`. The engine's shape is the domain's.
 * This module is the one place the two are reconciled, so the difference does
 * not leak into a screen.
 *
 * Every mapper here is TOTAL: a missing column, a null, or a jsonb document of
 * the wrong shape produces a sane value rather than an exception. That is not
 * defensiveness for its own sake — `programs.phases` is free-form jsonb that a
 * migration or a hand-edit in the Supabase table editor can put anything into,
 * and the today card must not be the thing that discovers it (CLAUDE.md
 * invariant 2: never block the today card).
 *
 * WEEKDAYS. `ProgramPhase.weekdays` and `ProgramDay.weekday` follow the engine
 * and `Date.getDay()`: 0 = Sunday … 6 = Saturday. That agrees with ISO for
 * Monday through Friday and disagrees only about Sunday. Knees Over Toes trains
 * no weekend, so today the two are indistinguishable — which is exactly why
 * this is written down rather than left to be inferred later.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Row shapes
// ─────────────────────────────────────────────────────────────────────────────
// Structural rather than `Tables<'programs'>`. Callers reach this with rows
// from an untyped `select('*')` against a client that may have no `Database`
// bound to it, so what actually arrives is `unknown`-ish. Naming the handful of
// fields used here keeps the module honest without claiming a type safety the
// query does not have — and a row that IS `Tables<'programs'>` satisfies these
// structurally, so the typed path costs nothing.

export interface ProgramRowish {
  id?: string;
  slug?: string | null;
  name?: string | null;
  description?: string | null;
  ordering?: string | null;
  days_per_week_min?: number | null;
  days_per_week_max?: number | null;
  blocks?: unknown;
  target_cycles?: number | null;
  source?: string | null;
  attribution?: string | null;
  phases?: unknown;
  days?: unknown;
  current_phase_id?: string | null;
}

export interface ProgramStepRowish {
  step_key?: string | null;
  step_order?: number | null;
  name?: string | null;
  standard_text?: string | null;
  standard?: unknown;
  exercise_slug?: string | null;
  substitutions?: unknown;
  prerequisites?: unknown;
  block?: string | null;
  phase_id?: string | null;
  progressions?: unknown;
  demo_url?: string | null;
  per_side?: boolean | null;
  rest_s?: number | null;
  load_ramp_override?: unknown;
}

export interface ProgramProgressRowish {
  cycle?: number | null;
  met?: unknown;
  current_step_ids?: unknown;
  phase_id?: string | null;
  week_in_phase?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coercion
// ─────────────────────────────────────────────────────────────────────────────

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function int(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function strings(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string');
}

/** Postgres `integer[]` and a jsonb array of numbers both land here. */
function numbers(v: unknown): number[] {
  return arr(v).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
}

const EQUIPMENT_SET: ReadonlySet<Equipment> = new Set(EQUIPMENT);

const ORDERINGS = new Set<Program['ordering']>(['ground_up', 'as_listed', 'engine_choice']);

function ordering(v: unknown): Program['ordering'] {
  return ORDERINGS.has(v as Program['ordering']) ? (v as Program['ordering']) : 'as_listed';
}

// ─────────────────────────────────────────────────────────────────────────────
// Phases and weekday templates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A load rule the engine does not recognise becomes `standards_driven` rather
 * than being dropped. Dropping it would leave the phase with no rule at all,
 * and "choose load from the standards" is the one reading that is safe whatever
 * the intent was — it never invents a number the program did not state.
 */
function loadRule(v: unknown): ProgramPhase['load_rule'] {
  const o = obj(v);
  switch (o['kind']) {
    case 'bodyweight_only':
      return { kind: 'bodyweight_only' };
    case 'percent_bw_ramp':
      return {
        kind: 'percent_bw_ramp',
        start_pct: int(o['start_pct'], 0),
        weekly_increment_pct: int(o['weekly_increment_pct'], 0),
      };
    default:
      return { kind: 'standards_driven' };
  }
}

function sessionMinutes(v: unknown): [number, number] {
  const n = numbers(v);
  const lo = n[0] ?? 0;
  return [lo, n[1] ?? lo];
}

export function toPhases(v: unknown): ProgramPhase[] {
  return arr(v)
    .map((raw, i): ProgramPhase => {
      const o = obj(raw);
      const weekdays = numbers(o['weekdays']).filter((d) => d >= 0 && d <= 6);
      return {
        id: str(o['id'], `phase-${i + 1}`),
        name: str(o['name'], `Phase ${i + 1}`),
        order: int(o['order'], i + 1),
        // `weeks: null` is meaningful — it is how an open-ended phase (KOT's
        // Standards, which runs until every benchmark is met) says so. It must
        // survive the round trip rather than defaulting to a number.
        weeks: typeof o['weeks'] === 'number' ? int(o['weeks'], 0) : null,
        days_per_week: int(o['days_per_week'], weekdays.length),
        weekdays,
        session_min: sessionMinutes(o['session_min']),
        load_rule: loadRule(o['load_rule']),
        description: str(o['description']),
      };
    })
    .sort((a, b) => a.order - b.order);
}

export function toDays(v: unknown): ProgramDay[] {
  return arr(v).map((raw): ProgramDay => {
    const o = obj(raw);
    const demo = str(o['demo_url']);
    return {
      phase_id: str(o['phase_id']),
      weekday: int(o['weekday'], 1),
      title: str(o['title']),
      focus: str(o['focus']),
      blocks: arr(o['blocks']).map((b) => {
        const bo = obj(b);
        return { title: str(bo['title']), step_ids: strings(bo['step_ids']) };
      }),
      ...(demo ? { demo_url: demo } : {}),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────────────

function toStep(row: ProgramStepRowish, i: number): ProgramStep {
  // A substitution naming equipment the vocabulary does not have can never
  // match a location, so it would sit in the data doing nothing. Dropping it
  // here at least makes the step's substitution list mean what it says.
  const substitutions = arr(row.substitutions)
    .map((s) => {
      const o = obj(s);
      const note = str(o['note']);
      return {
        equipment_missing: str(o['equipment_missing']),
        use_slug: str(o['use_slug']),
        ...(note ? { note } : {}),
      };
    })
    .filter((s): s is { equipment_missing: Equipment; use_slug: string; note?: string } =>
      s.use_slug !== '' && EQUIPMENT_SET.has(s.equipment_missing as Equipment),
    );

  const standard = obj(row.standard);
  const ramp = toRampOverride(row.load_ramp_override);
  const progressions = strings(row.progressions);
  const prerequisites = strings(row.prerequisites);
  const demo = str(row.demo_url);

  return {
    id: str(row.step_key, `step-${i + 1}`),
    order: int(row.step_order, i + 1),
    name: str(row.name),
    standard_text: str(row.standard_text),
    ...(Object.keys(standard).length ? { standard: standard as ProgramStep['standard'] } : {}),
    exercise_slug: str(row.exercise_slug),
    ...(substitutions.length ? { substitutions } : {}),
    ...(prerequisites.length ? { prerequisites } : {}),
    block: str(row.block),
    ...(row.phase_id ? { phase_id: row.phase_id } : {}),
    ...(progressions.length ? { progressions } : {}),
    ...(demo ? { demo_url: demo } : {}),
    ...(row.per_side ? { per_side: true } : {}),
    ...(typeof row.rest_s === 'number' ? { rest_s: row.rest_s } : {}),
    ...(ramp ? { load_ramp_override: ramp } : {}),
  };
}

/**
 * A per-step ramp override, or `undefined`.
 *
 * Only whole numbers survive. The column is jsonb and the database constrains
 * its shape, but a value that reached the table before that constraint existed
 * — or through a path that bypassed it — would otherwise arrive as a string and
 * silently prescribe `NaN` pounds. An override that cannot be read is better
 * dropped: the step then follows its phase, which is the ordinary rule.
 */
function toRampOverride(v: unknown): ProgramStep['load_ramp_override'] | undefined {
  const o = obj(v);
  const out: NonNullable<ProgramStep['load_ramp_override']> = {};
  if (typeof o['start_pct'] === 'number' && Number.isFinite(o['start_pct'])) {
    out.start_pct = o['start_pct'];
  }
  if (
    typeof o['weekly_increment_pct'] === 'number' &&
    Number.isFinite(o['weekly_increment_pct'])
  ) {
    out.weekly_increment_pct = o['weekly_increment_pct'];
  }
  return Object.keys(out).length ? out : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// The two public mappers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns `undefined` — not an empty program — when the row is unusable. A
 * program with no steps would make the engine schedule nothing and say nothing
 * about why; no program at all makes it fall through to its own template, which
 * is a session Seth can actually do.
 */
export function toProgram(
  row: ProgramRowish | null | undefined,
  stepRows: ProgramStepRowish[],
): Program | undefined {
  if (!row?.slug || stepRows.length === 0) return undefined;

  const steps = stepRows
    .map(toStep)
    .filter((s) => s.exercise_slug !== '')
    .sort((a, b) => a.order - b.order);
  if (steps.length === 0) return undefined;

  const min = int(row.days_per_week_min, 2);
  const phases = toPhases(row.phases);
  const days = toDays(row.days);
  const known = new Set(phases.map((p) => p.id));
  const current = str(row.current_phase_id);

  return {
    slug: row.slug,
    name: str(row.name, row.slug),
    description: str(row.description),
    ordering: ordering(row.ordering),
    days_per_week: [min, Math.max(min, int(row.days_per_week_max, min))],
    blocks: arr(row.blocks).map((b, i) => {
      const o = obj(b);
      const note = str(o['note']);
      return {
        id: str(o['id'], `block-${i + 1}`),
        name: str(o['name']),
        order: int(o['order'], i + 1),
        ...(note ? { note } : {}),
      };
    }),
    steps,
    target_cycles: Math.max(1, int(row.target_cycles, 1)),
    source: str(row.source),
    ...(row.attribution ? { attribution: row.attribution } : {}),
    ...(phases.length ? { phases } : {}),
    ...(days.length ? { days } : {}),
    // A `current_phase_id` naming a phase that is not declared is worse than
    // none: the engine would filter every step out and produce an empty
    // session. 0010 constrains this in the database; this is the belt.
    ...(current && known.has(current) ? { current_phase_id: current } : {}),
  };
}

/**
 * Where the athlete is. `phase_id` falls back to the program's own starting
 * phase, so an athlete enrolled before phases existed still gets a coherent
 * position rather than being filtered down to nothing.
 */
export function toProgramProgress(
  row: ProgramProgressRowish | null | undefined,
  program: Program,
): ProgramProgress {
  const met: ProgramProgress['met'] = {};
  for (const [id, raw] of Object.entries(obj(row?.met))) {
    const o = obj(raw);
    const date = str(o['date']);
    if (date) met[id] = { date, evidence: str(o['evidence']) };
  }

  const known = new Set((program.phases ?? []).map((p) => p.id));
  const stored = str(row?.phase_id);
  const phase = known.has(stored) ? stored : program.current_phase_id;

  const stepIds = strings(row?.current_step_ids);
  const inPhase = program.steps
    .filter((s) => !phase || !s.phase_id || s.phase_id === phase)
    .map((s) => s.id);

  return {
    program_slug: program.slug,
    cycle: Math.max(1, int(row?.cycle, 1)),
    met,
    // An empty `current_step_ids` means "nobody has chosen yet", not "nothing
    // is in play" — a brand-new athlete has the whole first phase ahead of them.
    current_step_ids: stepIds.length ? stepIds : inPhase,
    ...(phase ? { phase_id: phase } : {}),
    ...(phase ? { week_in_phase: Math.max(1, int(row?.week_in_phase, 1)) } : {}),
  };
}
