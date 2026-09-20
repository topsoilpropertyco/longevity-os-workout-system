# Longevity OS — Mac mini worker

The half of the LLM layer that runs on Seth's Mac mini. It pulls `llm_jobs` from
Supabase, runs them against LM Studio, and writes the results back.

---

## The mini is outbound-only

**This worker makes only OUTBOUND connections. It listens on nothing.**

- No tunnel. No ngrok, no Cloudflare Tunnel, no Tailscale Funnel.
- No port forwarding on the router. None. Not one rule.
- No inbound firewall exception. If macOS ever asks whether to allow incoming
  connections for `node`, the answer is **Deny** — nothing here accepts them.
- LM Studio stays bound to `localhost:1234` and is reached only by this process,
  running on the same machine.

Two outbound connections exist, and that is the entire network surface:

| To | Protocol | Why |
|---|---|---|
| `https://<project>.supabase.co` | HTTPS out | claim jobs, write results, keep-alive |
| `http://localhost:1234/v1` | loopback | LM Studio, same machine |

This is CLAUDE.md invariant 3, and it is why the mini can sit on a home network
with no security story beyond "it is not reachable".

**If the mini is off, nothing breaks.** A job left unclaimed for 60 seconds is
picked up by a Vercel function running Gemini's free tier. If that is also
unavailable, the app falls back to deterministic template copy. The today card
never blocks on a model.

---

## Install

**Prerequisites**

- Node **20.6 or newer** (`--env-file` is required). `node -v`
- LM Studio, with a model loaded and the local server started
  (LM Studio → Developer/Server tab → **Start Server**, port 1234).
- The Supabase project URL and **service role** key.

```bash
cd longevity-os/worker
npm install
cp .env.example .env
$EDITOR .env          # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

`.env` holds a service-role key, which bypasses row-level security. It stays on
the mini and is never committed.

---

## Run

```bash
npm start        # poll forever — this is the real thing
npm run once     # drain the queue once and exit; good for a first test
npm run health   # check LM Studio and Supabase, print a JSON verdict, exit
npm run dev      # restart on file change
```

### Run it at login (launchd)

```bash
# 1. Edit the paths marked EDIT ME in the plist: your node, your checkout.
$EDITOR com.longevityos.worker.plist

# 2. Install and start it.
cp com.longevityos.worker.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.longevityos.worker.plist

