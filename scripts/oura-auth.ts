/**
 * Longevity OS — connect Oura (OAuth2 + PKCE)
 *
 *   npx tsx scripts/oura-auth.ts
 *
 * This is the whole Oura setup. No deployment, no Supabase, no database: run
 * it on a laptop, paste two values from the Oura developer portal, open one
 * URL, and it writes an encrypted token file this repo can use immediately.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Oura RETIRED PERSONAL ACCESS TOKENS IN DECEMBER 2025. New ones cannot be
 * created, so a single user reading their own ring now has to do the full OAuth
 * dance. This script is that dance, reduced to as few human steps as it can be.
 *
 * ── What it writes ───────────────────────────────────────────────────────────
 *   .env.local          OURA_CLIENT_ID / OURA_CLIENT_SECRET / OURA_REDIRECT_URI
 *                       / OURA_TOKEN_KEY — created if absent, other keys left
 *                       alone, chmod 600.
 *   .oura-tokens.enc    the token set, AES-256-GCM. Never plaintext.
 *
 * Both are gitignored. Re-running is safe and, once .env.local exists, silent.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import { chmodSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Paths and small console helpers
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env.local');
const TOKEN_FILE = join(ROOT, '.oura-tokens.enc');
const GITIGNORE = join(ROOT, '.gitignore');
const TOKEN_FILE_ENTRY = '.oura-tokens.enc';

const DEFAULT_REDIRECT = 'http://localhost:3000/api/oura/callback';

let step = 0;
/** Numbered heading. Seth reads this on a phone; keep every line short. */
function heading(text: string): void {
  step += 1;
  console.log(`\n${step}. ${text}`);
}
function say(text = ''): void {
  console.log(text ? `   ${text}` : '');
}
/** One sentence saying exactly what to run next, then stop. */
function stop(problem: string, doThis: string): never {
  console.error(`\n✗ ${problem}`);
  console.error(`  Do this: ${doThis}\n`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Preflight — fail in plain English, never with a stack trace
// ─────────────────────────────────────────────────────────────────────────────

function preflight(): void {
  heading('Checking this machine');

  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < 20) {
    stop(
      `Node ${process.versions.node} is too old; this needs Node 20 or newer.`,
      'install Node 20+ from https://nodejs.org (or `brew install node`), then run this again.',
    );
  }
  say(`Node ${process.versions.node} — ok`);

  const pkgPath = join(ROOT, 'package.json');
  let pkgName = '';
  try {
    pkgName = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string }).name ?? '';
  } catch {
    pkgName = '';
  }
  if (pkgName !== 'longevity-os') {
    stop(
      'This is not being run from inside the longevity-os project.',
      'cd into the longevity-os folder (the one containing package.json) and run `npx tsx scripts/oura-auth.ts` again.',
    );
  }
  say('Project — longevity-os');

  if (!existsSync(join(ROOT, 'node_modules'))) {
    stop(
      'Dependencies are not installed, so the Oura code cannot be loaded.',
      'run `npm install` in the longevity-os folder, then run this again.',
    );
  }
  say('Dependencies — installed');
}

// ─────────────────────────────────────────────────────────────────────────────
// .env.local reading and writing
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal dotenv parse: `KEY=value`, optional quotes, `#` comments. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Update or append keys in `.env.local`, preserving every other line — comments,
 * ordering and unrelated credentials included. A rewrite that loses Seth's
 * Supabase keys would be a far worse bug than anything Oura can do to him.
 */
