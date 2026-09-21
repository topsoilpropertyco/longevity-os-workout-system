import 'server-only';

import {
  FileTokenStore,
  OuraClient,
  StravaClient,
  SupabaseTokenStore,
  TelegramClient,
  accessTokenGetter,
  geminiProvider,
  lmStudioProvider,
  type LlmProvider,
  type OuraOAuthCredentials,
  type TokenRowStore,
  type TokenStore,
} from '@longevity/integrations';

import { serviceSupabase } from './supabase/server';

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

// ─────────────────────────────────────────────────────────────────────────────
// Oura — OAuth2 since December 2025
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Oura RETIRED PERSONAL ACCESS TOKENS IN DECEMBER 2025 and new ones cannot be
 * created, so `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` are now the wired state.
 * `OURA_PAT` is still honoured for a grandfathered token and nothing else.
 */
export function ouraCredentials(): OuraOAuthCredentials | null {
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Where Oura sends the browser back. Must match the Oura application exactly. */
export function ouraRedirectUri(origin: string): string {
  return process.env.OURA_REDIRECT_URI ?? `${origin}/api/oura/callback`;
}

/**
 * The ~25 lines that keep `@longevity/integrations` free of the Supabase SDK —
 * the same injected-client idea `worker/src/index.ts` uses for `llm_jobs`.
 */
function supabaseTokenRowStore(sb: NonNullable<ReturnType<typeof serviceSupabase>>): TokenRowStore {
  return {
    async insert(table, row) {
      const { data, error } = await sb.from(table).insert(row).select().single();
      if (error) throw new Error(`insert ${table}: ${error.message}`);
      return data as Record<string, unknown>;
    },
    async update(table, match, patch) {
      let q = sb.from(table).update(patch);
      for (const [k, v] of Object.entries(match)) {
        q = v === null || v === undefined ? q.is(k, null) : q.eq(k, v as never);
      }
      const { data, error } = await q.select();
      if (error) throw new Error(`update ${table}: ${error.message}`);
      return (data ?? []) as Record<string, unknown>[];
    },
    async select(table, query) {
      let q = sb.from(table).select('*');
      for (const [k, v] of Object.entries(query.match ?? {})) {
        q = v === null || v === undefined ? q.is(k, null) : q.eq(k, v as never);
      }
      if (query.limit) q = q.limit(query.limit);
      const { data, error } = await q;
      if (error) throw new Error(`select ${table}: ${error.message}`);
      return (data ?? []) as Record<string, unknown>[];
    },
  };
}

/**
 * Where the encrypted token set lives.
 *
 * Deployed: the `integration_tokens` row, service-role only. Locally, or on the
 * Mac mini, there is no Supabase service key and no `LONGEVITY_USER_ID`, so it
 * falls back to the file `scripts/oura-auth.ts` writes — which is the whole
 * point of that script: Oura works before anything is deployed.
 *
 * Returns null only when there is no encryption key, because a token store that
 * cannot encrypt is one that would write a secret in the clear.
 */
export function ouraTokenStore(): TokenStore | null {
  if (!process.env.OURA_TOKEN_KEY) return null;

  const userId = process.env.LONGEVITY_USER_ID;
  const sb = serviceSupabase();
  if (sb && userId) {
    return new SupabaseTokenStore({ store: supabaseTokenRowStore(sb), userId });
  }
  return new FileTokenStore(process.env.OURA_TOKEN_FILE ?? '.oura-tokens.enc');
}

/**
 * Oura API v2.
 *
 * Async because the bearer now comes from a store: the client resolves it per
 * request through `accessTokenGetter`, so a token rotated mid-sync is picked up
 * on the next call and the rotated pair is persisted before it is used.
 *
 * Still returns `null` when Oura is not configured at all — the today card then
 * renders the three sliders and Seth notices nothing (CLAUDE.md invariant 2).
 */
export async function ouraClient(): Promise<OuraClient | null> {
  // Set OURA_SANDBOX=1 to read the canned collection instead of Seth's data.
  const sandbox = process.env.OURA_SANDBOX === '1';

  const creds = ouraCredentials();
  const store = creds ? ouraTokenStore() : null;
  if (creds && store) {
    return new OuraClient({ getAccessToken: accessTokenGetter(store, creds), sandbox });
  }

  // Legacy path: an existing PAT still works. Oura stopped issuing them in
  // December 2025, so nobody can arrive here for the first time.
  const pat = process.env.OURA_PAT;
  if (pat) return new OuraClient({ token: pat, sandbox });

  return null;
}

/** Which Oura auth is configured, for the settings screen and error copy. */
export function ouraStatus(): 'oauth' | 'legacy_pat' | 'unconfigured' {
  if (ouraCredentials() && process.env.OURA_TOKEN_KEY) return 'oauth';
  if (process.env.OURA_PAT) return 'legacy_pat';
  return 'unconfigured';
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