# 3. Watch it.
tail -f ~/Library/Logs/longevity-worker.log
```

Stop it with `launchctl unload -w ~/Library/LaunchAgents/com.longevityos.worker.plist`.
After editing the plist you must `unload` and `load` again — launchd does not
re-read it on its own.

### Keeping the mini awake

A sleeping mini claims no jobs. Preferred fix, because it survives reboots and
needs no remembering:

> System Settings → Energy (or Battery → Options)
> - **Prevent automatic sleeping when the display is off** → on
> - **Wake for network access** → on
> - **Start up automatically after a power failure** → on

Verify with `pmset -g`; `sleep` should read `0`.

For a temporary session, `caffeinate -dimsu` in a terminal, or
`caffeinate -is npm start` to scope it to the worker. `caffeinate` does not
survive a reboot. The plist has a commented-out `caffeinate` wrapper if you
want launchd to manage it.

---

## Verify it works

Run these in order. Each one isolates one link in the chain.

**1. Is LM Studio up?**

```bash
curl -s http://localhost:1234/v1/models | head -c 400
```

You should see a JSON list with at least one model id. Empty or refused means
the LM Studio server is not started — it is a separate toggle from having the
app open.

**2. Does the worker see both sides?**

```bash
npm run health
# {"ts":"…","level":"info","worker":"mini-…","msg":"health","lmStudio":true,"supabase":true}
```

Exit code 0 means both are reachable.

**3. Does a real job round-trip?**

Insert one by hand in the Supabase SQL editor:

```sql
insert into llm_jobs (user_id, kind, status, payload, priority, attempts, max_attempts)
values (
  '<your user_id>',
  'why_line',
  'queued',
  '{"engine_output":{"type":"zone2","estimated_min":40,"readiness":{"band":"reduced","score":61,"reasons":["HRV 12% below baseline"]}}}'::jsonb,
  5, 0, 3
);
```

Then `npm run once`. Expect two log lines — `job claimed` and `job done` — and:

```sql
select status, provider, latency_ms, result from llm_jobs order by created_at desc limit 1;
```

`status` is `done` and `result->>'why'` is a sentence.

**4. Is the keep-alive writing?**

```sql
select * from worker_heartbeat;
```

The first touch happens on the first poll cycle, then every six hours.

---

## Troubleshoot

Logs are one JSON object per line, so grep works:

```bash
grep '"level":"error"' ~/Library/Logs/longevity-worker.log | tail -20
```

| Symptom | Cause | Fix |
|---|---|---|
| Exits instantly, `missing required environment` | `.env` absent or incomplete | `cp .env.example .env` and fill it in. Exit code 78. |
| `LM Studio is not reachable yet` on every cycle | Server not started, or a different port | LM Studio → Developer → Start Server. Check `LMSTUDIO_BASE_URL`. |
| Jobs claimed, then `job failed` with a timeout | Model too large for the mini, or none loaded | Load a smaller model. A 7–8B quant answers a "why" line in a few seconds. |
| `why line failed the guard` | The model invented a number the engine never produced | Working as intended — the job fails and the app uses template copy. If it is constant, the model is too small; try a stronger one. |
| `vision JSON failed validation` | A text-only model got a vision job | Set `LMSTUDIO_VISION_MODEL` to a real vision model (Qwen2.5-VL / Llama 3.2 Vision class) and load it. |
| `claim lost mid-job; result discarded` | The job took over 60 s and Gemini took it | Normal under load. Constant means the model is too slow for interactive jobs — restrict this worker with `WORKER_JOB_KINDS=weekly_narrative,session_summary`. |
| `keep-alive failed` | `worker_heartbeat` table does not exist | Run the migrations, or point `WORKER_KEEPALIVE_TABLE` at an existing table. Non-fatal. |
| Nothing in the log at all | launchd never started it | `launchctl list \| grep longevityos`. A non-zero status is the exit code. Check `longevity-worker.error.log`. |
| `spawn node ENOENT` in the launchd error log | Wrong node path in the plist | `which node`, put the absolute path in `ProgramArguments` and in `PATH`. nvm users: the versioned path, not the shim. |
| Works by hand, not under launchd | launchd has a bare environment | Absolute paths everywhere; set `PATH` in `EnvironmentVariables`. |
| Jobs pile up `queued` overnight | The mini slept | See "Keeping the mini awake". Gemini should have caught them — check `llm_jobs.provider`. |
| Two workers fighting over jobs | A stray `npm start` beside the launchd job | `pgrep -fl "worker/src/index.ts"`. Claims are atomic so nothing corrupts, but kill the duplicate. |

### Useful queries

```sql
-- queue depth by status
select status, count(*) from llm_jobs group by status;

-- who is actually answering: the mini, or Gemini?
select provider, count(*), round(avg(latency_ms)) as avg_ms
from llm_jobs where status = 'done' and completed_at > now() - interval '7 days'
group by provider;

-- jobs that gave up
select id, kind, attempts, error from llm_jobs where status = 'failed'
order by completed_at desc limit 20;

-- stuck claims (reclaimExpired should be clearing these)
select id, kind, claimed_by, claimed_at from llm_jobs
where status = 'claimed' and claimed_at < now() - interval '2 minutes';
```

---

## Configuration

Every key is documented in `.env.example`. The ones worth knowing:

| Variable | Default | Notes |
|---|---|---|
| `WORKER_POLL_MS` | `15000` | The documented default (PRD §13). |
| `WORKER_USE_REALTIME` | `false` | Supabase Realtime instead of waiting for the next poll. Polling still runs underneath as the safety net. |
| `WORKER_JOB_KINDS` | all | Comma-separated. Use it to keep slow jobs off an interactive worker. |
| `WORKER_KEEPALIVE_MS` | `21600000` | 6 hours. Free Supabase projects pause after ~7 days idle. |
| `LMSTUDIO_MODEL` | `local-model` | LM Studio routes this to whatever is loaded. |
| `LOG_LEVEL` | `info` | `debug` prints every poll cycle. |

---

## How it behaves

- **Claims are atomic.** With the `claim_llm_job` RPC installed it is
  `FOR UPDATE SKIP LOCKED`; without it, a conditional `UPDATE … WHERE status =
  'queued'`. Either way the mini and the Gemini fallback cannot both run a job.
- **Failures retry.** Up to `max_attempts` (default 3), then the job is parked
  as `failed` and the app falls back to template copy.
- **Backoff is exponential.** Repeated cycle failures double the wait from the
  poll interval up to 5 minutes, and reset on the first success.
- **SIGTERM is graceful.** The in-flight job finishes and writes its result;
  then the loop exits. A second signal exits immediately.
- **Output is validated before it is stored.** A "why" line containing a number
  the engine never produced is rejected rather than shown to Seth.