function writeEnvKeys(path: string, updates: Record<string, string>): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = existing === '' ? [] : existing.split(/\r?\n/);
  const remaining = { ...updates };

  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return line;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in remaining)) return line;
    const value = remaining[key] as string;
    delete remaining[key];
    return `${key}=${value}`;
  });

  const appended = Object.entries(remaining);
  if (appended.length > 0) {
    if (next.length > 0 && (next[next.length - 1] ?? '').trim() !== '') next.push('');
    next.push('# ── Oura (written by scripts/oura-auth.ts) ─────────────────────────────────');
    for (const [k, v] of appended) next.push(`${k}=${v}`);
  }

  writeFileSync(path, `${next.join('\n').replace(/\n+$/, '')}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Non-POSIX filesystem. The file is written either way.
  }
}

/** Keep the encrypted token file out of git without asking Seth to edit a file. */
function ensureGitignored(): void {
  try {
    if (!existsSync(GITIGNORE)) return;
    const body = readFileSync(GITIGNORE, 'utf8');
    if (body.split(/\r?\n/).some((l) => l.trim() === TOKEN_FILE_ENTRY)) return;
    appendFileSync(GITIGNORE, `\n# Oura OAuth tokens, AES-256-GCM (scripts/oura-auth.ts)\n${TOKEN_FILE_ENTRY}\n`);
    say(`Added ${TOKEN_FILE_ENTRY} to .gitignore`);
  } catch {
    say(`⚠️  Could not update .gitignore — add a line reading ${TOKEN_FILE_ENTRY} to it.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// stdin
// ─────────────────────────────────────────────────────────────────────────────

const interactive = process.stdin.isTTY === true;

/** readline's private echo hook, used to not print a secret as it is typed. */
interface MutableInterface extends Interface {
  _writeToOutput?: (s: string) => void;
  output?: NodeJS.WritableStream;
}

async function ask(rl: Interface, query: string): Promise<string> {
  return (await rl.question(`   ${query}`)).trim();
}

/** Same as `ask`, but the typed characters are not echoed. */
async function askSecret(rl: Interface, query: string): Promise<string> {
  const iface = rl as MutableInterface;
  let mute = false;
  iface._writeToOutput = (s: string): void => {
    if (!mute) iface.output?.write(s);
  };
  const pending = rl.question(`   ${query}`);
  mute = true;
  const answer = await pending;
  mute = false;
  delete iface._writeToOutput;
  process.stdout.write('\n');
  return answer.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────────────

/** True when something is already listening on `port`. */
function portInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ port, host });
    const finish = (busy: boolean): void => {
      socket.destroy();
      done(busy);
    };
    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** The first free port at or after `from`, so the advice is concrete. */
async function nextFreePort(from: number): Promise<number> {
  for (let p = from + 1; p < from + 40; p += 1) {
    if (!(await portInUse(p))) return p;
  }
  return from + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// The redirect capture
// ─────────────────────────────────────────────────────────────────────────────

interface Redirect {
  code: string;
  state: string | null;
}

/**
 * One-shot listener on the redirect URI's own port. Answers exactly one
 * request, serves a plain "you can close this tab" page, and shuts down.
 */
function waitForRedirect(port: number, pathname: string): Promise<Redirect> {
  return new Promise((done, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname !== pathname) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not the Oura callback.\n');
        return;
      }
      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>Oura</title><body style="font:17px system-ui;padding:3rem 1.5rem;text-align:center">` +
          // Deliberately not "connected": the code still has to be exchanged,
          // and the terminal is the only place that knows whether it worked.
          `<p>${err || !code ? 'Oura did not grant access.' : 'Oura sent the code back.'}</p>` +
          `<p>You can close this tab — the rest happens in the terminal.</p></body>`,
      );
      server.close();
      if (err) reject(new Error(`Oura returned "${err}" — access was not granted.`));
      else if (!code) reject(new Error('The redirect carried no authorization code.'));
      else done({ code, state: url.searchParams.get('state') });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1');
  });
}

