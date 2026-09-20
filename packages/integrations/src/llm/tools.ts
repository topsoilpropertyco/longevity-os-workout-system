/**
 * ENGINE TOOL SCHEMA — CLAUDE.md invariant 1:
 * **The LLM may request engine actions and explain the results; it may never
 * author a prescription the deterministic engine did not produce.**
 *
 * Read that sentence before adding a tool. Every tool below either READS engine
 * output or asks the engine to RE-DERIVE a plan from a changed input (a budget,
 * a location, a pain score, a logged set). None of them accepts sets, reps,
 * loads, zones or durations as a prescription. `swap_exercise` names a direction
 * — `easier` / `same` / `harder` — and the engine picks the movement AND its
 * sets from the ranked candidates; the model does not get to say "3×10 at 95".
 *
 * The line to hold: **the model changes INPUTS and reads OUTPUTS.** If a
 * proposed tool would let it write a number that lands in front of Seth as a
 * prescription, it does not belong here — it belongs in the engine.
 *
 * Both dialects are exported for each tool: OpenAI/LM Studio `tools[]` and
 * Gemini `functionDeclarations[]`, from one source of truth.
 */

/** Minimal JSON Schema subset both providers accept. */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  /** Always false on our objects: an unknown key is a hallucinated argument. */
  additionalProperties?: boolean;
}

export interface EngineToolDef {
  name: EngineToolName;
  description: string;
  parameters: JsonSchema;
  /** Read-only tools are safe to run speculatively; the rest mutate state. */
  readOnly: boolean;
}

export const ENGINE_TOOL_NAMES = [
  'get_today_plan',
  'swap_exercise',
  'set_budget_minutes',
  'set_location',
  'log_set',
  'log_external_session',
  'log_body_metric',
  'set_injury_pain',
  'skip_today',
  'explain_exercise',
] as const;
export type EngineToolName = (typeof ENGINE_TOOL_NAMES)[number];

const obj = (
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });

