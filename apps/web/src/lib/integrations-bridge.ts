import 'server-only';

import {
  OuraClient,
  StravaClient,
  TelegramClient,
  geminiProvider,
  lmStudioProvider,
  type LlmProvider,
} from '@longevity/integrations';

/**
 * INTEGRATIONS BRIDGE — the seam between the route handlers and
 * `@longevity/integrations`.
 *
 * That package owns every HTTP client (Oura v2, Strava, Telegram, LM Studio /
 * Gemini) and this app reimplements none of them. The only job here is reading
 * environment variables and deciding whether an integration is configured at
 * all: each factory returns a live client or `null`, and a route that gets
 * `null` answers "not wired" rather than guessing.
 *
 * Nothing in this file throws. A missing credential is an ordinary state on a
 * $0 personal project — Seth may never connect Strava, and the today card has
 * to render regardless (CLAUDE.md invariant 2).
 */

export type NotWired = { ok: false; reason: 'integration_not_wired'; integration: string };

export function notWired(integration: string): NotWired {
  return { ok: false, reason: 'integration_not_wired', integration };
}

/**
 * Oura API v2. A personal access token is all a single user needs — PATs do not
 * expire, so there is no refresh dance to get wrong.
 */
export function ouraClient(): OuraClient | null {
  const token = process.env.OURA_PAT;
  if (!token) return null;
  return new OuraClient({
    token,
    // Set OURA_SANDBOX=1 to read the canned collection instead of Seth's data.
    sandbox: process.env.OURA_SANDBOX === '1',
  });
}

/**
 * Strava. OAuth authorization-code flow; access tokens last about six hours, so
 * `onTokens` has to persist the rotated pair or the next request re-authorizes.
 */
export function stravaClient(
  tokens?: { access_token: string; refresh_token: string; expires_at: number },
  onTokens?: (t: { access_token: string; refresh_token: string; expires_at: number }) => void | Promise<void>,
): StravaClient | null {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return new StravaClient({
    clientId,
    clientSecret,
    ...(tokens ? { tokens } : {}),
    ...(onTokens ? { onTokens } : {}),
  });
}

/** Telegram Bot API — sendMessage, answerCallbackQuery, photo download. */
export function telegramClient(): TelegramClient | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const chat = process.env.TELEGRAM_CHAT_ID;
  return new TelegramClient({ token, ...(chat ? { defaultChatId: chat } : {}) });
}

/**
 * The Vercel-side LLM provider.
 *
 * Note which one this is: the Mac mini claims jobs from the queue and runs them
 * on LM Studio. This factory is the FALLBACK path — a job still unclaimed after
 * its 60-second deadline gets picked up here, on the Gemini free tier, because
 * the mini is asleep or offline. LM Studio is only reachable from a server that
 * shares its network, so it is returned solely when LMSTUDIO_BASE_URL is set
 * explicitly, which on Vercel it will not be.
 *
 * Returns null when neither is configured, and the caller falls back to
 * `templateWhy()` below. The ladder never ends in an error.
 */
export function llmClient(): LlmProvider | null {
  const lmStudio = process.env.LMSTUDIO_BASE_URL;
  if (lmStudio) return lmStudioProvider(lmStudio);

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) return geminiProvider(geminiKey);

  return null;
}

/** Which rung of the LLM ladder is available, for the settings screen. */
export function llmStatus(): 'lm_studio' | 'gemini' | 'templates' {
  if (process.env.LMSTUDIO_BASE_URL) return 'lm_studio';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'templates';
}

/**
 * Deterministic "why" copy. The last rung of the LLM ladder: no LM Studio → no
 * Gemini → these templates (CLAUDE.md invariant 2). Never blocks, never costs.
 */
export function templateWhy(input: {
  sessionTitle: string;
  sessionType: string;
  readinessBand: string;
  minutes: number;
  locationName: string;
}): string {
  const band: Record<string, string> = {
    push: 'Readiness is high, so today is the day to add a little',
    as_planned: 'Readiness is normal, so run it as written',
    reduced: 'Readiness is down, so load is cut and RPE is capped',
    recovery: 'Readiness is low, so today is movement, not training',
  };
  const lead = band[input.readinessBand] ?? 'Run it as written';
  return `${lead}: ${input.sessionTitle.toLowerCase()} at ${input.locationName}, about ${input.minutes} minutes.`;
}
