/**
 * Longevity OS — today's session, in the terminal
 *
 *   npm run today
 *   npx tsx scripts/today.ts --minutes=20 --location=pf
 *   npx tsx scripts/today.ts --json | jq .today.type
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Until the web app is deployed and Supabase is populated there is no way to
 * see the whole system work: the ring, the engine and the prescription each
 * have tests, but nothing puts them end to end. This does. It reads the real
 * encrypted Oura tokens on this machine, pulls the real readiness, runs the
 * real engine over the real exercise library and the real Knees Over Toes
 * program, and prints the session the app will print. If this looks right, the
 * system is right; the app is then a rendering problem.
 *
 * ── What it is NOT ───────────────────────────────────────────────────────────
 * It computes nothing. Not a set, not a load, not a rep (CLAUDE.md invariant 1).
 * Every number below comes out of `plan()` and is only formatted here. The one
 * arithmetic this file does is collapsing three identical prescribed sets into
 * the string "3 × 8" — presentation, not prescription.
 *
 * ── Degrading ────────────────────────────────────────────────────────────────
 * Nothing about Oura may stop a session being printed (CLAUDE.md invariant 2).
 * No `.env.local`, no token file, no network, a spent refresh token, a 429 —
 * each one prints a single plain sentence saying what happened and what to do,
 * and the run continues down the self-report path. The command exits 0 with a
 * session on the screen in every one of those cases. `--no-oura` takes the same
 * path deliberately, without touching the network at all.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';

import {
  plan,
  type CardioPrescription,
  type Exercise,
  type GoalSettings,
  type GymLocation,
  type OuraDaily,
  type PlanInput,
  type PlanResult,
  type PrescribedExercise,
  type PrescribedSet,
  type Program,
  type ProgramProgress,
  type SelfReport,
  type SessionBlock,
  type Slider1to5,
} from '@longevity/engine';
import {
  FileTokenStore,
  OuraClient,
  accessTokenGetter,
  lastNDays,
  normalizeOuraBundle,
} from '@longevity/integrations';

/**
 * Athlete, locations and injuries still come from the engine's fixture library.
 *
 * THESE ARE FIXTURES, NOT SETH'S RECORD. `SETH` is 205 lb with a 54 resting
 * pulse because that is what pins the engine's tests; `HOME` and
 * `PLANET_FITNESS` are hand-written equipment lists; `BASELINE_INJURIES` is the
 * intake conversation typed up by hand. All four move to Supabase the moment
 * the `users`, `locations` and `injuries` tables are populated, and this import
 * is the line that changes. The output says so out loud in its footer so nobody
 * reads a bodyweight-derived load off this screen and believes it.
 */
import {
  BASELINE_INJURIES,
  BODYWEIGHT_ONLY,
  DEFAULT_GOALS,
  HOME,
  PLANET_FITNESS,
  SETH,
} from '../packages/engine/fixtures/library';
import { PATHS, readJson } from './lib/paths';

// ─────────────────────────────────────────────────────────────────────────────
// Arguments
// ─────────────────────────────────────────────────────────────────────────────

/** The three locations Seth actually trains at, keyed by what he would type. */
const LOCATIONS: Record<string, GymLocation> = {
  home: HOME,
  pf: PLANET_FITNESS,
  travel: BODYWEIGHT_ONLY,
};

interface Options {
  date: string;
  minutes: number;
  location: GymLocation;
  locationKey: string;
  json: boolean;
  useOura: boolean;
}

const USAGE = `Longevity OS — today's session

  npm run today
  npx tsx scripts/today.ts [options]

  --date=YYYY-MM-DD   plan for this date instead of today
  --minutes=N         time budget in minutes (default 45)
  --location=KEY      home | pf | travel (default home)
  --json              print the raw PlanResult as JSON, for piping
  --no-oura           skip the network entirely; use the self-report path
  --help              this
`;

/**
 * Parse `--flag=value`. Bad input stops the run with a sentence rather than a
 * stack trace: this is the one command Seth runs by hand, and "Invalid time
 * value" three frames deep in the engine is not an answer he can act on.
 */