const isoDate: JsonSchema = {
  type: 'string',
  description: 'ISO date YYYY-MM-DD in the athlete’s local timezone. Omit for today.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

export const ENGINE_TOOLS: Record<EngineToolName, EngineToolDef> = {
  get_today_plan: {
    name: 'get_today_plan',
    readOnly: true,
    description:
      'Read the session the engine has already prescribed for a date: type, blocks, exercises, prescribed sets, the readiness assessment, and the engine’s own "why". Call this before answering any question about what Seth is doing. Never describe a workout you have not read from this tool.',
    parameters: obj({
      date: isoDate,
      include_week: {
        type: 'boolean',
        description: 'Also return the next six projected days.',
      },
    }),
  },

  swap_exercise: {
    name: 'swap_exercise',
    readOnly: false,
    description:
      'Ask the engine for a substitute for one prescribed exercise. You choose the DIRECTION only (easier, same, harder) and optionally a reason; the engine ranks the candidates, picks the movement, and re-derives its sets, reps and load. You may not name the replacement’s prescription. Returns the new prescribed exercise.',
    parameters: obj(
      {
        date: isoDate,
        exercise_id: {
          type: 'string',
          description: 'The prescribed exercise to replace, as returned by get_today_plan.',
        },
        direction: {
          type: 'string',
          enum: ['easier', 'same', 'harder'],
          description: 'Relative difficulty of the substitute.',
        },
        reason: {
          type: 'string',
          description:
            'Why, in Seth’s words — "no cable machine", "knee is cranky". Recorded and used as a constraint.',
        },
        preferred_exercise_id: {
          type: 'string',
          description:
            'A specific substitute Seth ASKED FOR by name. The engine still validates it against equipment, the regional load ledger and pairing exclusions, and may refuse it.',
        },
      },
      ['exercise_id', 'direction'],
    ),
  },

  set_budget_minutes: {
    name: 'set_budget_minutes',
    readOnly: false,
    description:
      'Tell the engine how many minutes Seth actually has, and get the re-planned session back. This changes an INPUT; the engine decides what fits. Use it for "only have 20", "I’ve got an hour".',
    parameters: obj(
      {
        date: isoDate,
        minutes: {
          type: 'integer',
          minimum: 5,
          maximum: 180,
          description: 'Minutes available, excluding warm-up when it sits outside the budget.',
        },
      },
      ['minutes'],
    ),
  },

  set_location: {
    name: 'set_location',
    readOnly: false,
    description:
      'Change where today’s session happens and re-plan against that location’s real equipment. Planet Fitness has no barbells or racks, so this can materially change the session.',
    parameters: obj(
      {
        date: isoDate,
        location_id: {
          type: 'string',
          description: 'A location id from the athlete’s configured locations.',
        },
        location_hint: {
          type: 'string',
          description:
            'Used only when no id is known: "home", "gym", "outside". The engine resolves it.',
        },
      },
      [],
    ),
  },

  log_set: {
    name: 'log_set',
    readOnly: false,
    description:
      'Record a set Seth ACTUALLY DID. This is observation, not prescription. Load is TOTAL pounds (both dumbbells summed, bar included). Only log numbers Seth stated or that came from a parsed photo — never infer what he "probably" lifted.',
    parameters: obj(
      {
        date: isoDate,
        exercise_id: { type: 'string', description: 'Exercise id from get_today_plan.' },
        set_index: { type: 'integer', minimum: 1, description: 'Which set, 1-based.' },
        reps: { type: 'integer', minimum: 0, maximum: 200 },
        load_lb: {
          type: 'number',
          minimum: 0,
          description: 'TOTAL load in pounds. Dumbbell pairs sum both hands; barbells include the bar.',
        },
        rpe: { type: 'integer', minimum: 1, maximum: 10, description: 'Borg CR10, if stated.' },
        completed: { type: 'boolean', description: 'False when the set was cut short.' },
      },
      ['exercise_id', 'set_index', 'reps'],
    ),
  },

  log_external_session: {
    name: 'log_external_session',
    readOnly: false,
    description:
      'Log training done outside the app — a CrossFit class, a pickup game, a run not on Strava. Feeds the regional load ledger and the weekly dose. Duration in MINUTES, distance in MILES. If a field is genuinely unknown, omit it; do not guess.',
    parameters: obj(
      {
        date: isoDate,
        kind: {
          type: 'string',
          enum: ['class', 'run', 'walk', 'ruck', 'bike', 'row', 'swim', 'sport', 'other'],
        },
        duration_min: { type: 'integer', minimum: 1, maximum: 600 },
        intensity: { type: 'string', enum: ['easy', 'moderate', 'hard'] },
        distance_mi: { type: 'number', minimum: 0, description: 'Miles, never kilometres.' },
        avg_hr: { type: 'integer', minimum: 30, maximum: 240 },
        rpe: { type: 'integer', minimum: 1, maximum: 10 },
        note: { type: 'string', description: 'Seth’s description, or the parsed whiteboard text.' },
      },
      ['kind', 'duration_min'],
    ),
  },

  log_body_metric: {
    name: 'log_body_metric',
    readOnly: false,
    description:
      'Record bodyweight and optionally body-fat percentage. Pounds only. Bodyweight drives every %BW program standard, so log ONLY a number Seth stated or that was read off a scale photo — never an estimate.',
    parameters: obj(
      {
        date: isoDate,
        weight_lb: { type: 'number', minimum: 50, maximum: 600 },
        body_fat_pct: { type: 'number', minimum: 3, maximum: 60 },
        source: { type: 'string', enum: ['manual', 'scale_photo'] },
      },
      ['weight_lb'],
    ),
  },

  set_injury_pain: {
    name: 'set_injury_pain',
    readOnly: false,
    description:
      'Record a pain score 0–10 for an existing injury, or open a new one for a region. The engine decides what that means for today’s session — a rise of 2 or more points regresses the program step. Do not offer medical advice or tell Seth whether to train; report what the engine decided.',
    parameters: obj(
      {
        date: isoDate,
        injury_id: { type: 'string', description: 'Existing injury id, when one matches.' },
        region: {
          type: 'string',
          enum: [
            'knees_quads',
            'posterior_chain',
            'low_back',
            'shoulders',
            'elbows_forearms',
            'calves_achilles',
            'spine',
            'chest',
            'upper_back',
            'core',
            'hips_glutes',
            'neck',
          ],
          description: 'Required when opening a new injury.',
        },
        pain: { type: 'integer', minimum: 0, maximum: 10, description: '0 none, 10 worst.' },
        note: { type: 'string' },
      },
      ['pain'],
    ),
  },

  skip_today: {
    name: 'skip_today',
    readOnly: false,
    description:
      'Mark today skipped. The engine absorbs it into the week — it re-plans tomorrow rather than stacking the missed work. Do not talk Seth out of it and do not negotiate; log it and say what the week now looks like.',
    parameters: obj(
      {
        date: isoDate,
        reason: { type: 'string', description: 'Seth’s reason, if he gave one.' },
      },
      [],
    ),
  },

  explain_exercise: {
    name: 'explain_exercise',
    readOnly: true,
    description:
      'Fetch the stored cue, instructions, pattern, equipment and media for one exercise so you can explain HOW to do it. This returns library content; use it verbatim in substance. It does not return and must not produce a prescription.',
    parameters: obj(
      {
        exercise_id: { type: 'string' },
        exercise_name: { type: 'string', description: 'Used when no id is known.' },
      },
      [],
    ),
  },
};

/** Array form, for iteration. */
export const ENGINE_TOOL_LIST: EngineToolDef[] = ENGINE_TOOL_NAMES.map((n) => ENGINE_TOOLS[n]);

// ─────────────────────────────────────────────────────────────────────────────
// Argument types
// ─────────────────────────────────────────────────────────────────────────────

export interface GetTodayPlanArgs {
  date?: string;
  include_week?: boolean;
}
export interface SwapExerciseArgs {
  date?: string;
  exercise_id: string;
  direction: 'easier' | 'same' | 'harder';
  reason?: string;
  preferred_exercise_id?: string;
}
export interface SetBudgetMinutesArgs {
  date?: string;
  minutes: number;
}
export interface SetLocationArgs {
  date?: string;
  location_id?: string;
  location_hint?: 'home' | 'gym' | 'outside' | string;
}
export interface LogSetArgs {
  date?: string;
  exercise_id: string;
  set_index: number;
  reps: number;
  load_lb?: number;
  rpe?: number;
  completed?: boolean;
}
export interface LogExternalSessionArgs {
  date?: string;
  kind: 'class' | 'run' | 'walk' | 'ruck' | 'bike' | 'row' | 'swim' | 'sport' | 'other';
  duration_min: number;
  intensity?: 'easy' | 'moderate' | 'hard';
  distance_mi?: number;
  avg_hr?: number;
  rpe?: number;
  note?: string;
}
export interface LogBodyMetricArgs {
  date?: string;
  weight_lb: number;
  body_fat_pct?: number;
  source?: 'manual' | 'scale_photo';
}
export interface SetInjuryPainArgs {
  date?: string;
  injury_id?: string;
  region?: string;
  pain: number;
  note?: string;
}
export interface SkipTodayArgs {
  date?: string;
  reason?: string;
}
export interface ExplainExerciseArgs {
  exercise_id?: string;
  exercise_name?: string;
}

/** Tool name → its argument type. */
export interface EngineToolArgsMap {
  get_today_plan: GetTodayPlanArgs;
  swap_exercise: SwapExerciseArgs;
  set_budget_minutes: SetBudgetMinutesArgs;
  set_location: SetLocationArgs;
  log_set: LogSetArgs;
  log_external_session: LogExternalSessionArgs;
  log_body_metric: LogBodyMetricArgs;
  set_injury_pain: SetInjuryPainArgs;
  skip_today: SkipTodayArgs;
  explain_exercise: ExplainExerciseArgs;
}

/** A validated tool call, ready for the engine dispatcher. */
export type EngineToolCall = {
  [K in EngineToolName]: { name: K; args: EngineToolArgsMap[K] };
}[EngineToolName];

// ─────────────────────────────────────────────────────────────────────────────
// Provider dialects
// ─────────────────────────────────────────────────────────────────────────────

/** OpenAI / LM Studio `tools[]`. */
export function toOpenAiTools(
  tools: EngineToolDef[] = ENGINE_TOOL_LIST,
): { type: 'function'; function: { name: string; description: string; parameters: JsonSchema } }[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Gemini `functionDeclarations[]`. Gemini rejects `additionalProperties`, so it
 * is stripped — the runtime validation in `validateToolCall` still enforces it.
 */
export function toGeminiTools(
  tools: EngineToolDef[] = ENGINE_TOOL_LIST,
): [{ functionDeclarations: { name: string; description: string; parameters: JsonSchema }[] }] {
  const strip = (s: JsonSchema): JsonSchema => {
    const { additionalProperties: _drop, ...rest } = s;
    void _drop;
    const out: JsonSchema = { ...rest };
    if (rest.properties) {
      out.properties = Object.fromEntries(
        Object.entries(rest.properties).map(([k, v]) => [k, strip(v)]),
      );
    }
    if (rest.items) out.items = strip(rest.items);
    return out;
  };
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: strip(t.parameters),
      })),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check a model-emitted tool call against its schema BEFORE it reaches the
 * engine. This is the enforcement half of invariant 1: an unknown tool, a
 * missing required argument or a hallucinated extra key is rejected outright
 * rather than being passed through and half-understood.
 *
 * Returns the typed call, or an error string suitable for feeding back to the
 * model as a tool error so it can correct itself.
 */
