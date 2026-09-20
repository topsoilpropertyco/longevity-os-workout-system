# ADR 0010 — The Mac mini is outbound-only

**Status:** accepted · **Date:** 2026-09-20 · **Implements:** `CLAUDE.md` architecture invariant 3; RESEARCH §8

## Context

LM Studio runs on a Mac mini in Seth's house and serves an OpenAI-compatible API at `http://localhost:1234/v1`. Vercel functions need LLM work done. The obvious move is to make the mini reachable — port forwarding, a Cloudflare tunnel, ngrok, Tailscale, dynamic DNS.

Every one of those is a permanent hole into a home network, on a machine holding health data, guarded by whatever auth LM Studio does or does not do, maintained by one person who has two small kids and several businesses. Tunnels also break: a service restarts, a hostname changes, a free tier changes its terms, and the app's LLM layer is down with no signal about why.

The inversion is that the mini does not need to be reachable. It needs to **find out that work exists**, which it can do by asking.

## Decision

**The mini only ever dials out. Nothing on the internet can address it.**

- Work is queued as rows in the Supabase `llm_jobs` table. Supabase is the rendezvous point; both sides already talk to it.
- The worker on the mini polls `llm_jobs` every 15 seconds (ADR 0002), claims a job atomically, calls LM Studio **over loopback**, and writes the result back.
- **No inbound ports. No tunnels. No dynamic DNS. No port forwarding.**
- LM Studio binds to `127.0.0.1:1234`, not `0.0.0.0`. This is verified by hand during setup (`lsof -i :1234`) and it is in the setup checklist for a reason.
- If a job sits unclaimed past **60 seconds**, a Vercel function runs the same prompt against Gemini's free tier, producing the same output schema. The consumer cannot tell which engine answered.
- Each poll doubles as the Supabase keep-alive.

## Consequences

**Good.** The attack surface of the home network is unchanged by this project — nothing about it. No tunnel service to maintain, pay for, or have break. The mini can be unplugged, moved, updated or asleep and the system degrades by exactly 60 seconds. The keep-alive comes free with the poll. And the failure mode is visible: the worker's last-seen time is on the settings screen.

**Costs.** Up to 15 seconds of latency to pick up a job, and no way to push work at the mini urgently. Debugging the worker means being at the mini or reading its log through another channel. A synchronous, interactive local LLM feature is not possible under this design — which is fine, because nothing in the product needs one.

**The deeper consequence, and the reason this is an invariant:** it forces every LLM interaction to be asynchronous and fallback-tolerant. That is what makes invariant 2 real. If the mini were synchronously reachable, something would eventually block on it, and one sleeping machine would become a missed session.

## What would change our mind

- A synchronous local LLM feature that genuinely needs sub-second round trips and cannot be restructured as a job. The correct answer would still not be a tunnel — it would be running that model somewhere that is already addressable.
- Seth already runs a mesh VPN he trusts for other reasons, *and* asks for this. Even then the job queue stays, because it is what makes the Gemini fallback and the keep-alive work.

**A tunnel "just for testing" is not a reason.** Those stay up.
