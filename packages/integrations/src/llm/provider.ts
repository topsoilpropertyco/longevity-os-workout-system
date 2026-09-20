/**
 * The `LlmProvider` interface and its two implementations.
 *
 * Same prompt in, same schema out, so the two are interchangeable and the
 * fallback chain in CLAUDE.md invariant 2 is a one-line swap:
 *
 *     LM Studio (Mac mini, local, free)
 *        └─ unreachable ─▶ Gemini free tier (Vercel)
 *              └─ unreachable ─▶ `fallback-copy.ts` deterministic templates
 *
 * Neither provider throws. Both return `IntegrationResult`, so a caller can
 * write `(await lm.chat(req)) ?? (await gemini.chat(req))`-shaped logic and the
 * today card never blocks on a model.
 */

import { type IntegrationResult, requestJson, succeed, fail } from '../http.js';

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmChatRequest {
  messages: LlmMessage[];
  /** 0 for anything parsed as JSON; a little warmth for chat copy. */
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object back. Both providers support this. */
  json?: boolean;
  /** Override the provider's default model id. */
  model?: string;
  timeoutMs?: number;
}

export interface LlmVisionRequest extends Omit<LlmChatRequest, 'messages'> {
  /** Instruction and context. The image is attached to the last user message. */
  messages: LlmMessage[];
  /** Base64-encoded image bytes, WITHOUT a data: prefix. */
  imageBase64: string;
  /** e.g. `image/jpeg`. Telegram photos are JPEG. */
  mimeType?: string;
}

export interface LlmResponse {
  text: string;
  /** Populated when `json: true` and the text parsed. */
  json?: unknown;
  model: string;
  provider: string;
  latencyMs: number;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/**
 * The contract every provider satisfies. Implementations differ only in
 * transport — never in the shape of what goes in or comes out.
 */
export interface LlmProvider {
  /** Short id for logging and the `llm_jobs.provider` column. */
  readonly name: string;
  /** Text completion. */
  chat(req: LlmChatRequest): Promise<IntegrationResult<LlmResponse>>;
  /** Image + text completion. */
  vision(req: LlmVisionRequest): Promise<IntegrationResult<LlmResponse>>;
  /** Cheap liveness probe. Never throws; `false` means "use the fallback". */
  healthy(timeoutMs?: number): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// LM Studio (OpenAI-compatible)
// ─────────────────────────────────────────────────────────────────────────────

export const LM_STUDIO_DEFAULT_BASE = 'http://localhost:1234/v1';

export interface LmStudioOptions {
  /**
   * Model id. LM Studio routes `"local-model"` to whatever is loaded, which is
   * what we want: Seth swaps models in the GUI without touching code.
   * ⚠️ Verify at build time: confirm the loaded text and vision model ids with
   * `GET /v1/models` (PRD §12 handoff item: "Confirm LM Studio server port and
   * installed models"). A vision job sent to a text-only model returns prose,
   * not JSON, and the zod validation in `prompts.ts` will reject it.
   */
  model?: string;
  /** Vision-capable model id, when it differs from the text model. */
  visionModel?: string;
  timeoutMs?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAiChatResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * LM Studio's OpenAI-compatible server, the primary provider.
 *
 * Runs on the Mac mini at `http://localhost:1234/v1` — reached only by the
 * worker ON that machine, never across the network (CLAUDE.md invariant 3).
 * Generous default timeout: a local 7–14B model on a mini is slower than a
 * hosted API, and the job queue is asynchronous anyway.
 */
export function lmStudioProvider(
  baseUrl: string = LM_STUDIO_DEFAULT_BASE,
  opts: LmStudioOptions = {},
): LlmProvider {
  const base = baseUrl.replace(/\/$/, '');
  const model = opts.model ?? 'local-model';
  const visionModel = opts.visionModel ?? model;
  const defaultTimeout = opts.timeoutMs ?? 120_000;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
  };