export function validateToolCall(
  name: string,
  args: unknown,
): { ok: true; call: EngineToolCall } | { ok: false; error: string } {
  const def = (ENGINE_TOOLS as Record<string, EngineToolDef | undefined>)[name];
  if (!def) {
    return { ok: false, error: `unknown tool "${name}"; available: ${ENGINE_TOOL_NAMES.join(', ')}` };
  }
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    return { ok: false, error: `arguments for ${name} must be an object` };
  }
  const a = (args ?? {}) as Record<string, unknown>;
  const props = def.parameters.properties ?? {};

  for (const req of def.parameters.required ?? []) {
    if (a[req] === undefined || a[req] === null) {
      return { ok: false, error: `${name}: missing required argument "${req}"` };
    }
  }
  for (const key of Object.keys(a)) {
    if (!props[key]) {
      return { ok: false, error: `${name}: unexpected argument "${key}"` };
    }
    const problem = checkType(props[key] as JsonSchema, a[key], `${name}.${key}`);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true, call: { name: name as EngineToolName, args: a } as EngineToolCall };
}

/** Type, enum and range check for one argument. Returns a message or null. */
function checkType(schema: JsonSchema, value: unknown, path: string): string | null {
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return `${path} must be a string`;
      if (schema.enum && !schema.enum.includes(value)) {
        return `${path} must be one of: ${schema.enum.join(', ')}`;
      }
      return null;
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a number`;
      if (schema.type === 'integer' && !Number.isInteger(value)) return `${path} must be an integer`;
      if (schema.minimum !== undefined && value < schema.minimum) {
        return `${path} must be at least ${schema.minimum}`;
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return `${path} must be at most ${schema.maximum}`;
      }
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path} must be a boolean`;
    case 'array':
      return Array.isArray(value) ? null : `${path} must be an array`;
    case 'object':
      return typeof value === 'object' && value !== null ? null : `${path} must be an object`;
    default:
      return null;
  }
}

/**
 * The invariant, as a string, so it can be pasted into every system prompt that
 * exposes these tools. `prompts.ts` uses it verbatim.
 */
export const INVARIANT_1_STATEMENT =
  'The deterministic rules engine owns every prescription. You may call these tools to read engine output or to change an input so the engine re-plans, and you may explain what it decided — but you must never invent, adjust or state a set, rep, load, zone, duration or exercise choice that did not come from the engine.';
