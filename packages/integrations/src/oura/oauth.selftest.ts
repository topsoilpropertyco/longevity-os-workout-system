/**
 * Offline self-test for the Oura OAuth2 layer.
 *
 *   npx tsx packages/integrations/src/oura/oauth.selftest.ts
 *
 * No network, no credentials, no Oura account: `globalThis.fetch` is replaced
 * with a stub for the few cases that need a token endpoint. It covers the three
 * things most likely to be quietly wrong —
 *
 *   1. PKCE: the verifier's length and charset, and that the challenge really
 *      is base64url(SHA-256(verifier)) rather than of the raw bytes.
 *   2. The AES-256-GCM round trip, that a missing key is fatal rather than a
 *      plaintext fallback, and that the IV is fresh per record.
 *   3. The expiry/skew rule and the rotation contract: refresh only inside the
 *      skew, SAVE BEFORE RETURNING, single flight, and `invalid_grant` →
 *      `needs_reauth` with no retry.
 *
 * This package has no test runner of its own (`npm test` runs the engine's
 * vitest suite), so it is a plain `node:assert` script that exits non-zero.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  OURA_ENDPOINTS,
  OURA_SCOPES,
  buildAuthUrl,
  classifyOAuthError,
  generatePkce,
  generateState,
  normalizeTokens,
  statesMatch,
  type OuraTokens,
} from './oauth.js';
import {
  EXPIRY_SKEW_SECONDS,
  MemoryTokenStore,
  decryptTokens,
  encryptTokens,
  getValidAccessToken,
  isExpiring,
  type TokenStore,
} from './tokens.js';

let failures = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        console.log(`  ✓ ${name}`);
      },
      (e: unknown) => {
        failures += 1;
        console.error(`  ✗ ${name}\n      ${e instanceof Error ? e.message : String(e)}`);
      },
    );
}

const KEY_A = 'a'.repeat(64);
const KEY_B = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** base64url of the SHA-256 of a string, computed independently of oauth.ts. */
function expectedChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function tokenResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function main(): Promise<void> {
  console.log('Oura OAuth self-test\n');

  // ── 1. PKCE ────────────────────────────────────────────────────────────────

  await test('generatePkce: verifier is 64 base64url characters', () => {
    const { verifier } = generatePkce();
    assert.equal(verifier.length, 64, `expected 64 chars, got ${verifier.length}`);
    assert.match(verifier, /^[A-Za-z0-9\-_]{64}$/, 'verifier must be unpadded base64url');
  });

  await test('generatePkce: challenge is base64url(SHA-256(verifier))', () => {
    const { verifier, challenge } = generatePkce();
    assert.equal(challenge, expectedChallenge(verifier));
    assert.match(challenge, /^[A-Za-z0-9\-_]{43}$/, 'S256 challenge is 43 base64url chars');
  });

  await test('generatePkce: every pair is unique', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePkce().verifier));
    assert.equal(seen.size, 200);
  });

  await test('statesMatch: equal matches, different and empty do not', () => {
    const s = generateState();
    assert.equal(statesMatch(s, s), true);
    assert.equal(statesMatch(s, `${s}x`), false);
    assert.equal(statesMatch(s, null), false);
    assert.equal(statesMatch('', ''), false);
  });

  await test('buildAuthUrl: S256, code, and namespaced extapi scopes', () => {
    const { challenge } = generatePkce();
    const url = new URL(
      buildAuthUrl({
        clientId: 'CID',
        redirectUri: 'http://localhost:3000/api/oura/callback',
        state: 'STATE',
        codeChallenge: challenge,
      }),
    );
    assert.equal(`${url.origin}${url.pathname}`, OURA_ENDPOINTS.authorize);
    assert.ok(url.origin.includes('moi.ouraring.com'), 'must NOT use the legacy cloud.ouraring.com host');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), challenge);
    assert.equal(url.searchParams.get('state'), 'STATE');
    assert.equal(url.searchParams.get('scope'), OURA_SCOPES.join(' '));
    for (const s of OURA_SCOPES) assert.ok(s.startsWith('extapi:'), `${s} must be namespaced`);
  });

  // ── 2. AES-256-GCM ─────────────────────────────────────────────────────────

  await test('encrypt/decrypt: exact round trip', () => {
    const json = JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_at: 1 });
    assert.equal(decryptTokens(encryptTokens(json, KEY_A), KEY_A), json);
  });

  await test('encrypt: fresh IV per record, so two blobs never match', () => {
    const json = '{"a":1}';
    assert.notEqual(encryptTokens(json, KEY_A), encryptTokens(json, KEY_A));
  });

  await test('encrypt: throws with no key — never a plaintext fallback', () => {
    assert.throws(() => encryptTokens('{}', undefined), /OURA_TOKEN_KEY is not set/);
    assert.throws(() => encryptTokens('{}', ''), /OURA_TOKEN_KEY is not set/);
  });

  await test('encrypt: throws on a malformed key', () => {
    assert.throws(() => encryptTokens('{}', 'abc'), /64 hex characters/);
    assert.throws(() => encryptTokens('{}', 'z'.repeat(64)), /64 hex characters/);
  });

  await test('decrypt: wrong key fails loudly (GCM authenticates)', () => {
    const blob = encryptTokens('{"a":1}', KEY_A);
    assert.throws(() => decryptTokens(blob, KEY_B));
  });

  await test('decrypt: a tampered blob fails', () => {
    const raw = Buffer.from(encryptTokens('{"a":1}', KEY_A), 'base64');
    const i = raw.length - 20;
    // `noUncheckedIndexedAccess` types raw[i] as possibly undefined, and a
    // compound assignment on it does not narrow. Read, flip, write back.
    raw[i] = (raw[i] ?? 0) ^ 0xff; // flip a ciphertext bit, leave the tag alone
    assert.throws(() => decryptTokens(raw.toString('base64'), KEY_A));
  });

  // ── 3. Expiry and the rotation contract ────────────────────────────────────

  await test('normalizeTokens: expires_in becomes an ABSOLUTE expires_at', () => {
    const r = normalizeTokens({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }, 1_000_000);
    assert.ok(r.ok);
    assert.equal(r.value.expires_at, 1_003_600);
  });

  await test('normalizeTokens: a set with no refresh_token is rejected', () => {
    const r = normalizeTokens({ access_token: 'a', expires_in: 3600 }, 0);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error.message, /refresh_token/);
  });

  await test('isExpiring: the 120s skew boundary', () => {
    const now = 1_000_000;
    assert.equal(isExpiring({ expires_at: now + EXPIRY_SKEW_SECONDS + 1 }, now), false, 'outside the skew');
    assert.equal(isExpiring({ expires_at: now + EXPIRY_SKEW_SECONDS }, now), true, 'exactly on the boundary');
    assert.equal(isExpiring({ expires_at: now + 60 }, now), true, 'inside the skew');
    assert.equal(isExpiring({ expires_at: now - 1 }, now), true, 'already expired');
    assert.equal(isExpiring({ expires_at: now + 3600 }, now), false, 'an hour of life left');
    assert.equal(isExpiring({ expires_at: Number.NaN }, now), true, 'unreadable expiry counts as expired');
  });

  await test('getValidAccessToken: does NOT refresh a healthy token', async () => {
    const now = 1_000_000;
    const store = new MemoryTokenStore({
      access_token: 'fresh', refresh_token: 'r1', expires_at: now + 3600,
    });
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { calls += 1; return tokenResponse({}); }) as typeof fetch;
    try {
      const r = await getValidAccessToken(store, { clientId: 'c', clientSecret: 's' }, now);
      assert.ok(r.ok);
      assert.equal(r.value, 'fresh');
      assert.equal(calls, 0, 'the token endpoint must not be touched');
    } finally {
      globalThis.fetch = original;
    }
  });

  await test('getValidAccessToken: refreshes inside the skew and SAVES BEFORE RETURNING', async () => {
    const now = 1_000_000;
    const saved: OuraTokens[] = [];
    let returnedBeforeSave = false;
    const inner = new MemoryTokenStore({
      access_token: 'old', refresh_token: 'r1', expires_at: now + 30,
    });
    const store: TokenStore = {
      load: () => inner.load(),
      save: async (t) => {
        // A real store is slow; the contract is that the caller waits for it.
        await new Promise((res) => setTimeout(res, 5));
        saved.push(t);
        await inner.save(t);
      },
    };

    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      tokenResponse({ access_token: 'new', refresh_token: 'r2', expires_in: 3600, scope: 'extapi:daily' })
    ) as typeof fetch;
    try {
      const r = await getValidAccessToken(store, { clientId: 'c', clientSecret: 's' }, now);
      if (saved.length === 0) returnedBeforeSave = true;
      assert.ok(r.ok);
      assert.equal(r.value, 'new');
      assert.equal(returnedBeforeSave, false, 'the token was returned before the save resolved');
      assert.equal(saved.length, 1);
      assert.equal(saved[0]?.refresh_token, 'r2', 'the ROTATED refresh token must be what is stored');
      // `now` only decides staleness; the new expiry is anchored to the REAL
      // clock at the moment the response arrived, which is the correct source
      // for an absolute timestamp that outlives this process.
      const realNow = Math.floor(Date.now() / 1000);
      const drift = Math.abs((saved[0]?.expires_at ?? 0) - (realNow + 3600));
      assert.ok(drift <= 2, `expires_at should be ~now+3600, drifted ${drift}s`);
    } finally {
      globalThis.fetch = original;
    }
  });

  await test('getValidAccessToken: single flight — 5 concurrent callers, 1 refresh', async () => {
    const now = 1_000_000;
    const store = new MemoryTokenStore({
      access_token: 'old', refresh_token: 'r1', expires_at: now - 10,
    });
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      await new Promise((res) => setTimeout(res, 10));
      return tokenResponse({ access_token: `new${calls}`, refresh_token: `r${calls + 1}`, expires_in: 3600 });
    }) as typeof fetch;
    try {
      const out = await Promise.all(
        Array.from({ length: 5 }, () => getValidAccessToken(store, { clientId: 'c', clientSecret: 's' }, now)),
      );
      assert.equal(calls, 1, `expected exactly one refresh, got ${calls} — a rotation race`);
      for (const r of out) {
        assert.ok(r.ok);
        assert.equal(r.value, 'new1');
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  await test('getValidAccessToken: invalid_grant → needs_reauth, and is not retried', async () => {
    const now = 1_000_000;
    const store = new MemoryTokenStore({
      access_token: 'old', refresh_token: 'spent', expires_at: now - 10,
    });
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return tokenResponse({ error: 'invalid_grant', error_description: 'token already used' }, 400);
    }) as typeof fetch;
    try {
      const r = await getValidAccessToken(store, { clientId: 'c', clientSecret: 's' }, now);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error.kind, 'needs_reauth');
      assert.equal(calls, 1, 'a spent refresh token must be presented exactly once');
    } finally {
      globalThis.fetch = original;
    }
  });

  await test('getValidAccessToken: an empty store asks for re-auth, it does not crash', async () => {
    const r = await getValidAccessToken(new MemoryTokenStore(null), { clientId: 'c', clientSecret: 's' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, 'needs_reauth');
  });

  await test('getValidAccessToken: a failed save reports needs_reauth, never success', async () => {
    const now = 1_000_000;
    const store: TokenStore = {
      load: async () => ({ access_token: 'old', refresh_token: 'r1', expires_at: now - 10 }),
      save: async () => { throw new Error('disk full'); },
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      tokenResponse({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 })
    ) as typeof fetch;
    try {
      const r = await getValidAccessToken(store, { clientId: 'c', clientSecret: 's' }, now);
      assert.equal(r.ok, false, 'returning a token whose rotation was not persisted is the bug');
      if (!r.ok) assert.equal(r.error.kind, 'needs_reauth');
    } finally {
      globalThis.fetch = original;
    }
  });

  await test('classifyOAuthError: invalid_client names the moi.ouraring.com trap', () => {
    const e = classifyOAuthError({
      kind: 'client', message: 'POST → 401', status: 401,
      detail: '{"error":"invalid_client"}',
    });
    assert.equal(e.kind, 'auth');
    assert.match(e.message, /moi\.ouraring\.com/);
  });

  console.log(failures === 0 ? '\nAll Oura OAuth self-tests passed.\n' : `\n${failures} failing.\n`);
  if (failures > 0) process.exit(1);
}

void main();
