/**
 * Rules-first intent routing (RESEARCH_FOUNDATION §8, PRD §8.8).
 *
 * "Chat routing: intent classifier (rules first: 'swap', 'skip', '20 min',
 *  'home', pain words) → deterministic action; otherwise LLM with tool schema."
 *
 * Why rules first, and why it matters more than it looks:
 *   - **Speed.** A regex answers in microseconds. An LM Studio round trip on a
 *     sleeping Mac mini is seconds, or never.
 *   - **Determinism.** "skip" must skip. Every time. Not "usually".
 *   - **Free.** Every message the rules catch is a Gemini call not made, which
 *     is how a chatty day stays inside a free tier.
 *   - **Offline.** The mini being down cannot stop Seth logging a workout.
 *
 * `routeMessage` returns `null` when nothing matched — that, and only that, is
 * when the caller enqueues an LLM job. It NEVER guesses: an ambiguous message
 * falls through to the LLM rather than firing the wrong deterministic action.
 *
 * Pure: no I/O, no clock reads beyond what the caller passes in.
 */

/** Everything the rules layer can resolve without a model. */
export type RoutedIntent =
  | { kind: 'start'; confidence: number; raw: string }
  | { kind: 'skip'; confidence: number; raw: string; reason?: string }
  | { kind: 'set_budget'; minutes: number; confidence: number; raw: string }
  | { kind: 'set_location'; location: 'home' | 'gym' | 'outside'; confidence: number; raw: string }
  | { kind: 'swap'; confidence: number; raw: string; exercise?: string; direction?: 'easier' | 'same' | 'harder' }
  | { kind: 'log_external'; confidence: number; raw: string; minutes?: number; intensity?: 'easy' | 'moderate' | 'hard'; label?: string }
  | { kind: 'report_pain'; confidence: number; raw: string; region?: string; pain?: number }
  | { kind: 'log_weight'; weight_lb: number; body_fat_pct?: number; confidence: number; raw: string }
  | { kind: 'show_plan'; confidence: number; raw: string }
  | { kind: 'show_week'; confidence: number; raw: string }
  | { kind: 'help'; confidence: number; raw: string };

export type RoutedIntentKind = RoutedIntent['kind'];

/**
 * Body regions we can name from plain words, mapped onto the engine's `Region`
 * vocabulary. Deliberately conservative — the LLM handles anything vaguer.
 */