function parseArgs(argv: string[]): Options {
  let date = localToday();
  let minutes = 45;
  let locationKey = 'home';
  let json = false;
  let useOura = true;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--no-oura') {
      useOura = false;
    } else if (arg.startsWith('--date=')) {
      date = arg.slice('--date='.length).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        bail(`--date must be a real calendar date as YYYY-MM-DD; got "${date}".`);
      }
    } else if (arg.startsWith('--minutes=')) {
      minutes = Number(arg.slice('--minutes='.length));
      if (!Number.isFinite(minutes) || minutes <= 0) {
        bail(`--minutes must be a positive number of minutes; got "${arg.slice(10)}".`);
      }
    } else if (arg.startsWith('--location=')) {
      locationKey = arg.slice('--location='.length).trim().toLowerCase();
      if (!LOCATIONS[locationKey]) {
        bail(`--location must be one of ${Object.keys(LOCATIONS).join(', ')}; got "${locationKey}".`);
      }
    } else {
      bail(`Unrecognised option "${arg}".\n\n${USAGE}`);
    }
  }

  return { date, minutes, locationKey, location: LOCATIONS[locationKey] as GymLocation, json, useOura };
}

function bail(message: string): never {
  process.stderr.write(`\n${message}\n`);
  process.exit(2);
}

/**
 * Today in the athlete's own timezone, which is the only timezone the engine's
 * `IsoDate` means. `new Date().toISOString()` would roll over to tomorrow every
 * evening after 8pm in Detroit and silently plan the wrong day — the kind of
 * bug that is invisible for weeks and then eats a Sunday.
 */
function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// .env.local
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal dotenv: `KEY=value`, optional quotes, `#` comments. Deliberately not
 * the npm package — CLAUDE.md caps dependencies, and this is twelve lines.
 *
 * Real environment variables WIN over the file, so a one-off
 * `OURA_TOKEN_KEY=… npm run today` overrides what is on disk, and CI can run
 * this with nothing on disk at all.
 */