/** Pull the code and state out of a pasted redirect URL (or a bare code). */
function parsePastedRedirect(pasted: string): Redirect {
  const text = pasted.trim();
  if (text === '') throw new Error('Nothing was pasted.');
  if (!text.includes('?') && !text.includes('code=')) return { code: text, state: null };
  const qs = text.slice(text.indexOf('?') + 1);
  const params = new URLSearchParams(qs);
  const err = params.get('error');
  if (err) throw new Error(`Oura returned "${err}" — access was not granted.`);
  const code = params.get('code');
  if (!code) throw new Error('That URL has no `code=` in it. Copy the WHOLE address bar after redirecting.');
  return { code, state: params.get('state') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\nConnect Oura — Longevity OS');
  console.log('Oura retired personal access tokens in December 2025, so this is now an OAuth sign-in.');

  preflight();

  // Imported only after the node_modules check, so a missing install produces
  // the sentence above instead of a module-not-found stack trace.
  const oauth = await import('../packages/integrations/src/oura/oauth.js');
  const tokensMod = await import('../packages/integrations/src/oura/tokens.js');
  const { OuraClient } = await import('../packages/integrations/src/oura/client.js');

  // ── 2. Credentials ─────────────────────────────────────────────────────────
  heading('Oura app credentials');

  const fileEnv = readEnvFile(ENV_FILE);
  const fromEnv = (key: string): string =>
    (process.env[key] ?? fileEnv[key] ?? '').trim();

  let clientId = fromEnv('OURA_CLIENT_ID');
  let clientSecret = fromEnv('OURA_CLIENT_SECRET');
  let redirectUri = fromEnv('OURA_REDIRECT_URI');
  let tokenKey = fromEnv('OURA_TOKEN_KEY');

  const needsPrompt = !clientId || !clientSecret;
  if (needsPrompt && !interactive) {
    stop(
      'OURA_CLIENT_ID and OURA_CLIENT_SECRET are not set, and there is no terminal to ask on.',
      'add OURA_CLIENT_ID and OURA_CLIENT_SECRET to .env.local (from https://cloud.ouraring.com/oauth/applications), then run this again.',
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
  const pending: Record<string, string> = {};

  try {
    if (needsPrompt) {
      say('Open https://cloud.ouraring.com/oauth/applications and create an application.');
      say(`Set its redirect URI to:  ${redirectUri || DEFAULT_REDIRECT}`);
      say('Then paste the two values it gives you.');
      say();
      if (!clientId) {
        clientId = await ask(rl, 'Client ID: ');
        if (!clientId) stop('No client ID was entered.', 'run this again and paste the Client ID from the Oura app page.');
        pending['OURA_CLIENT_ID'] = clientId;
      }
      if (!clientSecret) {
        clientSecret = await askSecret(rl, 'Client secret (hidden as you type): ');
        if (!clientSecret) stop('No client secret was entered.', 'run this again and paste the Client Secret from the Oura app page.');
        pending['OURA_CLIENT_SECRET'] = clientSecret;
      }
      if (!redirectUri) {
        const answer = await ask(rl, `Redirect URI [${DEFAULT_REDIRECT}] (press Enter to accept): `);
        redirectUri = answer || DEFAULT_REDIRECT;
        pending['OURA_REDIRECT_URI'] = redirectUri;
      }
    }

    if (!redirectUri) {
      redirectUri = DEFAULT_REDIRECT;
      pending['OURA_REDIRECT_URI'] = redirectUri;
    }

    say(`Client ID     ${clientId}`);
    say(`Client secret ${mask(clientSecret)}`);
    say(`Redirect URI  ${redirectUri}`);

    // ── 3. Encryption key ────────────────────────────────────────────────────
    heading('Encryption key');
    if (tokenKey) {
      say('OURA_TOKEN_KEY is already set — reusing it.');
    } else {
      tokenKey = randomBytes(32).toString('hex');
      pending['OURA_TOKEN_KEY'] = tokenKey;
      say('Generated a new OURA_TOKEN_KEY and saved it to .env.local.');
      say('It never needs to be typed. Tokens are never written unencrypted.');
    }

    if (Object.keys(pending).length > 0) {
      writeEnvKeys(ENV_FILE, pending);
      say(`Wrote ${Object.keys(pending).join(', ')} to .env.local (permissions 600).`);
    }
    ensureGitignored();

    // ── 4. Authorize ─────────────────────────────────────────────────────────
    heading('Approve access in a browser');

    let parsedRedirect: URL | null = null;
    try {
      parsedRedirect = new URL(redirectUri);
    } catch {
      stop(
        `OURA_REDIRECT_URI is not a valid URL: ${redirectUri}`,
        `edit .env.local and set OURA_REDIRECT_URI=${DEFAULT_REDIRECT}, then run this again.`,
      );
    }

    const isLocal =
      parsedRedirect.hostname === 'localhost' || parsedRedirect.hostname === '127.0.0.1';
    const port = Number(parsedRedirect.port || (parsedRedirect.protocol === 'https:' ? 443 : 80));

    if (isLocal && (await portInUse(port))) {
      const free = await nextFreePort(port);
      stop(
        `Port ${port} is already in use, so this script cannot catch the redirect (it is probably \`npm run dev\`).`,
        `stop whatever is using port ${port} and run this again — or set OURA_REDIRECT_URI=http://localhost:${free}${parsedRedirect.pathname} ` +
          `in .env.local AND on the Oura application page (they must match exactly), then run this again.`,
      );
    }

    const pkce = oauth.generatePkce();
    const state = oauth.generateState();
    const authUrl = oauth.buildAuthUrl({
      clientId,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
    });

    say('Open this URL, sign in to Oura, and approve:');
    say();
    console.log(authUrl);
    say();

    let redirect: Redirect;
    if (isLocal) {
      say(`Waiting for the redirect on port ${port}… (Ctrl-C to cancel)`);
      redirect = await waitForRedirect(port, parsedRedirect.pathname);
      say('Got it.');
    } else {
      say('After approving, the browser lands on a page that may fail to load. That is fine.');
      say('Copy the WHOLE address from the address bar and paste it here.');
      const pasted = await ask(rl, 'Redirect URL: ');
      redirect = parsePastedRedirect(pasted);
    }

    if (redirect.state !== null && !oauth.statesMatch(state, redirect.state)) {
      stop(
        'The `state` value came back wrong, so this redirect is not the one this script started.',
        'run this again and use the URL it prints, in the same terminal session.',
      );
    }

    // ── 5. Exchange ──────────────────────────────────────────────────────────
    heading('Exchanging the code for tokens');
    const exchanged = await oauth.exchangeCode({
      clientId,
      clientSecret,
      code: redirect.code,
      redirectUri,
      codeVerifier: pkce.verifier,
    });
    if (!exchanged.ok) {
      console.error(`\n✗ Oura refused the exchange (${exchanged.error.kind}).`);
      console.error(`  ${exchanged.error.message}`);
      console.error('  Do this: check the Client ID/Secret and that the redirect URI on the Oura');
      console.error('  application page matches exactly, then run this again.\n');
      process.exit(1);
    }
    const tokens = exchanged.value;

    // ── 6. Save, immediately ─────────────────────────────────────────────────
    heading('Saving the tokens (encrypted)');
    // Written before anything else is done with them: the refresh token is the
    // only thing that can renew this connection, and it exists in memory only.
    const store = new tokensMod.FileTokenStore(TOKEN_FILE, tokenKey);
    await store.save(tokens);
    try {
      chmodSync(TOKEN_FILE, 0o600);
    } catch {
      /* non-POSIX filesystem */
    }
    say(`Saved to ${TOKEN_FILE_ENTRY} (AES-256-GCM, permissions 600).`);

    const granted = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
    say(`Scopes granted: ${granted.length > 0 ? granted.join(', ') : '(the server did not say)'}`);
    const missing = oauth.OURA_SCOPES.filter((s) => granted.length > 0 && !granted.includes(s));
    if (missing.length > 0) {
      say(`⚠️  Not granted: ${missing.join(', ')} — those readings will be empty.`);
    }
    const expires = new Date(tokens.expires_at * 1000);
    const minutes = Math.round((tokens.expires_at - Math.floor(Date.now() / 1000)) / 60);
    say(`Access token expires ${expires.toISOString()} (about ${minutes} minutes from now).`);
    say('It renews itself from here on; nothing else to do.');

    // ── 7. Prove it works ────────────────────────────────────────────────────
    heading('Testing the connection against Oura');
    const client = new OuraClient({ getAccessToken: async () => tokens.access_token });
    const info = await client.personalInfo();
    if (!info.ok) {
      console.error(`\n✗ The tokens were saved, but the test call failed (${info.error.kind}).`);
      console.error(`  ${info.error.message}`);
      if (info.error.kind === 'auth' || info.error.kind === 'needs_reauth') {
        console.error('  Do this: this usually means a scope was not granted. Run this again and approve everything.\n');
      } else {
        console.error('  Do this: check the internet connection and run this again — the tokens are already saved.\n');
      }
      process.exit(1);
    }

    const who = info.value;
    say('Oura answered:');
    for (const key of ['age', 'weight', 'height', 'biological_sex', 'email'] as const) {
      if (who[key] !== undefined && who[key] !== null) say(`  ${key}: ${String(who[key])}`);
    }
    console.log('\n✓ Oura is connected.\n');
    console.log('  Next: `npm run dev`, then open Settings → Integrations.\n');
  } finally {
    rl.close();
  }
}

/** Show enough of a secret to recognise it, never enough to use it. */
function mask(secret: string): string {
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 4)}••••••••${secret.slice(-2)}`;
}

main().catch((e: unknown) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  console.error('  Do this: run `npx tsx scripts/oura-auth.ts` again; nothing has been broken.\n');
  process.exit(1);
});
