/**
 * OURA-PUSH-TOKENS — move a working Oura connection into Supabase
 *
 * `scripts/oura-auth.ts` does the browser dance and writes the token set to
 * `.oura-tokens.enc` on this machine. That is the right place for it while
 * everything runs here — but the deployed app cannot read a file on a laptop,
 * so it reads `integration_tokens` instead. This copies one into the other, so
 * the connection Seth already made keeps working after the first deploy rather
 * than having to be made a second time.
 *
 * ── The thing that makes this delicate ───────────────────────────────────────
 * Oura's refresh tokens are SINGLE USE and rotate: every refresh invalidates
 * the old one. Two processes holding the same token set will race, and the one
 * that refreshes second presents a token that no longer exists, gets
 * `invalid_grant`, and the integration is dead until somebody re-authorises in
 * a browser. It looks like a random outage and it keeps happening.
 *
 * So this is a MOVE, not a copy. Once the tokens are in Supabase, the local
 * file is renamed to `.oura-tokens.enc.migrated` — kept, because throwing away
 * the only copy of a credential on the strength of one network call would be
 * reckless, but out of the way, so nothing picks it up and starts refreshing
 * against the same grant. `--keep` overrides that, and says out loud what it is
 * signing up for.
 *
 * Both stores are encrypted with the SAME `OURA_TOKEN_KEY`. If the deployment
 * is ever given a different key, it will not be able to read what this wrote —
 * so the key goes into Vercel's environment unchanged, and the script checks
 * that it can decrypt what it just claimed to write before it moves anything.
 *
 * Usage:
 *   npx tsx scripts/oura-push-tokens.ts --user <uuid>
 *   npx tsx scripts/oura-push-tokens.ts --user <uuid> --keep
 *   npx tsx scripts/oura-push-tokens.ts --user <uuid> --dry-run
 */

import { readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_TOKEN_FILE,
  FileTokenStore,
  SupabaseTokenStore,
  type OuraTokens,
  type TokenRowStore,
} from '@longevity/integrations';
import { PATHS } from './lib/paths.js';

