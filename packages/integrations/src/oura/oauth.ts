/**
 * Oura OAuth2 — authorization code + PKCE, and the refresh/revoke pair.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Oura RETIRED PERSONAL ACCESS TOKENS IN DECEMBER 2025. New ones cannot be
 * created. `docs/RESEARCH_FOUNDATION.md` §3 ("a PAT is all a single user
 * needs") predates that and is wrong; see the dated correction appended to the
 * end of that file. OAuth2 is now the only way to get a new credential, even
 * for a single user reading their own ring.
 *
 * ── ⚠️ DO NOT "FIX" THE ENDPOINTS BACK ───────────────────────────────────────
 * Oura's own authentication documentation still shows the legacy pair:
 *
 *     https://cloud.ouraring.com/oauth/authorize
 *     https://api.ouraring.com/oauth/token
 *
 * Applications registered in Oura's POST-2025 developer portal DO NOT WORK
 * against those. They return `Invalid client` with perfect credentials, which
 * reads exactly like a bad client id and sends you hunting in the wrong place
 * for an afternoon. Post-2025 apps authenticate against `moi.ouraring.com`, per
 * the live OIDC discovery document (verified 2026-09-21):
 *
 *     https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous/.well-known/openid-configuration
 *
 * If the endpoints below ever stop working, call `discoverEndpoints()` and read
 * the document rather than reverting to the legacy URLs.
 *
 * ── SCOPES ARE NAMESPACED ────────────────────────────────────────────────────
 * The legacy bare names (`daily`, `heartrate`, `session`) are SILENTLY
 * UNGRANTED. The authorize call succeeds, the token comes back, and every data
 * request then reads nothing. Real scopes carry the `extapi:` prefix.
 *
 * ── DATA ENDPOINTS ARE UNCHANGED ─────────────────────────────────────────────
 * `https://api.ouraring.com/v2/usercollection/` with `Authorization: Bearer`,
 * exactly as before. Only the auth handshake moved.
 *
 * Node 20+ built-ins only: `node:crypto` and global `fetch`. Nothing here
 * throws into a request path — every function returns an `IntegrationResult`.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  type IntegrationError,
  type IntegrationResult,
  fail,
  requestJson,
  succeed,
} from '../http.js';

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/** The OIDC issuer for post-2025 Oura applications. */
export const OURA_ISSUER = 'https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous';

/** Where `discoverEndpoints()` reads from. */
export const OURA_DISCOVERY_URL = `${OURA_ISSUER}/.well-known/openid-configuration`;

/**
 * Verified against the live discovery document on 2026-09-21.
 *
 * ⚠️ `moi.ouraring.com`, NOT `cloud.ouraring.com` / `api.ouraring.com`. See the
 * file header before changing any of these.
 */
export const OURA_ENDPOINTS = {
  authorize: 'https://moi.ouraring.com/oauth/v2/ext/oauth-authorize',
  token: 'https://moi.ouraring.com/oauth/v2/ext/oauth-token',
  revoke: 'https://moi.ouraring.com/oauth/v2/ext/oauth-revoke',
  introspect: 'https://moi.ouraring.com/oauth/v2/ext/oauth-introspect',
} as const;

export type OuraEndpoints = { -readonly [K in keyof typeof OURA_ENDPOINTS]: string };

/**
 * The pre-2025 endpoints, and the pre-2025 bare scope names that go with them.
 *
 * Kept because the evidence is genuinely mixed. Oura's application portal still
 * prints an "Example Authorization Url" pointing at `cloud.ouraring.com`, and
 * still presents its scope checkboxes under the bare names (Daily, Heartrate,
 * Session…). Meanwhile a working integration reports that those endpoints
 * answer `Invalid client` and that `moi.ouraring.com` with `extapi:*` is what
 * actually succeeds.
 *
 * Rather than guess on someone's behalf, `OURA_AUTH_FLAVOR=legacy` selects
 * these. The failure is loud and immediate either way — a wrong authorize host
 * shows an error page before any token exists — so flipping one environment
 * variable is a five-second experiment instead of a code change.
 */