const PAIN_REGION_WORDS: [RegExp, string][] = [
  [/\b(knee|knees|patella|kneecap)\b/, 'knees_quads'],
  [/\b(quad|quads|thigh)\b/, 'knees_quads'],
  [/\b(hamstring|hammy|hammies|glute|glutes|posterior chain)\b/, 'posterior_chain'],
  [/\b(low ?back|lower ?back|lumbar)\b/, 'low_back'],
  [/\b(back)\b/, 'low_back'],
  [/\b(shoulder|shoulders|delt|delts|rotator ?cuff|ac joint)\b/, 'shoulders'],
  [/\b(elbow|elbows|forearm|forearms|wrist|wrists|tennis elbow|golfer'?s elbow)\b/, 'elbows_forearms'],
  [/\b(calf|calves|achilles|soleus)\b/, 'calves_achilles'],
  [/\b(spine|neck|trap|traps)\b/, 'neck'],
  [/\b(hip|hips|hip ?flexor|groin)\b/, 'hips_glutes'],
  [/\b(chest|pec|pecs|sternum)\b/, 'chest'],
  [/\b(upper ?back|lat|lats|rhomboid)\b/, 'upper_back'],
  [/\b(abs|core|oblique|obliques)\b/, 'core'],
  [/\b(ankle|foot|feet|plantar|shin|tibialis|tib)\b/, 'calves_achilles'],
];

/** Words that mean "something hurts". */
const PAIN_WORDS =
  /\b(pain|painful|hurts?|hurting|sore(?:ness)?|ache|aching|achy|tweak(?:ed|ing)?|strain(?:ed)?|sprain(?:ed)?|pull(?:ed)? (?:a|my)|flare(?:d|-?up)?|stiff|stiffness|inflamed|throbbing|sharp|twinge|niggle|injur(?:y|ed)|pinch(?:ed|ing)?)\b/i;

/** Words that mean "I did something outside the app". */
const EXTERNAL_SESSION =
  /\b(class|crossfit|wod|bootcamp|pickup|pick-?up|game|practice|yoga|pilates|spin|orange ?theory|f45|barre|hike|hiked|hiking|played|swam|swim|pickleball|basketball|soccer|tennis|jiu ?jitsu|bjj|climb(?:ed|ing)?)\b/i;

/** Easy / moderate / hard, from the words people actually use. */
const INTENSITY_WORDS: [RegExp, 'easy' | 'moderate' | 'hard'][] = [
  [/\b(brutal|crush(?:ed|ing)|smoked|destroyed|savage|killer|very hard|really hard|hard|max(?:ed)?(?: out)?|redlin\w+|all ?out)\b/i, 'hard'],
  [/\b(moderate|medium|solid|decent|steady|normal|fine)\b/i, 'moderate'],
  [/\b(easy|light|chill|recovery|gentle|slow|cruisy|zone ?[12])\b/i, 'easy'],
];

/**
 * Route a free-text Telegram message to a deterministic intent.
 *
 * Returns `null` when no rule is confident, which is the caller's signal to
 * enqueue an LLM job. Order matters: the most specific and least reversible
 * patterns are tested first, and pain always beats everything else because a
 * message about pain must never be misread as a swap request.
 */
export function routeMessage(text: string): RoutedIntent | null {
  const raw = (text ?? '').trim();
  if (raw.length === 0 || raw.length > 600) return null;
  const s = raw.toLowerCase();

  // Slash commands — unambiguous by construction.
  const slash = matchSlashCommand(s, raw);
  if (slash) return slash;

  // ── 1. Pain. Highest priority: never misroute a health signal. ────────────
  if (PAIN_WORDS.test(s)) {
    const region = matchRegion(s);
    const pain = matchPainScore(s);
    return {
      kind: 'report_pain',
      confidence: region ? 0.9 : 0.6,
      raw,
      ...(region ? { region } : {}),
      ...(pain !== undefined ? { pain } : {}),
    };
  }

  // ── 2. Bodyweight / body fat. A bare number in a weight-shaped message. ───
  const weight = matchWeight(s);
  if (weight) return { ...weight, raw };

  // ── 3. Skip. Checked before "start" so "not today" is not read as "today". ─
  if (
    /\b(skip|rest day|take (?:the |a )?(?:day|today) off|day off|not today|nothing today|can'?t (?:today|make it)|no workout|bail|pass today|off day)\b/.test(
      s,
    )
  ) {
    return { kind: 'skip', confidence: 0.9, raw, ...(reasonAfter(s) ? { reason: reasonAfter(s) as string } : {}) };
  }

  // ── 4. External session: "did a class, hard, 60 min". ─────────────────────
  // Ahead of the budget rule on purpose: "did a class, hard, 60 min" states a
  // duration that ALREADY HAPPENED, not a budget for work still to come.
  if (EXTERNAL_SESSION.test(s)) {
    const minutes = matchDurationMinutes(s);
    const intensity = matchIntensity(s);
    const label = matchSessionLabel(s);
    return {
      kind: 'log_external',
      confidence: minutes !== undefined || intensity ? 0.85 : 0.65,
      raw,
      ...(minutes !== undefined ? { minutes } : {}),
      ...(intensity ? { intensity } : {}),
      ...(label ? { label } : {}),
    };
  }

  // ── 5. Time budget: "20 min", "I have 30", "only 15 minutes". ─────────────
  const budget = matchBudget(s);
  if (budget !== undefined) return { kind: 'set_budget', minutes: budget, confidence: 0.85, raw };

  // ── 6. Location. ──────────────────────────────────────────────────────────
  const location = matchLocation(s);
  if (location) return { kind: 'set_location', location, confidence: 0.85, raw };

  // ── 7. Swap. ──────────────────────────────────────────────────────────────
  if (/\b(swap|sub|substitute|switch|replace|change|different|another|alternative)\b/.test(s)) {
    const direction = /\b(easier|lighter|regress|easy version|too hard)\b/.test(s)
      ? ('easier' as const)
      : /\b(harder|heavier|progress|tougher|too easy)\b/.test(s)
        ? ('harder' as const)
        : undefined;
    const exercise = matchExercisePhrase(s);
    return {
      kind: 'swap',
      confidence: 0.8,
      raw,
      ...(exercise ? { exercise } : {}),
      ...(direction ? { direction } : {}),
    };
  }

  // ── 8. Start. ─────────────────────────────────────────────────────────────
  if (/^(start|go|lets? go|let'?s go|begin|ready|on my way|heading (?:in|out|to the gym)|i'?m in|do it)\b/.test(s)) {
    return { kind: 'start', confidence: 0.85, raw };
  }

  // ── 9. Show me the plan. ──────────────────────────────────────────────────
  if (/\b(what'?s (?:today|the plan|on)|today'?s (?:plan|workout|session)|plan for today|what am i doing)\b/.test(s)) {
    return { kind: 'show_plan', confidence: 0.85, raw };
  }
  if (/\b(this week|the week|weekly plan|week ahead|rest of the week)\b/.test(s)) {
    return { kind: 'show_week', confidence: 0.8, raw };
  }

  // Nothing matched. The LLM takes it from here.
  return null;
}

/** True when `routeMessage` would hand this message to the LLM. */
export function needsLlm(text: string): boolean {
  return routeMessage(text) === null;
}

// ─────────────────────────────────────────────────────────────────────────────
// matchers
// ─────────────────────────────────────────────────────────────────────────────

/** `/start`, `/today`, `/skip`, `/week`, `/help`. */
function matchSlashCommand(s: string, raw: string): RoutedIntent | null {
  const m = /^\/(\w+)/.exec(s);
  if (!m) return null;
  switch (m[1]) {
    case 'start':
    case 'go':
      return { kind: 'start', confidence: 1, raw };
    case 'today':
    case 'plan':
      return { kind: 'show_plan', confidence: 1, raw };
    case 'week':
      return { kind: 'show_week', confidence: 1, raw };
    case 'skip':
      return { kind: 'skip', confidence: 1, raw };
    case 'swap':
      return { kind: 'swap', confidence: 1, raw };
    case 'help':
    case 'commands':
      return { kind: 'help', confidence: 1, raw };
    default:
      return null;
  }
}

/**
 * A time budget in minutes. Accepts "20 min", "20m", "I have 30", "half hour",
 * "an hour", "only 15". Rejects numbers that are clearly something else — a
 * bodyweight, a pain score, a rep count.
 */
export function matchBudget(s: string): number | undefined {
  if (/\bhalf (?:an )?hour\b/.test(s)) return 30;
  if (/\b(?:an|1) hour\b/.test(s)) return 60;
  if (/\b(?:an )?hour and a half\b/.test(s)) return 90;
  if (/\bquarter hour\b/.test(s)) return 15;

  // Explicit unit: the safest signal.
  const explicit = /\b(\d{1,3})\s*(?:min(?:ute)?s?|mins?|m)\b/.exec(s);
  if (explicit?.[1]) {
    const n = Number(explicit[1]);
    if (n >= 5 && n <= 180) return n;
  }
  // "2 hours" / "1.5 hrs"
  const hours = /\b(\d(?:\.\d)?)\s*(?:hours?|hrs?|h)\b/.exec(s);
  if (hours?.[1]) {
    const n = Math.round(Number(hours[1]) * 60);
    if (n >= 5 && n <= 180) return n;
  }
  // Bare number, but only with a phrase that makes it a duration.
  const bare = /\b(?:i(?:'ve| have)?(?: only)?(?: got)?|only|just|maybe|about|around|got)\s+(\d{1,3})\b/.exec(s);
  if (bare?.[1] && /\b(today|now|to work with|available|free)\b/.test(s)) {
    const n = Number(bare[1]);
    if (n >= 5 && n <= 180) return n;
  }
  return undefined;
}

/** Home / gym / outside. */
export function matchLocation(s: string): 'home' | 'gym' | 'outside' | undefined {
  if (/\b(at home|home instead|from home|stay(?:ing)? (?:in|home)|garage|basement|hotel(?: room)?|travel(?:ing|ling)?)\b/.test(s)) {
    return 'home';
  }
  if (/\b(gym|planet fitness|pf|the club|commercial gym|going in)\b/.test(s)) return 'gym';
  if (/\b(outside|outdoors|park|trail|track|street|neighborhood|neighbourhood)\b/.test(s)) {
    return 'outside';
  }
  return undefined;
}

/** A named body region, from the plain-English word Seth would use. */
export function matchRegion(s: string): string | undefined {
  for (const [re, region] of PAIN_REGION_WORDS) {
    if (re.test(s)) return region;
  }
  return undefined;
}

/** Pain expressed as "6/10", "a 6", "pain is 7". Returns 0–10 only. */
export function matchPainScore(s: string): number | undefined {
  const outOfTen = /\b(\d{1,2})\s*(?:\/|out of)\s*10\b/.exec(s);
  if (outOfTen?.[1]) {
    const n = Number(outOfTen[1]);
    if (n >= 0 && n <= 10) return n;
  }
  const named = /\b(?:pain|hurts?|it'?s)\s*(?:is|at|about|around)?\s*(?:a\s*)?(\d{1,2})\b/.exec(s);
  if (named?.[1]) {
    const n = Number(named[1]);
    if (n >= 0 && n <= 10) return n;
  }
  return undefined;
}

/**
 * A bodyweight, and optionally a body-fat percentage.
 *
 * Requires either an explicit unit ("187 lb") or a weight word ("weight 187",
 * "weighed in at 187"). A bare "187" is NOT treated as a weight — it could be
 * a load, a rep target, or a typo, and a wrong body metric poisons every %BW
 * standard in the KOT program.
 */
export function matchWeight(
  s: string,
): { kind: 'log_weight'; weight_lb: number; body_fat_pct?: number; confidence: number } | null {
  const bf = /\b(\d{1,2}(?:\.\d)?)\s*%\s*(?:body ?fat|bf|fat)?\b/.exec(s);
  const bfAlt = /\b(?:body ?fat|bf)\D{0,8}(\d{1,2}(?:\.\d)?)\b/.exec(s);
  const bodyFat = bf?.[1] ?? bfAlt?.[1];

  const withUnit = /\b(\d{2,3}(?:\.\d)?)\s*(?:lbs?|pounds?)\b/.exec(s);
  const withWord = /\b(?:weigh(?:t|ed|s|-?in)?|scale|i am|i'?m)\D{0,12}(\d{2,3}(?:\.\d)?)\b/.exec(s);
  const candidate = withUnit?.[1] ?? withWord?.[1];
  if (!candidate) return null;

  const w = Number(candidate);
  // A human bodyweight, not a dumbbell and not a typo.
  if (!(w >= 80 && w <= 400)) return null;

  const pct = bodyFat !== undefined ? Number(bodyFat) : undefined;
  return {
    kind: 'log_weight',
    weight_lb: w,
    ...(pct !== undefined && pct >= 3 && pct <= 60 ? { body_fat_pct: pct } : {}),
    confidence: withUnit ? 0.9 : 0.75,
  };
}

/** Duration anywhere in a sentence, for external-session logging. */
export function matchDurationMinutes(s: string): number | undefined {
  const explicit = /\b(\d{1,3})\s*(?:min(?:ute)?s?|mins?)\b/.exec(s);
  if (explicit?.[1]) {
    const n = Number(explicit[1]);
    if (n >= 5 && n <= 300) return n;
  }
  const hours = /\b(\d(?:\.\d)?)\s*(?:hours?|hrs?)\b/.exec(s);
  if (hours?.[1]) {
    const n = Math.round(Number(hours[1]) * 60);
    if (n >= 5 && n <= 300) return n;
  }
  if (/\bhalf (?:an )?hour\b/.test(s)) return 30;
  if (/\b(?:an|1) hour\b/.test(s)) return 60;
  return undefined;
}

/** Easy / moderate / hard from the words used. */
export function matchIntensity(s: string): 'easy' | 'moderate' | 'hard' | undefined {
  for (const [re, level] of INTENSITY_WORDS) {
    if (re.test(s)) return level;
  }
  return undefined;
}

/** The named activity in an external-session message, e.g. "crossfit". */
function matchSessionLabel(s: string): string | undefined {
  const m = EXTERNAL_SESSION.exec(s);
  return m?.[0];
}

/** The exercise named in a swap request: "swap the bulgarian split squats". */
function matchExercisePhrase(s: string): string | undefined {
  const m =
    /\b(?:swap|sub(?:stitute)?|switch|replace|change)\s+(?:out\s+)?(?:the\s+|my\s+)?([a-z][a-z\s-]{2,40}?)(?:\s+(?:for|with|to|please)\b|[.,!?]|$)/.exec(
      s,
    );
  const phrase = m?.[1]?.trim();
  if (!phrase) return undefined;
  // Strip trailing filler that is not part of an exercise name.
  const cleaned = phrase.replace(/\b(it|this|that|one|today|exercise|movement|lift)\b\s*$/, '').trim();
  return cleaned.length >= 3 ? cleaned : undefined;
}

/** Text after "because" / "—", used as the skip reason. */
function reasonAfter(s: string): string | undefined {
  const m = /\b(?:because|cause|cuz|since|—|--)\s+(.{3,120})$/.exec(s);
  return m?.[1]?.trim();
}
