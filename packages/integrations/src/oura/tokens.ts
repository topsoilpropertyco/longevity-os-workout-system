/**
 * Oura token rotation — the contract that keeps the connection alive.
 *
 * ── THE ONE THING THAT BREAKS ────────────────────────────────────────────────
 * OURA REFRESH TOKENS ARE SINGLE USE AND THEY ROTATE. Every successful refresh
 * invalidates the token that was presented and issues a replacement. Three
 * consequences, and all three are handled here rather than at each call site:
 *
 *   1. The new set MUST be persisted BEFORE the access token is handed to
 *      anybody. If the process dies between "refreshed" and "written", the
 *      stored refresh token is already spent, nothing can renew it, and the
 *      only fix is a human re-authorising in a browser.
 *   2. Two concurrent callers must not both refresh. The loser presents a token
 *      the winner already spent and gets `invalid_grant` — which, being a real
 *      rejection, kills the connection. Hence the single-flight lock.
 *   3. `invalid_grant` is never retried. It propagates as `needs_reauth`.
 *
 * ── ENCRYPTION ───────────────────────────────────────────────────────────────
 * Tokens are AES-256-GCM ciphertext at rest, everywhere: the CLI's local file
 * and the `integration_tokens` row both hold the same blob format. The key is
 * `OURA_TOKEN_KEY`, 64 hex characters. A missing key THROWS. There is no
 * plaintext fallback — a fallback is how a secret ends up on disk in the clear
 * on the one machine nobody remembered to configure.
 *
 * Node 20+ built-ins only: `node:crypto`, `node:fs/promises`. No Supabase SDK —
 * `SupabaseTokenStore` takes the same minimal injected client shape that
 * `llm/jobs.ts` uses, so this package stays pure and testable against a Map.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type IntegrationResult, errMessage, fail, succeed } from '../http.js';
import {
  type OuraOAuthCredentials,
  type OuraTokens,
  refreshTokens,
} from './oauth.js';

// ─────────────────────────────────────────────────────────────────────────────
// The store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a token set lives. Two implementations ship below; a test can be three
 * lines around a variable.
 *
 * `save` must be durable by the time its promise resolves — `getValidAccessToken`
 * awaits it before returning, and that ordering is the whole safety argument.
 */
export interface TokenStore {
  load(): Promise<OuraTokens | null>;
  save(t: OuraTokens): Promise<void>;
}

/**
 * How close to expiry counts as "expiring". 120 seconds covers clock skew
 * between Vercel, the Mac mini and Oura, plus a slow request already in flight.
 *
 * It is a SKEW, not a refresh interval. Refreshing on every call would spend a
 * rotated token per request and multiply the number of chances to lose one.
 */
export const EXPIRY_SKEW_SECONDS = 120;

/** Current time as epoch SECONDS, matching `OuraTokens.expires_at`. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** True when `expires_at` is inside the skew window (or already past). */
export function isExpiring(
  tokens: Pick<OuraTokens, 'expires_at'>,
  now: number = nowSeconds(),
  skewSeconds: number = EXPIRY_SKEW_SECONDS,
): boolean {
  const expiresAt = Number(tokens.expires_at);
  // An unreadable expiry is treated as expired: better one wasted refresh than
  // an hour of 401s.
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt - skewSeconds <= now;
}

/**
 * In-flight refreshes, keyed by store instance. A `WeakMap` so a short-lived
 * store in a serverless invocation is not retained.
 *
 * This only guards callers that share a store object — i.e. one process. Two
 * Vercel lambdas refreshing at the same instant would still race; the mitigation
 * there is that the nightly sync is the only scheduled reader, and a lost race
 * surfaces honestly as `needs_reauth` rather than as silent bad data.
 */
const INFLIGHT = new WeakMap<TokenStore, Promise<IntegrationResult<string>>>();

