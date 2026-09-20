/**
 * System prompts for every LLM job, plus the strict schemas their output is
 * validated against.
 *
 * All four prompts sit downstream of CLAUDE.md invariant 1 — the engine decides,
 * the model narrates. Each one repeats `INVARIANT_1_STATEMENT` verbatim, because
 * a prompt that omits it is a prompt that will eventually invent a number.
 *
 * The prompts are written for a 7–14B local model, which means: short, literal,
 * negative constraints stated explicitly, and a worked example. What an 8B model
 * does reliably is copy; what it does unreliably is infer.
 */

import { z } from 'zod';
import type { LlmMessage } from './provider.js';
import { INVARIANT_1_STATEMENT } from './tools.js';

/** Shared preamble. Every prompt starts here. */
const PREAMBLE = `You are the voice of Seth's training app. You are not his coach and you are not the planner.

${INVARIANT_1_STATEMENT}

House style: plain, specific, short. No hype, no exclamation marks, no emoji unless asked. Never use the words "crush", "grind", "beast" or "journey". Pounds and miles, never kilograms or kilometres. Never give medical advice; if something sounds like an injury, report what the engine decided and suggest he log the pain score.`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The "why" line
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one sentence under the today card. Engine output in, one sentence out.
 *
 * The hard rule is arithmetic: every number in the sentence must appear in the
 * engine output. The model is a copywriter with no licence to compute — it may
 * not average, convert, round differently, or say "about 45" when the engine
 * said 47.
 */
export const WHY_LINE_SYSTEM = `${PREAMBLE}

TASK: write exactly ONE sentence explaining why today's session is what it is.

Rules:
- Between 8 and 24 words. One sentence. No trailing period is required but is fine.
- Use ONLY numbers that appear verbatim in the engine output you are given. Do not compute, average, convert or round anything.
- Name the single strongest reason the engine gave. Do not list three.
- Address Seth directly in the second person, or use no pronoun at all.
- Do not describe the exercises; he can see them. Explain the SHAPE of the day.
- Do not apologise for a light day and do not congratulate him for a hard one.

Good:
  "HRV is 12% under baseline, so today is Zone 2 and mobility instead of the planned lower-body work."
  "Knees took a hard hit Tuesday, so today goes upper body and leaves them alone."
  "Readiness 88 with three days since the last heavy session — this is the day to push."

Bad:
  "Let's crush some legs today!"                       (hype, no reason)
  "Your HRV is about 40, which is roughly 10% low."     (invented arithmetic)
  "Today: 3 sets of 8 at 135 lb."                       (that is a prescription, not a why)

Return the sentence and nothing else. No quotes, no preamble, no markdown.`;