function loadEnvLocal(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Oura
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the ring gave us, or the one sentence explaining why it gave us nothing.
 *
 * `notes` is never a stack trace and never an error code on its own: it is what
 * happened and what to do about it, because the person reading it is the person
 * who has to fix it.
 */
interface OuraOutcome {
  days: OuraDaily[];
  notes: string[];
}

/**
 * Pull 28 days of Oura ending on the planning date.
 *
 * Every failure mode returns `{ days: [], notes }` rather than throwing. The
 * caller does not branch on why it failed; it just plans with whatever days
 * came back, which is exactly how the deployed app behaves.
 */
async function fetchOura(date: string): Promise<OuraOutcome> {
  const notes: string[] = [];

  const clientId = process.env['OURA_CLIENT_ID']?.trim();
  const clientSecret = process.env['OURA_CLIENT_SECRET']?.trim();
  const tokenKey = process.env['OURA_TOKEN_KEY']?.trim();
  const tokenFile = path.join(PATHS.root, '.oura-tokens.enc');

  if (!clientId || !clientSecret) {
    notes.push(
      'Oura is not configured on this machine (OURA_CLIENT_ID / OURA_CLIENT_SECRET are missing from .env.local). Run `npx tsx scripts/oura-auth.ts` to connect the ring.',
    );
    return { days: [], notes };
  }
  if (!existsSync(tokenFile)) {
    notes.push(
      'Oura has never been connected on this machine (no .oura-tokens.enc). Run `npx tsx scripts/oura-auth.ts` once and this line goes away.',
    );
    return { days: [], notes };
  }
  if (!tokenKey) {
    // The key is what decrypts the token file, so without it the stored tokens
    // are unreadable and `FileTokenStore.load` throws rather than returning
    // null. Checked here, ahead of the client, because "OURA_TOKEN_KEY is
    // missing" is a far more actionable sentence than the auth failure it would
    // otherwise surface as.
    notes.push(
      'The Oura tokens on disk cannot be decrypted because OURA_TOKEN_KEY is not set. Put the key back in .env.local, or re-run `npx tsx scripts/oura-auth.ts` to issue a new one.',
    );
    return { days: [], notes };
  }

  const store = new FileTokenStore(tokenFile, tokenKey);
  const client = new OuraClient({
    getAccessToken: accessTokenGetter(store, { clientId, clientSecret }),
    // One retry and a short timeout: this is a command someone is watching run.
    // A stale plan printed in four seconds beats a fresh one in forty.
    timeoutMs: 10_000,
    retries: 1,
  });

  let bundle: Awaited<ReturnType<OuraClient['fetchDailyBundle']>>;
  try {
    // Anchor the window on the planning date, not on wall-clock today, so
    // `--date` in the past reads the history that date actually had. Noon UTC
    // keeps the window off a timezone boundary.
    bundle = await client.fetchDailyBundle(lastNDays(28, new Date(`${date}T12:00:00Z`)));
  } catch (e) {
    // `fetchDailyBundle` collects per-endpoint failures rather than throwing,
    // so reaching here means the token getter itself rejected — a dead grant or
    // an unreadable token file.
    notes.push(explainOuraFailure(kindOf(e), messageOf(e)));
    return { days: [], notes };
  }

  const normalized = normalizeOuraBundle(bundle);

  // `fetchDailyBundle` fails endpoint by endpoint, so partial success is the
  // normal shape of a bad day: readiness arrives, the stress endpoint 429s. The
  // credential failures are reported first because they are the ones that mean
  // the whole connection is down rather than one call being unlucky.
  if (bundle.errors.length > 0) {
    const worst =
      bundle.errors.find((e) => e.kind === 'needs_reauth') ??
      bundle.errors.find((e) => e.kind === 'auth') ??
      bundle.errors[0];
    if (worst) {
      const explained = explainOuraFailure(worst.kind, worst.message);
      // Do not tell him the ring was skipped when most of it arrived; that
      // reads as "your readiness is made up" and it is not.
      notes.push(
        normalized.days.length > 0
          ? `${bundle.errors.length} of Oura's 8 endpoints failed; today uses what did arrive. ${explained}`
          : explained,
      );
    }
  }

  if (normalized.warnings.length > 0) {
    notes.push(
      `Oura returned ${normalized.warnings.length} row(s) this build does not understand; they were skipped. If this persists, Oura changed their schema — see packages/integrations/src/oura/schema.ts.`,
    );
  }
  if (normalized.days.length === 0 && notes.length === 0) {
    notes.push('Oura answered but had no days in the last 28 — was the ring off the charger?');
  }

  return { days: normalized.days, notes };
}

/**
 * Strip the layer-by-layer prefixes the token path adds on its way up, so the
 * sentence that reaches the screen starts with the actual problem rather than
 * with three colons of plumbing.
 */
function unwrapDetail(detail: string): string {
  return detail.replace(/^could not resolve an Oura access token:\s*/i, '').trim();
}

/** An `IntegrationErrorKind` (or a thrown lookalike) turned into an instruction. */
function explainOuraFailure(kind: string, rawDetail: string): string {
  const detail = unwrapDetail(rawDetail);
  switch (kind) {
    case 'needs_reauth':
      return 'Oura will not renew its token — the connection has to be re-authorised in a browser. Run `npx tsx scripts/oura-auth.ts`.';
    case 'auth':
      // The token store says exactly this when decryption fails, and the raw
      // GCM message ("Unsupported state or unable to authenticate data") tells
      // nobody anything. Name the actual cause instead.
      if (detail.includes('could not read the stored Oura tokens')) {
        return 'OURA_TOKEN_KEY does not match the key .oura-tokens.enc was written with, so the stored tokens cannot be decrypted. Restore the original key, or re-run `npx tsx scripts/oura-auth.ts` to start fresh.';
      }
      // Oura’s own rejections already say what to check, in more detail than
      // this script could — pass them straight through rather than wrapping.
      return `Oura would not issue an access token. ${detail || 'Check OURA_CLIENT_ID / OURA_CLIENT_SECRET in .env.local.'}`;
    case 'rate_limited':
      return 'Oura is rate-limiting this app right now. Nothing is broken; try again in a few minutes.';
    case 'timeout':
    case 'network':
      return 'Could not reach Oura (no network, or it timed out). Today is planned without the ring.';
    case 'server':
      return 'Oura is having a bad day on their end (5xx). Today is planned without the ring.';
    default:
      return `Oura request failed: ${detail || kind}. Today is planned without the ring.`;
  }
}

function kindOf(e: unknown): string {
  const k = (e as { kind?: unknown })?.kind;
  return typeof k === 'string' ? k : 'unknown';
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─────────────────────────────────────────────────────────────────────────────
// The self-report path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three sliders, asked at the prompt.
 *
 * Only asked when there is a human at a terminal to answer and the output is
 * for them to read. Piping to `--json`, or running from cron, must never block
 * on a question nobody will see — in that case NOTHING is returned and the
 * engine falls through to its neutral default, which is honest. Inventing a
 * 3/3/3 on Seth's behalf would put a self-report he never made into the reason
 * line, and the reason line is the one thing he is asked to trust.
 */
async function askSliders(date: string, quiet: boolean): Promise<SelfReport | undefined> {
  if (quiet || !process.stdin.isTTY || !process.stdout.isTTY) return undefined;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write('\n  No ring data — three questions, Enter to skip any of them.\n');
    const soreness = await askSlider(rl, '  Soreness   1 wrecked … 5 fresh      ');
    const energy = await askSlider(rl, '  Energy     1 flat … 5 energized      ');
    const stress = await askSlider(rl, '  Stress     1 calm … 5 maxed out      ');
    if (soreness === undefined && energy === undefined && stress === undefined) return undefined;
    // A partially answered form is still a real signal. The unanswered sliders
    // sit at neutral, which is what "nothing unusual there" means.
    return { date, soreness: soreness ?? 3, energy: energy ?? 3, stress: stress ?? 3 };
  } catch {
    // Ctrl+D and Ctrl+C reject the pending question. Walking away from the
    // sliders is a legitimate answer — it means "just show me the session" —
    // so it must not take the command down with it.
    process.stdout.write('\n');
    return undefined;
  } finally {
    rl.close();
  }
}

async function askSlider(
  rl: ReturnType<typeof createInterface>,
  label: string,
): Promise<Slider1to5 | undefined> {
  for (;;) {
    const answer = (await rl.question(`${label}[1-5] `)).trim();
    if (answer === '') return undefined;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= 5) return n as Slider1to5;
    process.stdout.write('    1 to 5, or Enter to skip.\n');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Plain ANSI, no dependency. Off when `NO_COLOR` is set (the informal standard
 * at no-color.org) or when stdout is not a terminal — escape codes in a pipe
 * are noise at best and corrupt `--json` at worst.
 */
const COLOR = Boolean(process.stdout.isTTY) && !process.env['NO_COLOR'];
const paint = (code: string) => (s: string): string => (COLOR ? `\u001b[${code}m${s}\u001b[0m` : s);

const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');
const cyan = paint('36');

/** Terminal width, clamped to the 80 columns this layout is designed for. */
const WIDTH = 80;

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Greedy wrap. Used for the why line and the engine's notes, which are prose. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** Pad or truncate to an exact column count, so the right-hand column lines up. */
function fit(text: string, width: number): string {
  if (text.length <= width) return text.padEnd(width);
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `2026-09-21` → `Monday 21 September`. Parsed as UTC so the day never slips. */
function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]?.slice(0, 3)} ${d.getUTCDate()}`;
}

/** Seconds → `90s` or `2:30`, whichever a person reads faster. */
function duration(seconds: number): string {
  if (seconds < 100) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${`${s}`.padStart(2, '0')}`;
}