/**
 * The only function anything else should call to get a bearer token.
 *
 * Refreshes ONLY when the stored token is inside `EXPIRY_SKEW_SECONDS` of
 * expiry. On a successful refresh the new set is written to the store and
 * awaited BEFORE the access token is returned — see the file header.
 *
 * `now` is epoch SECONDS, injectable for tests.
 */
export async function getValidAccessToken(
  store: TokenStore,
  creds: OuraOAuthCredentials,
  now: number = nowSeconds(),
): Promise<IntegrationResult<string>> {
  // Single flight: a second caller waits on the first rather than starting a
  // competing refresh with the same (single-use) token.
  const existing = INFLIGHT.get(store);
  if (existing) return existing;

  const run = resolveAccessToken(store, creds, now);
  INFLIGHT.set(store, run);
  try {
    return await run;
  } finally {
    INFLIGHT.delete(store);
  }
}

async function resolveAccessToken(
  store: TokenStore,
  creds: OuraOAuthCredentials,
  now: number,
): Promise<IntegrationResult<string>> {
  let current: OuraTokens | null;
  try {
    current = await store.load();
  } catch (e) {
    // A load failure is usually a missing or wrong OURA_TOKEN_KEY. It is a
    // configuration fault, not a dead grant, so it is `auth` and not
    // `needs_reauth` — re-authorising would not fix a bad key.
    return fail('auth', `could not read the stored Oura tokens: ${errMessage(e)}`, { detail: e });
  }

  if (!current) {
    return fail(
      'needs_reauth',
      'No Oura tokens are stored. Run `npx tsx scripts/oura-auth.ts`, or connect Oura from Settings.',
    );
  }

  if (!isExpiring(current, now)) return succeed(current.access_token);

  const refreshed = await refreshTokens({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: current.refresh_token,
  });

  if (!refreshed.ok) {
    // `invalid_grant` already arrived as `needs_reauth` from `classifyOAuthError`.
    // Do NOT retry it here: the refresh token is spent either way, and another
    // attempt only makes the logs harder to read.
    return { ok: false, error: refreshed.error };
  }

  // ⚠️ PERSIST FIRST. The old refresh token is already dead. If this process
  // exits before the write lands, the stored token is unusable and the whole
  // connection needs a browser re-authorisation. Nothing may read
  // `next.access_token` until the save has resolved.
  try {
    await store.save(refreshed.value);
  } catch (e) {
    return fail(
      'needs_reauth',
      `Oura tokens were refreshed but could NOT be saved (${errMessage(e)}). The previous refresh token ` +
        'is already spent, so this connection now needs a browser re-authorisation. Fix the store, then ' +
        'run `npx tsx scripts/oura-auth.ts`.',
      { detail: e },
    );
  }

  return succeed(refreshed.value.access_token);
}

/**
 * Adapter for `OuraClient({ getAccessToken })`, which wants a plain
 * `() => Promise<string>`.
 *
 * The rejection carries `kind` so the client can re-raise it faithfully as
 * `needs_reauth` instead of flattening every credential problem into `auth`.
 */
