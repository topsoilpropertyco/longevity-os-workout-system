/**
 * Longevity OS — Mac mini worker.
 *
 * ── The whole architecture, in one sentence ──────────────────────────────────
 * This process makes **only outbound connections**: HTTPS to Supabase, and
 * localhost HTTP to LM Studio. It listens on nothing. There is no tunnel, no
 * ngrok, no port forwarding, no reverse proxy, no inbound firewall rule. The
 * mini is unreachable from the internet by design (CLAUDE.md invariant 3).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The loop:
 *   1. Poll Supabase `llm_jobs` every 15 s (PRD §13's documented default;
 *      Realtime is available behind `WORKER_USE_REALTIME` but polling wins on
 *      simplicity and survives a dropped websocket).
 *   2. Claim one job ATOMICALLY, so the Vercel Gemini fallback cannot double-run it.
 *   3. Render the prompt and call LM Studio.
 *   4. Write the result back, or record the failure and let it retry.
 *   5. Touch a keep-alive row every 6 h, because a free Supabase project pauses
 *      after ~7 days of inactivity (RESEARCH §8) and a paused project takes the
 *      whole app down, not just the worker.
 *
 * If this process is down, nothing breaks: a job unclaimed for 60 s is picked
 * up by Vercel's Gemini fallback, and if that is also down the today card falls
 * back to deterministic template copy. The mini is an optimisation.
 *
 * Run: `npm start` (see README.md). Managed by launchd in production.
 */

import { hostname } from 'node:os';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  LLM_JOBS_TABLE,
  claim,
  complete,
  failJob,
  lmStudioProvider,
  extractJson,
  whyLinePrompt,
  telegramChatPrompt,
  visionParsePrompt,
  weeklyNarrativePrompt,
  sessionSummaryPrompt,
  parseVisionResponse,
  guardWhyLine,
  type JobStore,
  type LlmJob,
  type LlmJobKind,
  type LlmMessage,
  type LlmProvider,
} from '@longevity/integrations';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

interface Config {
  supabaseUrl: string;
  supabaseKey: string;
  lmStudioBaseUrl: string;
  model: string;
  visionModel: string;
  workerId: string;
  pollMs: number;
  useRealtime: boolean;
  jobKinds: LlmJobKind[] | undefined;
  keepAliveMs: number;
  keepAliveTable: string;
  logLevel: LogLevel;
}

/** Read and validate the environment. Exits with a clear message if incomplete. */
function loadConfig(): Config {
  const env = process.env;
  const missing: string[] = [];
  const need = (k: string): string => {
    const v = env[k];
    if (!v) missing.push(k);
    return v ?? '';
  };

  const cfg: Config = {
    supabaseUrl: need('SUPABASE_URL'),
    supabaseKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    lmStudioBaseUrl: env['LMSTUDIO_BASE_URL'] ?? 'http://localhost:1234/v1',
    model: env['LMSTUDIO_MODEL'] ?? 'local-model',
    visionModel: env['LMSTUDIO_VISION_MODEL'] ?? env['LMSTUDIO_MODEL'] ?? 'local-model',
    workerId: env['WORKER_ID'] || `mini-${hostname()}`,
    pollMs: intEnv(env['WORKER_POLL_MS'], 15_000),
    useRealtime: env['WORKER_USE_REALTIME'] === 'true',
    jobKinds: parseKinds(env['WORKER_JOB_KINDS']),
    keepAliveMs: intEnv(env['WORKER_KEEPALIVE_MS'], 6 * 60 * 60 * 1000),
    keepAliveTable: env['WORKER_KEEPALIVE_TABLE'] ?? 'worker_heartbeat',
    logLevel: (env['LOG_LEVEL'] as LogLevel) ?? 'info',
  };

  if (missing.length > 0) {
    // Not a log line: this is a startup failure a human has to read.
    process.stderr.write(
      `[worker] missing required environment: ${missing.join(', ')}\n` +
        `[worker] copy worker/.env.example to worker/.env and fill it in\n`,
    );
    process.exit(78); // EX_CONFIG
  }
  return cfg;
}