/** Trim a trailing `.0` without ever rounding a prescribed number. */
function num(n: number): string {
  return Number.isInteger(n) ? `${n}` : `${n}`.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * One prescribed set as its units say it should read: seconds for holds, miles
 * for distance, reps otherwise. Nothing is computed — `set` already carries the
 * engine's decision; this only chooses which of its fields to show.
 */
function setShape(set: PrescribedSet): string {
  if (set.duration_s) return duration(set.duration_s);
  if (set.distance_mi) return `${num(set.distance_mi)} mi`;
  return `${set.reps}`;
}

function setLoad(set: PrescribedSet): string {
  if (!set.load_lb) return '';
  return set.is_assisted ? `−${num(set.load_lb)} lb assist` : `${num(set.load_lb)} lb`;
}

/**
 * Collapse runs of identical sets: `[8@45, 8@45, 8@45]` → `3 × 8 @ 45 lb`.
 *
 * Purely a display collapse — the engine prescribed three sets and three sets
 * is what gets logged. Warm-up sets are kept in their own run because they do
 * not count toward the ledger and Seth should see them as separate work.
 */
function describeSets(sets: PrescribedSet[]): string[] {
  const runs: { count: number; set: PrescribedSet }[] = [];
  for (const set of sets) {
    const last = runs[runs.length - 1];
    if (last && sameShape(last.set, set)) last.count += 1;
    else runs.push({ count: 1, set });
  }
  return runs.map(({ count, set }) => {
    const load = setLoad(set);
    const body = `${count} × ${setShape(set)}${load ? ` @ ${load}` : ''}`;
    return set.warmup ? `${body} (warm-up)` : body;
  });
}

function sameShape(a: PrescribedSet, b: PrescribedSet): boolean {
  return (
    a.reps === b.reps &&
    a.load_lb === b.load_lb &&
    a.duration_s === b.duration_s &&
    a.distance_mi === b.distance_mi &&
    Boolean(a.warmup) === Boolean(b.warmup) &&
    Boolean(a.is_assisted) === Boolean(b.is_assisted)
  );
}

/** The rest interval the whole exercise shares, or a range when it varies. */
function restLabel(sets: PrescribedSet[]): string {
  const rests = [...new Set(sets.map((s) => s.rest_s))].filter((r) => r > 0);
  if (rests.length === 0) return '';
  if (rests.length === 1) return `rest ${duration(rests[0] as number)}`;
  return `rest ${duration(Math.min(...rests))}–${duration(Math.max(...rests))}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The view
// ─────────────────────────────────────────────────────────────────────────────

const BAND_LABEL: Record<string, string> = {
  push: 'PUSH — take the extra set',
  as_planned: 'AS PLANNED',
  reduced: 'REDUCED — 10% off the bar, RPE capped',
  recovery: 'RECOVERY — today is not a training day',
};

function bandColor(band: string): (s: string) => string {
  if (band === 'push') return green;
  if (band === 'as_planned') return cyan;
  if (band === 'reduced') return yellow;
  return red;
}

function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function rule(char = '─'): void {
  out(dim(char.repeat(WIDTH)));
}

function render(result: PlanResult, opts: Options, notes: string[]): void {
  const session = result.today;
  const readiness = session.readiness;

  out();
  rule('━');
  const left = bold(`  ${longDate(session.date)}`);
  const right = `${opts.location.name} · ${opts.minutes} min  `;
  // `left` carries escape codes, so pad against the visible text, not the string.
  const visibleLeft = `  ${longDate(session.date)}`;
  out(`${left}${' '.repeat(Math.max(1, WIDTH - visibleLeft.length - right.length))}${dim(right)}`);
  rule('━');
  out();

  // ── Readiness ──────────────────────────────────────────────────────────────
  const paintBand = bandColor(readiness.band);
  out(
    `  ${bold('READINESS')}  ${paintBand(bold(`${Math.round(readiness.score)}`))}${dim('/100')}  ` +
      `${paintBand(BAND_LABEL[readiness.band] ?? readiness.band)}  ${dim(`(${readiness.source})`)}`,
  );
  for (const reason of readiness.reasons) {
    for (const line of wrap(reason, WIDTH - 14)) out(`    ${dim(line)}`);
  }
  out();

  // ── The session and its why line ───────────────────────────────────────────
  out(`  ${bold(session.title)}  ${dim(`· ${session.type} · ~${Math.round(session.estimated_min)} min`)}`);
  if (session.deload) out(`  ${yellow('DELOAD WEEK — volume and load are deliberately down.')}`);
  out();
  for (const line of wrap(session.why, WIDTH - 4)) out(`  ${line}`);
  out();

  // ── Blocks ─────────────────────────────────────────────────────────────────
  for (const block of session.blocks) {
    renderBlock(block);
  }

  // ── Anything the engine could not satisfy ──────────────────────────────────
  if (result.warnings.length > 0) {
    out(`  ${yellow(bold('WARNINGS'))}`);
    for (const warning of result.warnings) {
      for (const line of wrap(warning, WIDTH - 6)) out(`    ${yellow(line)}`);
    }
    out();
  }

  renderFooter(result, opts, notes);
}

function renderBlock(block: SessionBlock): void {
  const heading = block.title.toUpperCase();
  const minutes = `${Math.round(block.estimated_min)} min`;
  const gap = Math.max(1, WIDTH - 6 - heading.length - minutes.length);
  out(`  ${bold(heading)} ${dim('·'.repeat(gap))} ${dim(minutes)}`);

  for (const exercise of block.exercises) renderExercise(exercise);
  if (block.cardio) renderCardio(block.cardio);

  // The engine currently returns warm-up and cool-down as time allowances with
  // no movements in them. Printing the heading anyway is deliberate: without it
  // ten of the session's minutes are unaccounted for on screen and the total at
  // the top looks wrong.
  if (block.exercises.length === 0 && !block.cardio) {
    out(`    ${dim('Your own — the engine reserves the time but does not prescribe it yet.')}`);
  }
  out();
}

function renderExercise(pe: PrescribedExercise): void {
  const shapes = describeSets(pe.sets);
  const rest = restLabel(pe.sets);

  // Name on the left at a fixed width, prescription on the right. Two columns
  // is the most a phone-sized terminal can hold without wrapping mid-number.
  out(`    ${fit(pe.exercise.name, 34)}  ${shapes[0] ?? ''}`);
  for (const extra of shapes.slice(1)) out(`    ${' '.repeat(34)}  ${extra}`);

  const tail: string[] = [];
  if (rest) tail.push(rest);
  const rpe = pe.sets.find((s) => s.rpe_target)?.rpe_target;
  if (rpe) tail.push(`RPE ${rpe}`);
  if (pe.superset_with) tail.push(`superset with ${pe.superset_with}`);
  if (tail.length) out(`    ${' '.repeat(34)}  ${dim(tail.join(' · '))}`);

  if (pe.why) {
    for (const line of wrap(pe.why, WIDTH - 8)) out(`      ${dim(line)}`);
  }
}

function renderCardio(c: CardioPrescription): void {
  const shape =
    c.intervals
      ? `${c.intervals.rounds} × ${num(c.intervals.work_min)} min on / ${num(c.intervals.rest_min)} min off`
      : `${num(c.duration_min)} min${c.distance_mi ? ` · ${num(c.distance_mi)} mi` : ''}`;
  out(`    ${fit(`${c.modality} — ${c.structure.replace(/_/g, ' ')}`, 34)}  ${shape}`);
  out(
    `    ${' '.repeat(34)}  ${dim(`${c.target_zone.toUpperCase()} · ${c.target_bpm[0]}–${c.target_bpm[1]} bpm`)}`,
  );
  for (const line of wrap(c.why, WIDTH - 8)) out(`      ${dim(line)}`);
}

function renderFooter(result: PlanResult, opts: Options, notes: string[]): void {
  rule();

  // The week's shape: seven lines, today marked. These are projections under
  // assumed-neutral readiness — the engine does not forecast Oura — so they are
  // labelled as the shape of the week, not as Thursday's actual load.
  out(`  ${bold('THE WEEK')} ${dim('— projected at neutral readiness; re-planned every morning')}`);
  for (const day of result.week) {
    const marker = day.is_today ? cyan('▸') : ' ';
    const minutes = `${Math.round(day.session.estimated_min)} min`;
    out(
      `  ${marker} ${fit(shortDate(day.date), 8)} ${fit(day.session.title, 40)} ` +
        `${dim(fit(day.session.type, 10))} ${dim(minutes)}`,
    );
  }
  out();

  const w = result.weekly;
  out(
    `  ${dim('This week so far')}  ` +
      `Zone 2 ${Math.round(w.zone2_min)}/${Math.round(w.zone2_target_min)} min · ` +
      `VO2 ${w.vo2_sessions} · strength ${Math.round(w.strength_min)} min · ` +
      `${Math.round(w.plyo_contacts)} plyo contacts`,
  );
  out(`  ${dim('Plan signature')}  ${result.signature}  ${dim(`· ${opts.locationKey} · ${opts.minutes} min budget`)}`);
  out();

  // The degradation notes and the fixture disclaimer are the last things on the
  // screen on purpose: they are about how much to trust what is above them.
  for (const note of notes) {
    for (const [i, line] of wrap(note, WIDTH - 6).entries()) {
      out(`  ${i === 0 ? yellow('!') : ' '} ${line}`);
    }
  }
  const fixtureNotice =
    'Athlete, gym equipment and injuries are still the engine fixtures in ' +
    'packages/engine/fixtures/library.ts, not Supabase — anything derived from bodyweight is ' +
    'indicative until those tables are populated.';
  for (const [i, line] of wrap(fixtureNotice, WIDTH - 6).entries()) {
    out(`  ${i === 0 ? dim('i') : ' '} ${dim(line)}`);
  }
  out();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The exercise library is both files, exactly as `scripts/import-csv.ts`
 * assembles it. `data/exercises.json` is the ingested public spine;
 * `data/curated-exercises.json` holds the hand-written movements the spine has
 * no record of — and 32 of the 69 Knees Over Toes steps resolve only there.
 * Loading the spine alone silently drops half the program.
 */
function loadExercises(): Exercise[] {
  const spine = readJson<Exercise[]>(PATHS.exercises);
  const curated = existsSync(PATHS.curatedExercises)
    ? readJson<Exercise[]>(PATHS.curatedExercises)
    : [];
  return [...spine, ...curated];
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  loadEnvLocal(path.join(PATHS.root, '.env.local'));

  const notes: string[] = [];
  let ouraDays: OuraDaily[] = [];

  if (opts.useOura) {
    const outcome = await fetchOura(opts.date);
    ouraDays = outcome.days;
    notes.push(...outcome.notes);
  } else {
    notes.push('Ran with --no-oura, so nothing was fetched. Readiness comes from the self-report path.');
  }

  const ouraToday = ouraDays.find((d) => d.date === opts.date);
  // A day with no readiness score is not a day, for this purpose: the engine
  // reads `readiness_score === undefined` as "no ring signal" and falls through
  // to the sliders on its own.
  const selfReport =
    ouraToday?.readiness_score === undefined ? await askSliders(opts.date, opts.json) : undefined;

  const goals: GoalSettings = DEFAULT_GOALS;

  const input: PlanInput = {
    today: opts.date,
    athlete: SETH,
    goals,
    budget_min: opts.minutes,
    location: opts.location,
    all_locations: Object.values(LOCATIONS),
    ...(ouraToday ? { oura_today: ouraToday } : {}),
    oura_history: ouraDays,
    ...(selfReport ? { self_report: selfReport } : {}),
    recent_self_reports: selfReport ? [selfReport] : [],
    // Genuinely empty, and left that way. Seth has never logged a session in
    // this system, has no Strava import and has not weighed in through it, so
    // the engine cold-starts from program standards rather than from history.
    // Seeding plausible-looking sessions here would make the first real week's
    // progression wrong in a way nobody could see.
    history: [],
    cardio_history: [],
    body_metrics: [],
    injuries: BASELINE_INJURIES,
    program: readJson<Program>(PATHS.kotProgram),
    program_progress: readJson<ProgramProgress>(
      path.join(PATHS.programsDir, 'kot', 'progress-default.json'),
    ),
    exercises: loadExercises(),
  };

  const result = plan(input);

  if (opts.json) {
    // The engine stamps a fixed `generated_at` to stay deterministic; a caller
    // piping this somewhere wants the real instant, and `plan()` says callers
    // may overwrite it.
    process.stdout.write(`${JSON.stringify({ ...result, generated_at: new Date().toISOString() }, null, 2)}\n`);
    for (const note of notes) process.stderr.write(`${note}\n`);
    return;
  }

  render(result, opts, notes);
}

main().catch((err: unknown) => {
  // Anything reaching here is a bug in the engine or in this file, not a
  // degradation path — those are all handled above and print a session anyway.
  process.stderr.write(`\nCould not plan today: ${messageOf(err)}\n`);
  if (err instanceof Error && err.stack) process.stderr.write(`${err.stack}\n`);
  process.exitCode = 1;
});