export function accessTokenGetter(
  store: TokenStore,
  creds: OuraOAuthCredentials,
): () => Promise<string> {
  return async () => {
    const res = await getValidAccessToken(store, creds);
    if (res.ok) return res.value;
    throw Object.assign(new Error(res.error.message), { kind: res.error.kind });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption at rest — AES-256-GCM
// ─────────────────────────────────────────────────────────────────────────────

/** Bytes of IV. 12 is the GCM standard and what every decrypter expects. */
const IV_BYTES = 12;
/** Bytes of GCM auth tag, appended after the ciphertext. */
const TAG_BYTES = 16;
/** Hex characters in a valid `OURA_TOKEN_KEY` (32 bytes). */
export const TOKEN_KEY_HEX_LENGTH = 64;

/**
 * Validate and decode the key. THROWS when it is missing or malformed.
 *
 * Deliberately fatal. Every alternative — a default key, a plaintext fallback,
 * a warning and carry on — ends with Seth's Oura credentials sitting readable
 * on a disk somewhere. Failing here is loud, local, and fixed in ten seconds.
 */
export function tokenKey(keyHex: string | undefined): Buffer {
  if (!keyHex) {
    throw new Error(
      'OURA_TOKEN_KEY is not set. Tokens are never written unencrypted. Generate one with:\n' +
        "  node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"\n" +
        'and put it in .env.local as OURA_TOKEN_KEY.',
    );
  }
  const trimmed = keyHex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length !== TOKEN_KEY_HEX_LENGTH) {
    throw new Error(
      `OURA_TOKEN_KEY must be exactly ${TOKEN_KEY_HEX_LENGTH} hex characters (32 bytes); got ${trimmed.length}.`,
    );
  }
  return Buffer.from(trimmed, 'hex');
}

/**
 * Encrypt a JSON string. Output is base64 of `iv(12) || ciphertext || tag(16)`,
 * a fresh random IV per record — reusing an IV under GCM is catastrophic, so it
 * is generated here and nowhere else.
 */
export function encryptTokens(json: string, keyHex: string | undefined): string {
  const key = tokenKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
}

/**
 * Decrypt a blob produced by `encryptTokens`. Throws on a wrong key or a
 * tampered record — GCM authenticates, so a silent wrong answer is impossible.
 */
export function decryptTokens(blob: string, keyHex: string | undefined): string {
  const key = tokenKey(keyHex);
  const raw = Buffer.from(blob, 'base64');
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('encrypted token blob is too short to be valid');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ct = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Parse a decrypted payload back into `OuraTokens`, rejecting junk. */
export function parseTokens(json: string): OuraTokens {
  const raw = JSON.parse(json) as Partial<OuraTokens>;
  if (typeof raw.access_token !== 'string' || typeof raw.refresh_token !== 'string') {
    throw new Error('stored Oura tokens are missing access_token or refresh_token');
  }
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: Number(raw.expires_at ?? 0),
    ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
    ...(typeof raw.token_type === 'string' ? { token_type: raw.token_type } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FileTokenStore — the CLI and the Mac mini
// ─────────────────────────────────────────────────────────────────────────────

/** Default location for the local encrypted token file. Gitignored. */
export const DEFAULT_TOKEN_FILE = '.oura-tokens.enc';

/**
 * Encrypted JSON on disk. This is what `scripts/oura-auth.ts` writes and what
 * the Mac mini worker reads: no Supabase, no deployment, no network beyond Oura
 * itself.
 *
 * The write is temp-file-plus-rename so a crash mid-write cannot leave a
 * truncated file where a valid refresh token used to be, and the mode is 0600.
 */
export class FileTokenStore implements TokenStore {
  constructor(
    private readonly path: string = DEFAULT_TOKEN_FILE,
    private readonly keyHex: string | undefined = process.env['OURA_TOKEN_KEY'],
  ) {}

  async load(): Promise<OuraTokens | null> {
    let blob: string;
    try {
      blob = await readFile(this.path, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw e;
    }
    if (blob.trim() === '') return null;
    return parseTokens(decryptTokens(blob.trim(), this.keyHex));
  }

  async save(t: OuraTokens): Promise<void> {
    const blob = encryptTokens(JSON.stringify(t), this.keyHex);
    await mkdir(dirname(this.path), { recursive: true }).catch(() => undefined);
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, blob, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.path);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SupabaseTokenStore — the deployed app
// ─────────────────────────────────────────────────────────────────────────────

/** Table the blob lives in. Defined in `supabase/migrations/0001_init.sql`. */
export const INTEGRATION_TOKENS_TABLE = 'integration_tokens';

/**
 * The minimal Supabase-shaped surface this store needs — the same injected
 * client idea as `JobStore` in `llm/jobs.ts`, and structurally satisfied by it.
 * The adapter over `@supabase/supabase-js` lives at the call site; this package
 * does not depend on the SDK.
 */
export interface TokenRowStore {
  select(
    table: string,
    query: { match?: Record<string, unknown>; limit?: number },
  ): Promise<Record<string, unknown>[]>;
  insert(table: string, row: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  update(
    table: string,
    match: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]>;
}

export interface SupabaseTokenStoreOptions {
  store: TokenRowStore;
  /** `public.users.id` — the row owner. */
  userId: string;
  /** 64 hex characters. Defaults to `OURA_TOKEN_KEY`. */
  keyHex?: string | undefined;
  /** Defaults to `'oura'`; the column has a CHECK constraint on the vocabulary. */
  provider?: string;
}

/**
 * Persist the token set as one encrypted blob in `integration_tokens`.
 *
 * ── Column convention ────────────────────────────────────────────────────────
 * The WHOLE token set (access + refresh + expiry + scope) is encrypted into a
 * single blob stored in `access_token`. `refresh_token` stays NULL: two blobs
 * would be two records that can disagree after a rotation, and "the refresh
 * token saved but the access token did not" is exactly the half-written state
 * this design exists to make impossible.
 *
 * `expires_at` and `scope` are ALSO written as plaintext columns. They are not
 * secrets, and having them queryable is what lets the settings screen say "Oura
 * expires in 43 minutes" without holding the key. The blob remains the source
 * of truth; the columns are a read-only mirror.
 *
 * `0008_oura_oauth.sql` documents this on the table itself.
 */
export class SupabaseTokenStore implements TokenStore {
  private readonly store: TokenRowStore;
  private readonly userId: string;
  private readonly keyHex: string | undefined;
  private readonly provider: string;

  constructor(opts: SupabaseTokenStoreOptions) {
    this.store = opts.store;
    this.userId = opts.userId;
    this.keyHex = opts.keyHex ?? process.env['OURA_TOKEN_KEY'];
    this.provider = opts.provider ?? 'oura';
  }

  async load(): Promise<OuraTokens | null> {
    const rows = await this.store.select(INTEGRATION_TOKENS_TABLE, {
      match: { user_id: this.userId, provider: this.provider },
      limit: 1,
    });
    const row = rows[0];
    if (!row) return null;
    const blob = row['access_token'];
    if (typeof blob !== 'string' || blob.trim() === '') return null;
    return parseTokens(decryptTokens(blob.trim(), this.keyHex));
  }

  async save(t: OuraTokens): Promise<void> {
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      access_token: encryptTokens(JSON.stringify(t), this.keyHex),
      // Never a second copy of the secret; the blob above holds it.
      refresh_token: null,
      expires_at: new Date(t.expires_at * 1000).toISOString(),
      scope: t.scope ?? null,
      last_error: null,
      updated_at: nowIso,
    };

    // `unique (user_id, provider)` makes this an upsert in two steps, which is
    // all the injected interface offers. Update first: the steady state after
    // the first connect is a rotation, not an insert.
    const updated = await this.store.update(
      INTEGRATION_TOKENS_TABLE,
      { user_id: this.userId, provider: this.provider },
      patch,
    );
    if (updated.length > 0) return;

    await this.store.insert(INTEGRATION_TOKENS_TABLE, {
      user_id: this.userId,
      provider: this.provider,
      ...patch,
      created_at: nowIso,
    });
  }
}

/**
 * An in-memory store. Handy in tests and for a one-shot script that has already
 * loaded the tokens by other means; never for anything that must survive.
 */
export class MemoryTokenStore implements TokenStore {
  constructor(private tokens: OuraTokens | null = null) {}

  async load(): Promise<OuraTokens | null> {
    return this.tokens;
  }

  async save(t: OuraTokens): Promise<void> {
    this.tokens = t;
  }
}