export const OURA_LEGACY_ENDPOINTS = {
  authorize: 'https://cloud.ouraring.com/oauth/authorize',
  token: 'https://api.ouraring.com/oauth/token',
  revoke: 'https://api.ouraring.com/oauth/revoke',
  introspect: 'https://api.ouraring.com/oauth/introspect',
} as const;

/** Bare scope names, as the legacy server and the portal checkboxes name them. */
export const OURA_LEGACY_SCOPES = [
  'personal', 'daily', 'heartrate', 'session', 'workout', 'tag', 'spo2',
] as const;

export type OuraAuthFlavor = 'modern' | 'legacy';

/** Which endpoint/scope pair to use. `OURA_AUTH_FLAVOR=legacy` picks the old one. */
export function ouraFlavor(env: Record<string, string | undefined> = process.env): OuraAuthFlavor {
  return env['OURA_AUTH_FLAVOR'] === 'legacy' ? 'legacy' : 'modern';
}

export function endpointsFor(flavor: OuraAuthFlavor): OuraEndpoints {
  return { ...(flavor === 'legacy' ? OURA_LEGACY_ENDPOINTS : OURA_ENDPOINTS) };
}

export function scopesFor(flavor: OuraAuthFlavor): readonly string[] {
  return flavor === 'legacy' ? OURA_LEGACY_SCOPES : OURA_SCOPES;
}

/**
 * Exactly what Longevity OS asks for, and nothing more.
 *
 * `extapi:personal` backs `personal_info`; `extapi:daily` backs every
 * `daily_*` document plus `vO2_max` and `daily_cardiovascular_age`;
 * the rest map one-to-one onto the endpoints `client.ts` calls.
 *
 * NOT requested, deliberately: `extapi:tag`, `extapi:spo2`,
 * `extapi:biomarkers`, `extapi:metabolic`, `extapi:research`, `openid`,
 * `profile`, `email`. Nothing reads them, so nothing should be granted them.
 *
 * There is NO `offline_access` scope in this provider. Refresh tokens are
 * issued because the `refresh_token` grant type is supported, not because a
 * scope was asked for — do not add one hunting for refreshes.
 */
export const OURA_SCOPES = [
  'extapi:personal',
  'extapi:daily',
  'extapi:heartrate',
  'extapi:session',
  'extapi:workout',
  'extapi:stress',
  'extapi:heart_health',
] as const;

/** The scope string as it goes on the wire (space separated, per RFC 6749). */
export const OURA_SCOPE_STRING = OURA_SCOPES.join(' ');

// ─────────────────────────────────────────────────────────────────────────────
// Token shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One Oura token set, as persisted.
 *
 * `expires_at` is an ABSOLUTE epoch time in SECONDS. The wire gives a relative
 * `expires_in`; storing that verbatim is the classic bug — after a restart it
 * reads as "expires 3600 seconds from whenever you happened to look", so the
 * token never appears stale and every call 401s. It is converted on arrival,
 * once, here.
 */
export interface OuraTokens {
  access_token: string;
  /**
   * SINGLE USE. Every successful refresh invalidates this value and returns a
   * new one. Persist the replacement before you use the access token, or the
   * connection is dead — see `tokens.ts`.
   */
  refresh_token: string;
  /** Absolute epoch SECONDS. Never a relative `expires_in`. */
  expires_at: number;
  /** Space-separated scopes the server actually granted. May differ from asked. */
  scope?: string;
  /** Practically always `Bearer`. */
  token_type?: string;
}