// ─────────────────────────────────────────────────────────────────────────────
// Environment — same twelve-line reader as scripts/seed-supabase.ts
// ─────────────────────────────────────────────────────────────────────────────

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(path.join(PATHS.root, '.env.local'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (process.env[key] !== undefined) continue;
    let value = m[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** The ~25 lines that keep `@longevity/integrations` free of the Supabase SDK. */
function rowStore(sb: SupabaseClient): TokenRowStore {
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

// ─────────────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  return process.argv[process.argv.indexOf(hit) + 1];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Never the token itself — only enough to recognise it. */
function describe(t: OuraTokens): string {
  const secondsLeft = t.expires_at - Math.floor(Date.now() / 1000);
  const when =
    secondsLeft <= 0
      ? 'expired — the deployment will refresh it on first use'
      : `expires in ${Math.round(secondsLeft / 60)} min`;
  const scopes = (t.scope ?? '').split(/\s+/).filter(Boolean);
  return `${scopes.length} scope${scopes.length === 1 ? '' : 's'} · ${when}`;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const userId = arg('user');
  const dryRun = process.argv.includes('--dry-run');
  const keep = process.argv.includes('--keep');

  if (!userId || !UUID.test(userId)) {
    process.stderr.write(
      '--user wants the uuid from public.users.\n\n' +
        'Find it in the Supabase table editor, or with:\n' +
        '  select id, email from public.users;\n',
    );
    process.exit(2);
  }

  const keyHex = process.env['OURA_TOKEN_KEY'];
  if (!keyHex) {
    process.stderr.write(
      'OURA_TOKEN_KEY is not set, so the tokens on disk cannot be decrypted.\n' +
        'It is in .env.local, written by scripts/oura-auth.ts.\n',
    );
    process.exit(2);
  }

  // `resolve`, not `join`: OURA_TOKEN_FILE may be absolute, and `join` would
  // happily produce `<repo>/Users/seth/...` out of one.
  const tokenFile = path.resolve(PATHS.root, process.env['OURA_TOKEN_FILE'] ?? DEFAULT_TOKEN_FILE);
  const file = new FileTokenStore(tokenFile, keyHex);

  let tokens: OuraTokens | null;
  try {
    tokens = await file.load();
  } catch (e) {
    process.stderr.write(
      `${tokenFile} could not be decrypted: ${e instanceof Error ? e.message : String(e)}\n\n` +
        'Usually this means OURA_TOKEN_KEY is not the key the file was written\n' +
        'with. If the key is genuinely lost, re-run scripts/oura-auth.ts.\n',
    );
    process.exit(1);
  }

  if (!tokens) {
    process.stderr.write(
      `No Oura tokens at ${tokenFile}.\n\n` +
        'Connect the ring on this machine first:\n' +
        '  npx tsx scripts/oura-auth.ts\n',
    );
    process.exit(1);
  }

  process.stdout.write(`Longevity OS — push Oura tokens to Supabase\n\n  local  ${describe(tokens)}\n`);

  if (dryRun) {
    process.stdout.write(`\n  --dry-run: nothing was written, and ${path.basename(tokenFile)} was not moved.\n`);
    return;
  }

  const url = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  if (!url || !key) {
    process.stderr.write(
      '\nSUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Both are in the\n' +
        'Supabase dashboard under Settings → API. `integration_tokens` is\n' +
        'deliberately not granted to the browser roles, so the anon key cannot\n' +
        'write here.\n',
    );
    process.exit(2);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const remote = new SupabaseTokenStore({ store: rowStore(sb), userId, keyHex });

  // Refuse to clobber a NEWER connection. If the deployment has already been
  // reconnected in a browser, its refresh token is the live one and this file's
  // is stale — writing it back would revoke the working grant.
  const existing = await remote.load().catch(() => null);
  if (existing && existing.expires_at > tokens.expires_at) {
    process.stderr.write(
      `\nSupabase already holds a NEWER Oura token set (${describe(existing)}).\n\n` +
        'That means the ring has been reconnected somewhere else since this file\n' +
        'was written. Oura refresh tokens are single use: overwriting the newer\n' +
        'set with this older one would kill the working connection. Nothing was\n' +
        'written.\n',
    );
    process.exit(1);
  }

  await remote.save(tokens);

  // Read it back through a FRESH store — a save that cannot be decrypted again
  // is a connection that will fail at 6:30 tomorrow morning instead of now.
  const readBack = await new SupabaseTokenStore({ store: rowStore(sb), userId, keyHex }).load();
  if (!readBack || readBack.refresh_token !== tokens.refresh_token) {
    process.stderr.write(
      '\nThe tokens were written but did not read back identically. Nothing was\n' +
        'moved locally, so the working connection on this machine is untouched.\n',
    );
    process.exit(1);
  }

  process.stdout.write(`  remote ${describe(readBack)}  ✓ read back and verified\n`);

  if (keep) {
    process.stdout.write(
      `\n  --keep: ${path.basename(tokenFile)} left in place.\n` +
        '  Both copies now share one grant. Whichever refreshes second will get\n' +
        '  invalid_grant and the connection will need re-authorising in a browser.\n' +
        '  Only do this if you are about to delete one of them by hand.\n',
    );
  } else {
    const parked = `${tokenFile}.migrated`;
    renameSync(tokenFile, parked);
    process.stdout.write(
      `\n  moved ${path.basename(tokenFile)} → ${path.basename(parked)}\n` +
        '  Supabase is the live copy now. The old file is kept, but renamed so\n' +
        '  nothing refreshes against the same grant twice.\n',
    );
  }

  process.stdout.write(
    '\n  Set these in the deployment, with OURA_TOKEN_KEY exactly as it is here:\n' +
      '    OURA_CLIENT_ID · OURA_CLIENT_SECRET · OURA_TOKEN_KEY · LONGEVITY_USER_ID\n',
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`\n${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