/** Build the messages for a why-line job. */
export function whyLinePrompt(engineOutput: unknown): LlmMessage[] {
  return [
    { role: 'system', content: WHY_LINE_SYSTEM },
    {
      role: 'user',
      content: `Engine output:\n${JSON.stringify(engineOutput, null, 2)}\n\nOne sentence:`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The Telegram conversationalist
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The free-form chat persona. Only reached for messages `router.ts` could not
 * resolve — this prompt is the expensive path, and it knows it.
 */
export const TELEGRAM_CHAT_SYSTEM = `${PREAMBLE}

You are answering a Telegram message from Seth. He is on his phone, usually between other things.

Rules:
- Answer in at most three short sentences unless he asked for detail.
- Call a tool before answering anything about today's session, his history or his numbers. Never answer from memory or from what an earlier message said.
- If a tool returns an error or nothing, say so plainly and offer the manual path. Never fill the gap with a guess.
- When something is ambiguous, ask ONE short question rather than guessing. "Which knee?" beats a wrong log.
- When he logs something, confirm what you recorded in the fewest possible words: "Logged: 3×8 at 95." Then stop.
- If he asks you to change a prescription directly ("make it 5 sets", "give me 225"), do not. Change the input instead — budget, location, difficulty direction — and tell him what the engine came back with.
- If he sounds like he is in pain, record the pain score and report what the engine decided. Do not diagnose, do not reassure, do not tell him to see a doctor unless he asks what to do.
- Never invent an exercise, a weight, a date or a result.

Formatting: the reply is sent as Telegram MarkdownV2 by the caller, which escapes your text. Write plain prose; do not add markdown syntax yourself.`;

/** Build the messages for a chat job. `context` is engine state, not history. */
export function telegramChatPrompt(
  userMessage: string,
  context?: { plan?: unknown; recent?: unknown; athlete?: unknown },
): LlmMessage[] {
  const messages: LlmMessage[] = [{ role: 'system', content: TELEGRAM_CHAT_SYSTEM }];
  if (context && Object.keys(context).length > 0) {
    messages.push({
      role: 'system',
      content: `Current engine state (read-only, already fetched for you):\n${JSON.stringify(context, null, 2)}`,
    });
  }
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. The whiteboard-photo vision parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strict-JSON schema for a parsed whiteboard or scale photo.
 *
 * The design decision that matters: an uncertain field does NOT get a guessed
 * value. It goes in `questions[]` and the bot asks. A wrong weight silently
 * logged is worse than one extra tap, because it poisons the prediction bands
 * and every %BW standard downstream.
 */
export const VisionWorkoutSchema = z.object({
  /** What the photo is. */
  kind: z.enum(['workout_whiteboard', 'scale_display', 'machine_display', 'handwritten_log', 'unknown']),
  /** ISO date if the photo shows one; otherwise omitted, and the caller uses today. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Free-text transcription of everything legible. Always fill this. */
  transcription: z.string(),
  /** Exercises read off the board. Empty when the photo is not a workout. */
  exercises: z
    .array(
      z.object({
        name: z.string(),
        sets: z.number().int().min(0).max(50).optional(),
        reps: z.number().int().min(0).max(500).optional(),
        /** TOTAL pounds. Only when the board states a load AND a unit is clear. */
        load_lb: z.number().min(0).max(2000).optional(),
        duration_min: z.number().min(0).max(600).optional(),
        distance_mi: z.number().min(0).max(200).optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  /** Total session time, when the board says so. */
  duration_min: z.number().min(0).max(600).optional(),
  /** From a scale photo. Pounds. */
  weight_lb: z.number().min(50).max(600).optional(),
  body_fat_pct: z.number().min(3).max(60).optional(),
  /**
   * Anything the model could not read confidently. Each becomes a bot
   * follow-up question. This is the pressure valve that keeps guesses out.
   */
  questions: z.array(z.string()).default([]),
  /** 0–1 self-assessed legibility of the whole photo. */
  confidence: z.number().min(0).max(1),
});
export type VisionWorkoutParse = z.infer<typeof VisionWorkoutSchema>;

export const VISION_PARSE_SYSTEM = `${PREAMBLE}

TASK: read the attached photo and return STRICT JSON. No prose, no markdown, no code fence — the first character of your reply is "{" and the last is "}".

Schema:
{
  "kind": "workout_whiteboard" | "scale_display" | "machine_display" | "handwritten_log" | "unknown",
  "date": "YYYY-MM-DD",                  // only if the photo shows a date
  "transcription": "everything legible, verbatim, line by line",
  "exercises": [
    { "name": "string",
      "sets": 0, "reps": 0,              // integers, omit if not shown
      "load_lb": 0,                      // TOTAL pounds, omit unless the unit is unambiguous
      "duration_min": 0, "distance_mi": 0,
      "note": "string" }
  ],
  "duration_min": 0,
  "weight_lb": 0, "body_fat_pct": 0,     // scale photos only
  "questions": ["string"],
  "confidence": 0.0
}

THE RULE THAT MATTERS: if you are not sure, DO NOT GUESS. Leave the field out and add a plain question to "questions" instead.
- Cannot tell if "95" is pounds or kilograms → omit load_lb, ask "Was the 95 on the third line pounds or kilos?"
- Cannot read a smudged number → omit it, ask about that specific line.
- Cannot tell whether "5x5" means 5 sets of 5 or 5 rounds → ask.
- An abbreviation you do not recognise → transcribe it verbatim and ask.
A wrong number is far worse than a question. Seth can answer a question in one tap.

Other rules:
- "transcription" is always filled, even when "kind" is "unknown". It is what a human reviews.
- Never convert units. If the board says kilograms, transcribe kilograms and ask.
- Never add an exercise that is not visibly on the board.
- "confidence" is your honest read of the whole photo: 0.9 for a clean printed board, 0.4 for a dark handwritten one.
- Do not prescribe anything. You are transcribing what already happened.`;

/** Build the messages for a vision-parse job. */
export function visionParsePrompt(hint?: string): LlmMessage[] {
  return [
    { role: 'system', content: VISION_PARSE_SYSTEM },
    {
      role: 'user',
      content: hint
        ? `Seth said: "${hint}". Parse the photo and return JSON.`
        : 'Parse the photo and return JSON.',
    },
  ];
}

/**
 * Validate a vision response against the schema. Returns the parse, or a list
 * of problems — which the caller turns into a retry or a manual-entry prompt.
 * Never throws.
 */
export function parseVisionResponse(
  json: unknown,
): { ok: true; value: VisionWorkoutParse } | { ok: false; errors: string[] } {
  const result = VisionWorkoutSchema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. The Sunday weekly narrative
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Sunday report (PRD §8.8). The numbers come from `WeeklyDose` and the
 * ledger; the model writes the connective tissue and nothing else.
 */
export const WEEKLY_NARRATIVE_SYSTEM = `${PREAMBLE}

TASK: write Seth's Sunday weekly summary from the engine's weekly numbers.

Shape, in this order:
1. One sentence on what the week actually was.
2. Two or three lines on the numbers that moved, each naming a figure from the data.
3. One sentence on what next week's plan does differently, and why.

Rules:
- Every number is copied from the data. Do not compute totals, percentages, averages or trends the engine did not already give you.
- Under 120 words total.
- Name ONE thing that went well and, if the data supports it, ONE that did not. If the week was unremarkable, say so; do not manufacture a story.
- Compare to the target when a target is given ("112 of 180 Zone 2 minutes"), not to some ideal you invented.
- No score, no grade, no streak language unless the data contains one.
- Do not prescribe next week. Describe what the engine already planned.

The reply is sent as Telegram MarkdownV2 by the caller, which escapes your text. Write plain prose with line breaks; do not add markdown syntax yourself.`;

/** Build the messages for a weekly-narrative job. */
export function weeklyNarrativePrompt(weekly: unknown, context?: unknown): LlmMessage[] {
  return [
    { role: 'system', content: WEEKLY_NARRATIVE_SYSTEM },
    {
      role: 'user',
      content: `Weekly numbers:\n${JSON.stringify(weekly, null, 2)}${
        context ? `\n\nContext:\n${JSON.stringify(context, null, 2)}` : ''
      }\n\nWrite the summary:`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Post-session summary (the fifth job kind)
// ─────────────────────────────────────────────────────────────────────────────

/** Short post-session confirmation, sent to Telegram when a session closes. */
export const SESSION_SUMMARY_SYSTEM = `${PREAMBLE}

TASK: write a two-sentence summary of the session Seth just finished.

- First sentence: what he did, using only the logged numbers.
- Second sentence: one thing the engine noted for tomorrow — a region now on cooldown, a PR, a standard met.
- Under 40 words. No praise adjectives. If he hit a PR, state it as a fact.
- Copy every number verbatim from the data.`;

/** Build the messages for a session-summary job. */
export function sessionSummaryPrompt(session: unknown, engineNotes?: unknown): LlmMessage[] {
  return [
    { role: 'system', content: SESSION_SUMMARY_SYSTEM },
    {
      role: 'user',
      content: `Session:\n${JSON.stringify(session, null, 2)}${
        engineNotes ? `\n\nEngine notes:\n${JSON.stringify(engineNotes, null, 2)}` : ''
      }\n\nTwo sentences:`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Output guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reject a "why" line that broke the rules before it reaches the card.
 *
 * The number check is the important one: it is the last line of defence against
 * a model that helpfully rounded 47 minutes to "about 45". Returns a cleaned
 * sentence, or `null` — and `null` means use `fallback-copy.ts`.
 */
export function guardWhyLine(text: string, engineOutput: unknown): string | null {
  const cleaned = text.trim().replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ' ');
  if (cleaned.length < 10 || cleaned.length > 220) return null;
  // Multiple sentences: keep the first, which is what we asked for.
  const firstSentence = /^(.+?[.!?])(\s|$)/.exec(cleaned)?.[1] ?? cleaned;
  const candidate = firstSentence.length >= 10 ? firstSentence : cleaned;

  const haystack = JSON.stringify(engineOutput ?? {});
  for (const match of candidate.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = match[0];
    // Percentages and small integers appear everywhere in engine output; only
    // flag a number that appears nowhere in it at all.
    if (!haystack.includes(n)) return null;
  }
  return candidate;
}

/** All prompt builders, keyed by `LlmJobKind`, for the worker's dispatcher. */
export const PROMPT_BUILDERS = {
  why_line: whyLinePrompt,
  chat: telegramChatPrompt,
  vision_parse: visionParsePrompt,
  weekly_narrative: weeklyNarrativePrompt,
  session_summary: sessionSummaryPrompt,
} as const;