/** The raw token-endpoint body, before normalisation. */
interface RawTokenResponse {
  /** Oura may add fields; they pass through untouched (and unlogged). */
  [key: string]: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

/** Client credentials for every call that talks to the token endpoint. */
export interface OuraOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCE
// ─────────────────────────────────────────────────────────────────────────────

/** A PKCE pair. Keep `verifier` in the process; only `challenge` leaves it. */
export interface PkcePair {
  /** 64 base64url characters (48 random bytes). Secret. */
  verifier: string;
  /** base64url(SHA-256(verifier)). Safe to put in a URL. */
  challenge: string;
}

/**
 * Generate an S256 PKCE pair.
 *
 * Oura advertises `plain` as supported and does NOT make PKCE mandatory. We use
 * S256 anyway: the authorize URL is printed to a terminal and pasted into a
 * browser, which is precisely the path where a code can be shoulder-surfed out
 * of a redirect, and S256 costs nothing.
 *
 * 48 random bytes → 64 base64url characters, the RFC 7636 maximum, with no
 * padding to strip.
 */
export function generatePkce(): PkcePair {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** A URL-safe random string for the `state` parameter. */
export function generateState(bytes = 24): string {
  return base64url(randomBytes(bytes));
}

/**
 * Constant-time `state` comparison. A timing leak here is not a realistic
 * attack, but the helper keeps every call site honest and reads clearly.
 */
export function statesMatch(expected: string, received: string | null | undefined): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Buffer → base64url, no padding. */
export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorize
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildAuthUrlInput {
  clientId: string;
  /** Must match a redirect URI registered on the Oura application, exactly. */
  redirectUri: string;
  /** Defaults to `OURA_SCOPES`. Pass fewer, never bare legacy names. */
  scopes?: readonly string[];
  /** Anti-CSRF nonce; the callback must compare it with `statesMatch`. */
  state: string;
  /** `challenge` from `generatePkce()`. */
  codeChallenge: string;
  /** Override for a non-production issuer. Defaults to `OURA_ENDPOINTS`. */
  endpoints?: Partial<OuraEndpoints>;
}

/** The URL Seth opens in a browser to grant access. Pure string building. */
export function buildAuthUrl(input: BuildAuthUrlInput): string {
  const authorize = input.endpoints?.authorize ?? OURA_ENDPOINTS.authorize;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: (input.scopes ?? OURA_SCOPES).join(' '),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${authorize}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token endpoint
// ─────────────────────────────────────────────────────────────────────────────

export interface ExchangeCodeInput extends OuraOAuthCredentials {
  /** The `code` query parameter from the redirect. Single use, short lived. */
  code: string;
  /** Byte-identical to the one sent to `buildAuthUrl`, or the exchange fails. */
  redirectUri: string;
  /** `verifier` from the same `generatePkce()` call. */
  codeVerifier: string;
  endpoints?: Partial<OuraEndpoints>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Trade an authorization code for a token set. */
export async function exchangeCode(
  input: ExchangeCodeInput,
): Promise<IntegrationResult<OuraTokens>> {
  return postTokenEndpoint(
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    input,
  );
}

export interface RefreshTokensInput extends OuraOAuthCredentials {
  /** The current refresh token. It is consumed by this call, win or lose. */
  refreshToken: string;
  endpoints?: Partial<OuraEndpoints>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Exchange a refresh token for a fresh pair.
 *
 * ⚠️ REFRESH TOKENS ROTATE AND ARE SINGLE USE. The value passed in is dead the
 * moment this returns successfully, and the caller MUST persist the new set
 * before doing anything else with the access token. `tokens.ts` is the only
 * thing that should call this in normal operation; it owns that ordering and
 * the single-flight lock that stops two callers spending the same token.
 */
export async function refreshTokens(
  input: RefreshTokensInput,
): Promise<IntegrationResult<OuraTokens>> {
  return postTokenEndpoint(
    {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    input,
  );
}

export interface RevokeTokenInput extends OuraOAuthCredentials {
  /** The access or refresh token to invalidate. */
  token: string;
  /** Helps the server find it faster. Optional per RFC 7009. */
  tokenTypeHint?: 'access_token' | 'refresh_token';
  endpoints?: Partial<OuraEndpoints>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Revoke a token. RFC 7009 says a revoke of an already-invalid token is a
 * success, so this is safe to call on a connection you believe is already dead.
 */
export async function revokeToken(
  input: RevokeTokenInput,
): Promise<IntegrationResult<void>> {
  const url = input.endpoints?.revoke ?? OURA_ENDPOINTS.revoke;
  const body = new URLSearchParams({
    token: input.token,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    ...(input.tokenTypeHint ? { token_type_hint: input.tokenTypeHint } : {}),
  }).toString();

  const res = await requestJson<unknown>(url, {
    method: 'POST',
    headers: FORM_HEADERS,
    body,
    timeoutMs: input.timeoutMs ?? 15_000,
    retries: 0,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  if (!res.ok) return { ok: false, error: classifyOAuthError(res.error) };
  return succeed(undefined);
}

/**
 * POST a form body to the token endpoint and normalise the answer.
 *
 * `client_secret_post` (credentials in the body) is used rather than
 * `client_secret_basic`; both are advertised, and the body form is the one that
 * survives a copy-paste into curl unchanged.
 *
 * `retries: 0` is deliberate and load-bearing. `requestJson` would otherwise
 * retry a 5xx — but both grants here consume a single-use credential, so the
 * second attempt would present an already-spent code or refresh token and turn
 * a transient server blip into a permanent `invalid_grant`.
 */
async function postTokenEndpoint(
  form: Record<string, string>,
  opts: {
    endpoints?: Partial<OuraEndpoints>;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<IntegrationResult<OuraTokens>> {
  const url = opts.endpoints?.token ?? OURA_ENDPOINTS.token;
  const res = await requestJson<RawTokenResponse>(url, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: new URLSearchParams(form).toString(),
    timeoutMs: opts.timeoutMs ?? 15_000,
    retries: 0,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });

  if (!res.ok) return { ok: false, error: classifyOAuthError(res.error) };
  return normalizeTokens(res.value);
}

const FORM_HEADERS: Record<string, string> = {
  'content-type': 'application/x-www-form-urlencoded',
  accept: 'application/json',
};

/**
 * Turn a raw token response into `OuraTokens`, converting the relative
 * `expires_in` into an absolute `expires_at`.
 *
 * A missing `refresh_token` is treated as a failure rather than quietly stored:
 * a set with no refresh token is a connection that dies in an hour, and it is
 * far better to learn that during `scripts/oura-auth.ts` than at 03:00 during
 * the nightly sync.
 */
export function normalizeTokens(
  raw: RawTokenResponse | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): IntegrationResult<OuraTokens> {
  if (!raw || typeof raw !== 'object') {
    return fail('schema', 'Oura token endpoint returned a non-object');
  }
  const access = typeof raw.access_token === 'string' ? raw.access_token : '';
  const refresh = typeof raw.refresh_token === 'string' ? raw.refresh_token : '';
  if (!access) return fail('schema', 'Oura token response had no access_token', { detail: redactKeys(raw) });
  if (!refresh) {
    return fail(
      'schema',
      'Oura token response had no refresh_token — this connection would expire and could not renew',
      { detail: redactKeys(raw) },
    );
  }

  const expiresIn = Number(raw.expires_in);
  // A missing/absurd expires_in defaults to one hour, which is what Oura issues.
  const lifetime = Number.isFinite(expiresIn) && expiresIn > 0 ? Math.floor(expiresIn) : 3600;

  return succeed({
    access_token: access,
    refresh_token: refresh,
    expires_at: nowSec + lifetime,
    ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
    ...(typeof raw.token_type === 'string' ? { token_type: raw.token_type } : {}),
  });
}

/**
 * Map an OAuth error body onto an `IntegrationErrorKind`.
 *
 * The one that matters is `invalid_grant` → `needs_reauth`. RETRYING IT MAKES
 * THINGS WORSE: the grant is gone, and each further attempt only burns another
 * rotated token. A human has to open a browser and re-authorise
 * (`npx tsx scripts/oura-auth.ts`, or Settings → Connect Oura). Callers must
 * stop and say so, not back off and try again.
 */
export function classifyOAuthError(error: IntegrationError): IntegrationError {
  const code = oauthErrorCode(error.detail);
  if (code === 'invalid_grant') {
    return {
      ...error,
      kind: 'needs_reauth',
      message:
        'Oura rejected the grant (invalid_grant): the code or refresh token is spent, expired or revoked. ' +
        'Refresh tokens are single use — a human must re-authorise in a browser. Do not retry.',
    };
  }
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return {
      ...error,
      kind: 'auth',
      message:
        `Oura rejected the client (${code}). Check OURA_CLIENT_ID / OURA_CLIENT_SECRET — and check the ` +
        'endpoint host: post-2025 apps must use moi.ouraring.com, NOT cloud.ouraring.com/api.ouraring.com, ' +
        'which answer "Invalid client" to perfectly good credentials.',
    };
  }
  if (code) return { ...error, message: `Oura OAuth error "${code}": ${error.message}` };
  return error;
}

/** Pull `error` out of an RFC 6749 error body, whatever shape it arrived in. */
function oauthErrorCode(detail: unknown): string | undefined {
  if (!detail) return undefined;
  if (typeof detail === 'object' && 'error' in (detail as Record<string, unknown>)) {
    const v = (detail as Record<string, unknown>)['error'];
    if (typeof v === 'string') return v;
  }
  if (typeof detail !== 'string') return undefined;
  try {
    const parsed = JSON.parse(detail) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // Not JSON. Fall through to the substring check — some gateways answer
    // text/plain or HTML and the code is still in there.
  }
  const m = detail.match(/\b(invalid_grant|invalid_client|unauthorized_client|invalid_request|invalid_scope|unsupported_grant_type|access_denied)\b/);
  return m?.[1];
}

/** Never log a token, even into an error detail. */
function redactKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    out[k] = k.includes('token') ? '[redacted]' : raw[k];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of the OIDC discovery document we act on. */
export interface OuraDiscovery {
  issuer: string;
  endpoints: OuraEndpoints;
  scopesSupported: string[];
  grantTypesSupported: string[];
  codeChallengeMethodsSupported: string[];
  tokenEndpointAuthMethodsSupported: string[];
}

/**
 * Read the live OIDC discovery document.
 *
 * ⚠️ NOT ON THE HOT PATH. `OURA_ENDPOINTS` is the constant every request uses;
 * a network round trip before each token call would add a failure mode for no
 * benefit. This exists so that (a) `scripts/oura-auth.ts` can print a warning
 * when the constants have drifted from reality, and (b) the day Oura moves the
 * endpoints again, the fix is a diagnostic run rather than an archaeology
 * expedition through docs that are already out of date.
 */
export async function discoverEndpoints(
  issuerUrl: string = OURA_DISCOVERY_URL,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<IntegrationResult<OuraDiscovery>> {
  // Accept either the issuer or the full well-known URL, since both get pasted.
  const url = issuerUrl.includes('/.well-known/')
    ? issuerUrl
    : `${issuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`;

  const res = await requestJson<Record<string, unknown>>(url, {
    timeoutMs: opts.timeoutMs ?? 10_000,
    retries: 1,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  if (!res.ok) return res;

  const doc = res.value;
  if (!doc || typeof doc !== 'object') {
    return fail('schema', `discovery document at ${url} was not an object`);
  }
  const str = (k: string): string => (typeof doc[k] === 'string' ? (doc[k] as string) : '');
  const arr = (k: string): string[] =>
    Array.isArray(doc[k]) ? (doc[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];

  const endpoints: OuraEndpoints = {
    authorize: str('authorization_endpoint') || OURA_ENDPOINTS.authorize,
    token: str('token_endpoint') || OURA_ENDPOINTS.token,
    revoke: str('revocation_endpoint') || OURA_ENDPOINTS.revoke,
    introspect: str('introspection_endpoint') || OURA_ENDPOINTS.introspect,
  };

  return succeed({
    issuer: str('issuer') || OURA_ISSUER,
    endpoints,
    scopesSupported: arr('scopes_supported'),
    grantTypesSupported: arr('grant_types_supported'),
    codeChallengeMethodsSupported: arr('code_challenge_methods_supported'),
    tokenEndpointAuthMethodsSupported: arr('token_endpoint_auth_methods_supported'),
  });
}

/** Names of any hard-coded endpoint that no longer matches discovery. */
export function endpointDrift(discovered: OuraEndpoints): string[] {
  return (Object.keys(OURA_ENDPOINTS) as (keyof OuraEndpoints)[]).filter(
    (k) => discovered[k] !== OURA_ENDPOINTS[k],
  );
}