  const post = async (
    body: Record<string, unknown>,
    timeoutMs: number,
    startedAt: number,
  ): Promise<IntegrationResult<LlmResponse>> => {
    const res = await requestJson<OpenAiChatResponse>(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body,
      timeoutMs,
      retries: 0,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    if (!res.ok) return res;
    const text = res.value?.choices?.[0]?.message?.content ?? '';
    if (!text) return fail('parse', 'LM Studio returned an empty completion', { detail: res.value });
    return succeed(buildResponse(text, res.value?.model ?? String(body['model']), 'lmstudio', startedAt, {
      ...(res.value?.usage?.prompt_tokens !== undefined ? { promptTokens: res.value.usage.prompt_tokens } : {}),
      ...(res.value?.usage?.completion_tokens !== undefined ? { completionTokens: res.value.usage.completion_tokens } : {}),
    }, body['response_format'] !== undefined));
  };

  return {
    name: 'lmstudio',

    /** Text completion against the loaded LM Studio model. */
    chat(req) {
      return post(
        {
          model: req.model ?? model,
          messages: req.messages,
          temperature: req.temperature ?? 0.2,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          stream: false,
        },
        req.timeoutMs ?? defaultTimeout,
        Date.now(),
      );
    },

    /**
     * Vision completion. LM Studio accepts the OpenAI content-parts form with a
     * `data:` URL, which is what Qwen2.5-VL and Llama 3.2 Vision class models
     * expect when served through it.
     */
    vision(req) {
      const messages = attachImageOpenAiStyle(req);
      return post(
        {
          model: req.model ?? visionModel,
          messages,
          temperature: req.temperature ?? 0,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          stream: false,
        },
        req.timeoutMs ?? defaultTimeout,
        Date.now(),
      );
    },

    /** `GET /v1/models`. A fast, cheap "is the mini awake" probe. */
    async healthy(timeoutMs = 2_500) {
      const res = await requestJson<unknown>(`${base}/models`, {
        timeoutMs,
        retries: 0,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
      return res.ok;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini (free tier)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ VERIFY AT BUILD TIME — RESEARCH §8 and §10.2 both flag this.
 *
 * Model id: the research doc says the `gemini-2.x-flash` FAMILY. The exact id
 * moves (`gemini-2.0-flash`, `-2.5-flash`, `-flash-lite`, dated previews) and a
 * retired id returns 404, silently killing the fallback. Confirm the current id
 * with `GET https://generativelanguage.googleapis.com/v1beta/models?key=…` on
 * the day of the build, and put it in `GEMINI_MODEL` rather than hard-coding.
 *
 * Free-tier quotas: the research doc records "free tier limits change — verify
 * RPM/RPD at build". The figures below are a PLACEHOLDER for planning only and
 * must be re-read from ai.google.dev/gemini-api/docs/rate-limits before launch.
 * They are what `estimateFreeTierHeadroom` reports against; nothing enforces
 * them server-side beyond Google's own 429.
 */
export const GEMINI_FREE_TIER_LIMITS_UNVERIFIED = {
  /** ⚠️ placeholder — verify at build time. */
  requestsPerMinute: 10,
  /** ⚠️ placeholder — verify at build time. */
  requestsPerDay: 250,
  /** ⚠️ placeholder — verify at build time. */
  tokensPerMinute: 250_000,
} as const;

/** ⚠️ Verify at build time. Overridable via `GEMINI_MODEL`. */
export const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiOptions {
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string; status?: string };
}

/**
 * Gemini free tier, the Vercel-side fallback when the mini is asleep.
 *
 * Takes the same `LlmChatRequest` and returns the same `LlmResponse` as
 * `lmStudioProvider`, so the prompts in `prompts.ts` are written once.
 *
 * Gemini's API shape differs in two ways this adapter hides: the system prompt
 * goes in `systemInstruction` rather than a message, and JSON mode is
 * `responseMimeType: 'application/json'`.
 */
export function geminiProvider(apiKey: string, opts: GeminiOptions = {}): LlmProvider {
  const model = opts.model ?? GEMINI_DEFAULT_MODEL;
  const base = (opts.baseUrl ?? GEMINI_BASE).replace(/\/$/, '');
  const defaultTimeout = opts.timeoutMs ?? 30_000;

  const generate = async (
    modelId: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    startedAt: number,
    wantsJson: boolean,
  ): Promise<IntegrationResult<LlmResponse>> => {
    if (!apiKey) return fail('auth', 'geminiProvider called without an API key');
    const res = await requestJson<GeminiResponse>(
      `${base}/models/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        timeoutMs,
        retries: 1,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      },
    );
    if (!res.ok) return res;
    if (res.value?.error) {
      return fail('client', `Gemini error: ${res.value.error.message ?? 'unknown'}`, {
        detail: res.value.error,
      });
    }
    const text = (res.value?.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!text) {
      // An empty candidate usually means a safety block or a MAX_TOKENS stop.
      return fail('parse', `Gemini returned no text (finishReason: ${res.value?.candidates?.[0]?.finishReason ?? 'unknown'})`, {
        detail: res.value,
      });
    }
    return succeed(
      buildResponse(text, res.value?.modelVersion ?? modelId, 'gemini', startedAt, {
        ...(res.value?.usageMetadata?.promptTokenCount !== undefined
          ? { promptTokens: res.value.usageMetadata.promptTokenCount }
          : {}),
        ...(res.value?.usageMetadata?.candidatesTokenCount !== undefined
          ? { completionTokens: res.value.usageMetadata.candidatesTokenCount }
          : {}),
      }, wantsJson),
    );
  };

  const splitSystem = (
    messages: LlmMessage[],
  ): { system?: string; contents: Record<string, unknown>[] } => {
    const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    return {
      ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      contents,
    };
  };

  return {
    name: 'gemini',

    /** Text completion on the free tier. */
    chat(req) {
      const { system, contents } = splitSystem(req.messages);
      return generate(
        req.model ?? model,
        {
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            temperature: req.temperature ?? 0.2,
            ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
          },
        },
        req.timeoutMs ?? defaultTimeout,
        Date.now(),
        req.json === true,
      );
    },

    /** Vision completion — the whiteboard-photo path when the mini is down. */
    vision(req) {
      const { system, contents } = splitSystem(req.messages);
      const last = contents[contents.length - 1] as
        | { role: string; parts: Record<string, unknown>[] }
        | undefined;
      const imagePart = {
        inlineData: { mimeType: req.mimeType ?? 'image/jpeg', data: req.imageBase64 },
      };
      if (last) last.parts.push(imagePart);
      else contents.push({ role: 'user', parts: [imagePart] });

      return generate(
        req.model ?? model,
        {
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            temperature: req.temperature ?? 0,
            ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
          },
        },
        req.timeoutMs ?? defaultTimeout,
        Date.now(),
        req.json === true,
      );
    },

    /** Listing models is the cheapest call that proves the key works. */
    async healthy(timeoutMs = 3_000) {
      if (!apiKey) return false;
      const res = await requestJson<unknown>(`${base}/models`, {
        headers: { 'x-goog-api-key': apiKey },
        timeoutMs,
        retries: 0,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
      return res.ok;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Composition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try each provider in order and return the first success — invariant 2's
 * "no LM Studio → Gemini" made concrete. Returns the LAST error when all fail,
 * which is the caller's cue to reach for `fallback-copy.ts`.
 */
export function chain(...providers: LlmProvider[]): LlmProvider {
  return {
    name: providers.map((p) => p.name).join('>'),
    async chat(req) {
      let last: IntegrationResult<LlmResponse> = fail('unknown', 'no providers configured');
      for (const p of providers) {
        const res = await p.chat(req);
        if (res.ok) return res;
        last = res;
      }
      return last;
    },
    async vision(req) {
      let last: IntegrationResult<LlmResponse> = fail('unknown', 'no providers configured');
      for (const p of providers) {
        const res = await p.vision(req);
        if (res.ok) return res;
        last = res;
      }
      return last;
    },
    async healthy(timeoutMs) {
      for (const p of providers) {
        if (await p.healthy(timeoutMs)) return true;
      }
      return false;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildResponse(
  text: string,
  model: string,
  provider: string,
  startedAt: number,
  usage: { promptTokens?: number; completionTokens?: number },
  wantsJson: boolean,
): LlmResponse {
  const out: LlmResponse = {
    text,
    model,
    provider,
    latencyMs: Date.now() - startedAt,
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
  };
  if (wantsJson) {
    const parsed = extractJson(text);
    if (parsed !== undefined) out.json = parsed;
  }
  return out;
}

/**
 * Pull a JSON value out of a model response, tolerating the two things models
 * do even in JSON mode: wrap it in a ```json fence, or add a sentence first.
 * Returns `undefined` rather than throwing when nothing parses.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [fenced?.[1], trimmed].filter((c): c is string => typeof c === 'string');
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // Fall through to the brace-slice attempt below.
    }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** OpenAI content-parts form: text plus a base64 `data:` image URL. */
function attachImageOpenAiStyle(req: LlmVisionRequest): unknown[] {
  const messages = req.messages.map((m) => ({ role: m.role, content: m.content as unknown }));
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const imagePart = {
    type: 'image_url',
    image_url: { url: `data:${req.mimeType ?? 'image/jpeg'};base64,${req.imageBase64}` },
  };
  if (lastUser) {
    lastUser.content = [{ type: 'text', text: String(lastUser.content) }, imagePart];
  } else {
    messages.push({ role: 'user', content: [imagePart] });
  }
  return messages;
}

/**
 * Rough free-tier headroom check for the Gemini fallback.
 * ⚠️ The limits it compares against are unverified placeholders — see
 * `GEMINI_FREE_TIER_LIMITS_UNVERIFIED`.
 */
export function estimateFreeTierHeadroom(callsToday: number, callsThisMinute: number): {
  withinDaily: boolean;
  withinMinute: boolean;
  note: string;
} {
  const l = GEMINI_FREE_TIER_LIMITS_UNVERIFIED;
  return {
    withinDaily: callsToday < l.requestsPerDay,
    withinMinute: callsThisMinute < l.requestsPerMinute,
    note: '⚠️ limits unverified — re-read ai.google.dev/gemini-api/docs/rate-limits at build time',
  };
}