function intEnv(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseKinds(v: string | undefined): LlmJobKind[] | undefined {
  if (!v || v.trim() === '') return undefined;
  const kinds = v.split(',').map((s) => s.trim()).filter(Boolean) as LlmJobKind[];
  return kinds.length > 0 ? kinds : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured logging
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * One JSON object per line, to stdout. launchd captures it to a file, so it has
 * to be greppable a month later with no tooling: `grep '"level":"error"'`.
 */
function makeLogger(level: LogLevel, workerId: string) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl: LogLevel, msg: string, fields: Record<string, unknown> = {}): void => {
    if (LEVELS[lvl] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: lvl,
      worker: workerId,
      msg,
      ...fields,
    });
    if (lvl === 'error' || lvl === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
    info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
    warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
    error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
  };
}
type Logger = ReturnType<typeof makeLogger>;

// ─────────────────────────────────────────────────────────────────────────────
// Supabase → JobStore adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ~40 lines that let `@longevity/integrations` stay free of the Supabase
 * SDK. Everything the queue needs, expressed over PostgREST.
 */
function supabaseJobStore(sb: SupabaseClient): JobStore {
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
      for (const [k, v] of Object.entries(query.lt ?? {})) {
        q = q.lt(k, v as never);
      }
      for (const o of query.order ?? []) {
        q = q.order(o.column, { ascending: o.ascending !== false });
      }
      if (query.limit) q = q.limit(query.limit);
      const { data, error } = await q;
      if (error) throw new Error(`select ${table}: ${error.message}`);
      return (data ?? []) as Record<string, unknown>[];
    },
    async rpc(fn, args) {
      const { data, error } = await sb.rpc(fn, args);
      // A missing RPC is not fatal: `claim()` falls back to a conditional
      // UPDATE, which is safe with a single worker.
      if (error) throw new Error(`rpc ${fn}: ${error.message}`);
      return data;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job dispatch
// ─────────────────────────────────────────────────────────────────────────────

/** Turn a job's payload into the messages for its prompt. */
function buildMessages(job: LlmJob): LlmMessage[] {
  const p = job.payload ?? {};
  switch (job.kind) {
    case 'why_line':
      return whyLinePrompt(p['engine_output'] ?? p);
    case 'chat':
      return telegramChatPrompt(
        String(p['text'] ?? ''),
        (p['context'] as Record<string, unknown> | undefined) ?? undefined,
      );
    case 'vision_parse':
      return visionParsePrompt(p['hint'] ? String(p['hint']) : undefined);
    case 'weekly_narrative':
      return weeklyNarrativePrompt(p['weekly'] ?? p, p['context']);
    case 'session_summary':
      return sessionSummaryPrompt(p['session'] ?? p, p['engine_notes']);
    default:
      return [{ role: 'user', content: JSON.stringify(p) }];
  }
}

/**
 * Run one job against LM Studio and return the result object to store.
 *
 * Throws on failure, which the caller records through `failJob` — inside this
 * function throwing is the clearest control flow, and nothing above it is on a
 * request path.
 */
async function runJob(
  job: LlmJob,
  provider: LlmProvider,
  log: Logger,
): Promise<{ result: Record<string, unknown>; latencyMs: number }> {
  const messages = buildMessages(job);
  const wantsJson = job.kind === 'vision_parse';

  const res =
    job.kind === 'vision_parse'
      ? await provider.vision({
          messages,
          imageBase64: String(job.payload['image_base64'] ?? ''),
          mimeType: String(job.payload['mime_type'] ?? 'image/jpeg'),
          json: true,
          temperature: 0,
          maxTokens: 1500,
        })
      : await provider.chat({
          messages,
          temperature: job.kind === 'chat' ? 0.4 : 0.2,
          maxTokens: job.kind === 'weekly_narrative' ? 500 : 300,
        });

  if (!res.ok) throw new Error(`${res.error.kind}: ${res.error.message}`);
  const out = res.value;

  // Per-kind validation. A job that produced unusable output FAILS rather than
  // storing nonsense — the caller then falls back to template copy, which is
  // strictly better than a hallucinated "why".
  switch (job.kind) {
    case 'why_line': {
      const guarded = guardWhyLine(out.text, job.payload['engine_output'] ?? job.payload);
      if (!guarded) {
        throw new Error('why line failed the guard (wrong length, or a number the engine never produced)');
      }
      return { result: { why: guarded, model: out.model }, latencyMs: out.latencyMs };
    }
    case 'vision_parse': {
      const json = out.json ?? extractJson(out.text);
      const parsed = parseVisionResponse(json);
      if (!parsed.ok) throw new Error(`vision JSON failed validation: ${parsed.errors.join('; ')}`);
      log.debug('vision parse ok', {
        job: job.id,
        confidence: parsed.value.confidence,
        questions: parsed.value.questions.length,
      });
      return { result: { parse: parsed.value, model: out.model }, latencyMs: out.latencyMs };
    }
    default: {
      const text = out.text.trim();
      if (text.length === 0) throw new Error('model returned an empty response');
      return {
        result: { text, model: out.model, ...(wantsJson && out.json ? { json: out.json } : {}) },
        latencyMs: out.latencyMs,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The worker
// ─────────────────────────────────────────────────────────────────────────────

/** Drain the queue until it is empty, one job at a time. Returns jobs done. */
async function drain(
  store: JobStore,
  provider: LlmProvider,
  cfg: Config,
  log: Logger,
  shouldStop: () => boolean,
): Promise<number> {
  let processed = 0;
  // A bound so one very busy cycle cannot starve the keep-alive or the signal
  // handler; whatever is left is picked up on the next poll.
  for (let i = 0; i < 25 && !shouldStop(); i += 1) {
    const claimed = await claim(store, cfg.workerId, {
      ...(cfg.jobKinds ? { kinds: cfg.jobKinds } : {}),
    });
    if (!claimed.ok) {
      log.error('claim failed', { error: claimed.error.message });
      return processed;
    }
    const job = claimed.value;
    if (!job) return processed;

    log.info('job claimed', { job: job.id, kind: job.kind, attempt: job.attempts });
    const startedAt = Date.now();
    try {
      const { result, latencyMs } = await runJob(job, provider, log);
      const done = await complete(store, job.id, cfg.workerId, result, {
        provider: provider.name,
        latencyMs,
      });
      if (!done.ok) {
        log.error('completed the work but could not write it back', {
          job: job.id,
          error: done.error.message,
        });
      } else if (done.value === null) {
        // The claim expired mid-job and Vercel's Gemini fallback took it.
        // That is the system working as designed; the work is just wasted.
        log.warn('claim lost mid-job; result discarded', { job: job.id, latencyMs });
      } else {
        log.info('job done', { job: job.id, kind: job.kind, latencyMs });
      }
      processed += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error('job failed', { job: job.id, kind: job.kind, error: message, ms: Date.now() - startedAt });
      const recorded = await failJob(store, job.id, cfg.workerId, message);
      if (!recorded.ok) log.error('could not record the failure', { job: job.id, error: recorded.error.message });
    }
  }
  return processed;
}

/**
 * Keep the free Supabase project awake.
 *
 * Supabase pauses a free project after ~7 days with no activity (RESEARCH §8),
 * and unpausing is manual. Daily app use normally prevents it; this is the
 * insurance for a week Seth is away. An upsert, not a select, because read-only
 * traffic does not always count as activity.
 */
async function keepAlive(sb: SupabaseClient, cfg: Config, log: Logger): Promise<void> {
  const { error } = await sb
    .from(cfg.keepAliveTable)
    .upsert({ worker_id: cfg.workerId, last_seen: new Date().toISOString() }, { onConflict: 'worker_id' });
  if (error) {
    // Never fatal. A missing table means the migration has not run yet; the
    // worker's real job is unaffected.
    log.warn('keep-alive failed', { table: cfg.keepAliveTable, error: error.message });
  } else {
    log.debug('keep-alive ok', { table: cfg.keepAliveTable });
  }
}

/** Sleep, but wake early when the stop signal fires. */
function sleep(ms: number, signal: { stopped: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const check = setInterval(() => {
      if (signal.stopped) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 250);
    timer.unref?.();
    check.unref?.();
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = makeLogger(cfg.logLevel, cfg.workerId);
  const args = new Set(process.argv.slice(2));

  const sb = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const store = supabaseJobStore(sb);
  const provider = lmStudioProvider(cfg.lmStudioBaseUrl, {
    model: cfg.model,
    visionModel: cfg.visionModel,
  });

  // `--health`: one-shot readiness check for the troubleshooting section.
  if (args.has('--health')) {
    const lmOk = await provider.healthy(3000);
    let dbOk = false;
    let dbError: string | undefined;
    try {
      const { error } = await sb.from(LLM_JOBS_TABLE).select('id').limit(1);
      dbOk = !error;
      dbError = error?.message;
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
    log.info('health', {
      lmStudio: lmOk,
      lmStudioUrl: cfg.lmStudioBaseUrl,
      supabase: dbOk,
      ...(dbError ? { supabaseError: dbError } : {}),
    });
    process.exit(lmOk && dbOk ? 0 : 1);
  }

  const signal = { stopped: false };
  let shuttingDown = false;
  const stop = (why: string) => {
    if (shuttingDown) {
      log.warn('second signal; exiting immediately', { why });
      process.exit(130);
    }
    shuttingDown = true;
    signal.stopped = true;
    // Graceful: the in-flight job finishes, its result is written, and only
    // then does the loop exit. launchd's default SIGKILL grace is generous
    // enough for a local model call.
    log.info('shutting down after the current job', { why });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  log.info('worker starting', {
    pollMs: cfg.pollMs,
    lmStudio: cfg.lmStudioBaseUrl,
    model: cfg.model,
    kinds: cfg.jobKinds ?? 'all',
    realtime: cfg.useRealtime,
    note: 'outbound connections only — no inbound ports, no tunnel',
  });

  if (!(await provider.healthy(3000))) {
    // Not fatal: LM Studio may still be starting after a reboot. Jobs that
    // fail are retried, and the 60s rule hands them to Gemini meanwhile.
    log.warn('LM Studio is not reachable yet; will keep polling', { url: cfg.lmStudioBaseUrl });
  }

  // Optional Realtime. Polling still runs underneath it as the safety net —
  // a dropped websocket must never mean a silently stalled queue.
  if (cfg.useRealtime) {
    sb.channel('llm_jobs_inserts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: LLM_JOBS_TABLE }, () => {
        log.debug('realtime insert; draining early');
        void drain(store, provider, cfg, log, () => signal.stopped);
      })
      .subscribe((status) => log.info('realtime subscription', { status }));
  }

  let lastKeepAlive = 0;
  let consecutiveFailures = 0;

  while (!signal.stopped) {
    const cycleStart = Date.now();
    try {
      const processed = await drain(store, provider, cfg, log, () => signal.stopped);
      if (processed > 0) log.info('cycle complete', { processed, ms: Date.now() - cycleStart });
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures += 1;
      log.error('poll cycle threw', {
        error: e instanceof Error ? e.message : String(e),
        consecutiveFailures,
      });
    }

    if (Date.now() - lastKeepAlive > cfg.keepAliveMs) {
      lastKeepAlive = Date.now();
      await keepAlive(sb, cfg, log).catch(() => undefined);
    }

    if (args.has('--once')) break;

    /**
     * Exponential backoff on repeated failures — Supabase down, network gone,
     * laptop lid closed. Doubles from the poll interval up to 5 minutes, so a
     * multi-hour outage does not generate thousands of log lines or burn the
     * free tier's request budget. Resets on the first success.
     */
    const backoff =
      consecutiveFailures === 0
        ? cfg.pollMs
        : Math.min(cfg.pollMs * 2 ** Math.min(consecutiveFailures, 6), 5 * 60_000);
    if (consecutiveFailures > 0) log.warn('backing off', { ms: backoff, consecutiveFailures });
    await sleep(backoff, signal);
  }

  log.info('worker stopped');
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'worker crashed',
      error: e instanceof Error ? e.stack : String(e),
    })}\n`,
  );
  // Non-zero so launchd's KeepAlive restarts us.
  process.exit(1);
});
