/**
 * Oura token rotation — the tests for the code that can kill the connection.
 *
 * `src/oura/tokens.ts` opens with the reason this file exists: Oura's refresh
 * tokens are single use and they rotate, so a mistake here does not degrade the
 * integration, it ENDS it, and the only repair is a human in a browser. Every
 * test below names the failure it is standing in front of.
 *
 * The suite touches no network and no disk it does not own. `TokenRowStore` is
 * a Map, `fetch` is a stub, and the file store writes to a temp directory.
 */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXPIRY_SKEW_SECONDS,
  FileTokenStore,
  MemoryTokenStore,
  SupabaseTokenStore,
  accessTokenGetter,
  decryptTokens,
  encryptTokens,
  getValidAccessToken,
  isExpiring,
  parseTokens,
  type OuraTokens,
  type TokenRowStore,
  type TokenStore,
} from '../src/oura/tokens.js';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const CREDS = { clientId: 'cid', clientSecret: 'secret' };

function tokens(over: Partial<OuraTokens> = {}): OuraTokens {
  return {
    access_token: 'AT-1',
    refresh_token: 'RT-1',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    scope: 'extapi:daily extapi:personal',
    ...over,
  } as OuraTokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption at rest
// ─────────────────────────────────────────────────────────────────────────────

describe('encryption', () => {
  it('round-trips a token set', () => {
    const t = tokens();
    expect(parseTokens(decryptTokens(encryptTokens(JSON.stringify(t), KEY), KEY))).toEqual(t);
  });

  it('never repeats a ciphertext, because the IV is per-record', () => {
    const json = JSON.stringify(tokens());
    expect(encryptTokens(json, KEY)).not.toEqual(encryptTokens(json, KEY));
  });

  it('refuses the wrong key rather than returning garbage', () => {
    const blob = encryptTokens(JSON.stringify(tokens()), KEY);
    expect(() => decryptTokens(blob, OTHER_KEY)).toThrow();
  });

  it('refuses tampered ciphertext — GCM authenticates, it does not just decrypt', () => {
    const blob = encryptTokens(JSON.stringify(tokens()), KEY);
    const flipped = `${blob.slice(0, -4)}${blob.slice(-4) === 'aaaa' ? 'bbbb' : 'aaaa'}`;
    expect(() => decryptTokens(flipped, KEY)).toThrow();
  });

  it('THROWS on a missing key instead of writing plaintext', () => {
    // A plaintext fallback is how a secret ends up in the clear on the one
    // machine nobody remembered to configure.
    expect(() => encryptTokens(JSON.stringify(tokens()), undefined)).toThrow();
    expect(() => encryptTokens(JSON.stringify(tokens()), 'too-short')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Expiry
// ─────────────────────────────────────────────────────────────────────────────

describe('isExpiring', () => {
  const now = 1_000_000;

  it('is false with time to spare', () => {
    expect(isExpiring({ expires_at: now + EXPIRY_SKEW_SECONDS + 1 }, now)).toBe(false);
  });

  it('is true inside the skew window', () => {
    expect(isExpiring({ expires_at: now + EXPIRY_SKEW_SECONDS }, now)).toBe(true);
  });

  it('is true once past', () => {
    expect(isExpiring({ expires_at: now - 1 }, now)).toBe(true);
  });

  it('treats an unreadable expiry as expired', () => {
    // One wasted refresh beats an hour of 401s.
    expect(isExpiring({ expires_at: Number.NaN }, now)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FileTokenStore
// ─────────────────────────────────────────────────────────────────────────────

describe('FileTokenStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'oura-tokens-'));
    file = path.join(dir, 'nested', '.oura-tokens.enc');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips through the filesystem, creating the directory', async () => {
    const store = new FileTokenStore(file, KEY);
    const t = tokens();
    await store.save(t);
    expect(await store.load()).toEqual(t);
  });

  it('writes 0600 — the file holds a live credential', async () => {
    await new FileTokenStore(file, KEY).save(tokens());
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('writes no plaintext token to disk', async () => {
    await new FileTokenStore(file, KEY).save(tokens({ refresh_token: 'RT-SECRET-VALUE' }));
    expect(readFileSync(file, 'utf8')).not.toContain('RT-SECRET-VALUE');
  });

  it('returns null for a file that is not there', async () => {
    expect(await new FileTokenStore(file, KEY).load()).toBeNull();
  });

  it('returns null for an empty file rather than throwing', async () => {
    const empty = path.join(dir, 'empty.enc');
    writeFileSync(empty, '   \n');
    expect(await new FileTokenStore(empty, KEY).load()).toBeNull();
  });

  it('throws on the wrong key — silence here would look like "never connected"', async () => {
    await new FileTokenStore(file, KEY).save(tokens());
    await expect(new FileTokenStore(file, OTHER_KEY).load()).rejects.toThrow();
  });

  it('leaves no temp file behind', async () => {
    await new FileTokenStore(file, KEY).save(tokens());
    expect(() => statSync(`${file}.tmp`)).toThrow();
  });

  it('replaces rather than appends, so a rotation does not accumulate', async () => {
    const store = new FileTokenStore(file, KEY);
    await store.save(tokens({ refresh_token: 'RT-1' }));
    await store.save(tokens({ refresh_token: 'RT-2' }));
    expect((await store.load())?.refresh_token).toBe('RT-2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SupabaseTokenStore
// ─────────────────────────────────────────────────────────────────────────────

/** `integration_tokens` as a Map, honouring `unique (user_id, provider)`. */
function fakeRows(): TokenRowStore & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  const matches = (r: Record<string, unknown>, m: Record<string, unknown>): boolean =>
    Object.entries(m).every(([k, v]) => r[k] === v);
  return {
    rows,
    async select(_table, q) {
      const hits = rows.filter((r) => matches(r, q.match ?? {}));
      return q.limit ? hits.slice(0, q.limit) : hits;
    },
    async insert(_table, row) {
      rows.push({ ...row });
      return row;
    },
    async update(_table, match, patch) {
      const hits = rows.filter((r) => matches(r, match));
      for (const r of hits) Object.assign(r, patch);
      return hits;
    },
  };
}

describe('SupabaseTokenStore', () => {
  const userId = '11111111-1111-1111-1111-111111111111';

  it('round-trips', async () => {
    const store = new SupabaseTokenStore({ store: fakeRows(), userId, keyHex: KEY });
    const t = tokens();
    await store.save(t);
    expect(await store.load()).toEqual(t);
  });

  it('keeps refresh_token NULL — one blob, so the two halves cannot disagree', async () => {
    const rows = fakeRows();
    await new SupabaseTokenStore({ store: rows, userId, keyHex: KEY }).save(tokens());
    expect(rows.rows[0]?.['refresh_token']).toBeNull();
  });

  it('stores no plaintext secret in any column', async () => {
    const rows = fakeRows();
    await new SupabaseTokenStore({ store: rows, userId, keyHex: KEY }).save(
      tokens({ access_token: 'AT-SECRET', refresh_token: 'RT-SECRET' }),
    );
    const dump = JSON.stringify(rows.rows);
    expect(dump).not.toContain('AT-SECRET');
    expect(dump).not.toContain('RT-SECRET');
  });

  it('mirrors expiry and scope as plaintext, so Settings can read them without the key', async () => {
    const rows = fakeRows();
    const t = tokens();
    await new SupabaseTokenStore({ store: rows, userId, keyHex: KEY }).save(t);
    expect(rows.rows[0]?.['expires_at']).toBe(new Date(t.expires_at * 1000).toISOString());
    expect(rows.rows[0]?.['scope']).toBe(t.scope);
  });

  it('upserts — a second save updates the one row, it does not add another', async () => {
    const rows = fakeRows();
    const store = new SupabaseTokenStore({ store: rows, userId, keyHex: KEY });
    await store.save(tokens({ refresh_token: 'RT-1' }));
    await store.save(tokens({ refresh_token: 'RT-2' }));
    expect(rows.rows).toHaveLength(1);
    expect((await store.load())?.refresh_token).toBe('RT-2');
  });

  it('clears last_error on a successful save', async () => {
    const rows = fakeRows();
    await new SupabaseTokenStore({ store: rows, userId, keyHex: KEY }).save(tokens());
    expect(rows.rows[0]?.['last_error']).toBeNull();
  });

  it('keeps one athlete out of another’s row', async () => {
    const rows = fakeRows();
    const other = '22222222-2222-2222-2222-222222222222';
    await new SupabaseTokenStore({ store: rows, userId, keyHex: KEY }).save(
      tokens({ refresh_token: 'RT-SETH' }),
    );
    await new SupabaseTokenStore({ store: rows, userId: other, keyHex: KEY }).save(
      tokens({ refresh_token: 'RT-OTHER' }),
    );
    expect(rows.rows).toHaveLength(2);
    const seth = new SupabaseTokenStore({ store: rows, userId, keyHex: KEY });
    expect((await seth.load())?.refresh_token).toBe('RT-SETH');
  });

  it('returns null when nothing is stored', async () => {
    expect(await new SupabaseTokenStore({ store: fakeRows(), userId, keyHex: KEY }).load()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getValidAccessToken — the part that spends single-use tokens
// ─────────────────────────────────────────────────────────────────────────────

/** A stub `fetch` that answers the token endpoint and counts the calls. */
function stubTokenEndpoint(
  reply: () => { status: number; body: unknown },
): { calls: number; restore: () => void } {
  const state = { calls: 0, restore: () => undefined as void };
  const original = globalThis.fetch;
  const spy = vi.fn(async () => {
    state.calls += 1;
    const { status, body } = reply();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  state.restore = () => {
    globalThis.fetch = original;
  };
  return state;
}

describe('getValidAccessToken', () => {
  const now = 1_000_000;
  let stub: { calls: number; restore: () => void } | undefined;

  afterEach(() => {
    stub?.restore();
    stub = undefined;
  });

  it('does not refresh a token with time left', async () => {
    stub = stubTokenEndpoint(() => ({ status: 500, body: {} }));
    const store = new MemoryTokenStore(tokens({ expires_at: now + 3600 }));
    const res = await getValidAccessToken(store, CREDS, now);
    expect(res.ok && res.value).toBe('AT-1');
    // Refreshing on every call would spend a rotated token per request and
    // multiply the chances of losing one.
    expect(stub.calls).toBe(0);
  });

  it('refreshes inside the skew window and returns the NEW token', async () => {
    stub = stubTokenEndpoint(() => ({
      status: 200,
      body: { access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600, scope: 'extapi:daily' },
    }));
    const store = new MemoryTokenStore(tokens({ expires_at: now + 10 }));
    const res = await getValidAccessToken(store, CREDS, now);
    expect(res.ok && res.value).toBe('AT-2');
    expect(stub.calls).toBe(1);
  });

  it('PERSISTS the rotated set before returning it', async () => {
    // The old refresh token is dead the instant the response arrives. If the
    // process exits before the write lands, the connection is gone.
    const saved: OuraTokens[] = [];
    let returnedBeforeSave = false;
    const store: TokenStore = {
      load: async () => tokens({ expires_at: now + 10 }),
      save: async (t) => {
        saved.push(t);
      },
    };
    stub = stubTokenEndpoint(() => ({
      status: 200,
      body: { access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600 },
    }));
    const res = await getValidAccessToken(store, CREDS, now);
    if (res.ok && saved.length === 0) returnedBeforeSave = true;
    expect(returnedBeforeSave).toBe(false);
    expect(saved[0]?.refresh_token).toBe('RT-2');
  });

  it('reports needs_reauth when the rotated set cannot be saved', async () => {
    // Refreshed but not written is the worst case: the old token is spent and
    // the new one is lost. It must say so rather than hand back a token that
    // works once.
    const store: TokenStore = {
      load: async () => tokens({ expires_at: now + 10 }),
      save: async () => {
        throw new Error('disk full');
      },
    };
    stub = stubTokenEndpoint(() => ({
      status: 200,
      body: { access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600 },
    }));
    const res = await getValidAccessToken(store, CREDS, now);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.kind).toBe('needs_reauth');
    expect(!res.ok && res.error.message).toMatch(/could NOT be saved/i);
  });

  it('never retries invalid_grant', async () => {
    // The refresh token is spent either way; a second attempt only makes the
    // logs harder to read.
    stub = stubTokenEndpoint(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    const store = new MemoryTokenStore(tokens({ expires_at: now + 10 }));
    const res = await getValidAccessToken(store, CREDS, now);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.kind).toBe('needs_reauth');
    expect(stub.calls).toBe(1);
  });

  it('single-flights: two concurrent callers cause ONE refresh', async () => {
    // The loser of a race presents a token the winner already spent, gets
    // invalid_grant, and kills a connection that was working.
    stub = stubTokenEndpoint(() => ({
      status: 200,
      body: { access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600 },
    }));
    const store = new MemoryTokenStore(tokens({ expires_at: now + 10 }));
    const [a, b] = await Promise.all([
      getValidAccessToken(store, CREDS, now),
      getValidAccessToken(store, CREDS, now),
    ]);
    expect(stub.calls).toBe(1);
    expect(a.ok && a.value).toBe('AT-2');
    expect(b.ok && b.value).toBe('AT-2');
  });

  it('refreshes again on a later call — the lock is per-flight, not a cache', async () => {
    // Two things this test has to respect. `expires_in` becomes an ABSOLUTE
    // `expires_at` against the real clock, so the injected `now` must be the
    // real one or the new token looks decades fresh. And `expires_in: 0` is
    // read as absurd and replaced with an hour — deliberately, since a missing
    // or nonsense lifetime should not mean "expired" — so the way to get a
    // token that is immediately due again is one INSIDE the skew window.
    const realNow = Math.floor(Date.now() / 1000);
    stub = stubTokenEndpoint(() => ({
      status: 200,
      body: {
        access_token: 'AT-2',
        refresh_token: 'RT-2',
        expires_in: EXPIRY_SKEW_SECONDS - 60,
      },
    }));
    const store = new MemoryTokenStore(tokens({ expires_at: realNow + 10 }));
    await getValidAccessToken(store, CREDS, realNow);
    await getValidAccessToken(store, CREDS, realNow);
    expect(stub.calls).toBe(2);
  });

  it('says "connect Oura" when nothing is stored, not "auth failed"', async () => {
    const res = await getValidAccessToken(new MemoryTokenStore(null), CREDS, now);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.kind).toBe('needs_reauth');
    expect(!res.ok && res.error.message).toMatch(/oura-auth|connect Oura/i);
  });

  it('calls a bad key a configuration fault, not a dead grant', async () => {
    // Re-authorising in a browser would not fix a wrong OURA_TOKEN_KEY, so
    // telling someone to do that would send them down the wrong path.
    const store: TokenStore = {
      load: async () => {
        throw new Error('Unsupported state or unable to authenticate data');
      },
      save: async () => undefined,
    };
    const res = await getValidAccessToken(store, CREDS, now);
    expect(!res.ok && res.error.kind).toBe('auth');
  });
});

describe('accessTokenGetter', () => {
  it('hands the plain string to OuraClient', async () => {
    const get = accessTokenGetter(new MemoryTokenStore(tokens()), CREDS);
    expect(await get()).toBe('AT-1');
  });

  it('rejects with the kind attached, so the client can re-raise it faithfully', async () => {
    const get = accessTokenGetter(new MemoryTokenStore(null), CREDS);
    await expect(get()).rejects.toMatchObject({ kind: 'needs_reauth' });
  });
});
