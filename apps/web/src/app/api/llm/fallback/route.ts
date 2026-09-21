import { NextResponse } from 'next/server';
import { whyLinePrompt } from '@longevity/integrations';
import { llmClient, llmStatus, templateWhy } from '@/lib/integrations-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The last two rungs of the LLM ladder.
 *
 * The Mac mini claims jobs from `llm_jobs` and runs them on LM Studio. When it
 * has not claimed one within its 60-second deadline — asleep, offline, mid-
 * update — this route picks the job up on the Gemini free tier. If Gemini is
 * unreachable too, deterministic template copy is returned.
 *
 * The ladder never ends in an error, because the thing at the top of it is a
 * sentence of explanation on a card Seth has already been given. Losing the
 * prose is a cosmetic failure; failing the request is not (CLAUDE.md invariant 2).
 *
 * Note what this route may and may not do: it phrases what the engine decided.
 * It never produces a prescription, a load, or a set count (invariant 1).
 */
type FallbackBody = {
  kind?: 'why' | 'summary' | 'chat';
  /** The engine's own output, passed through verbatim for the model to phrase. */
  engineOutput?: unknown;
  sessionTitle?: string;
  sessionType?: string;
  readinessBand?: string;
  minutes?: number;
  locationName?: string;
};

export async function POST(request: Request) {
  let body: FallbackBody = {};
  try {
    body = (await request.json()) as FallbackBody;
  } catch {
    /* an unparseable body still gets template copy rather than a 400 */
  }

  const template = templateWhy({
    sessionTitle: body.sessionTitle ?? 'Today’s session',
    sessionType: body.sessionType ?? 'strength',
    readinessBand: body.readinessBand ?? 'as_planned',
    minutes: body.minutes ?? 45,
    locationName: body.locationName ?? 'your usual spot',
  });

  const client = llmClient();
  if (!client) {
    return NextResponse.json({ ok: true, source: 'template', provider: llmStatus(), text: template });
  }

  // whyLinePrompt already carries the system message, which pins the one rule
  // that matters here: rephrase the engine's output, never add a number to it.
  const result = await client.chat({
    messages: whyLinePrompt(body.engineOutput ?? body),
    maxTokens: 160,
    temperature: 0.4,
  });

  if (!result.ok) {
    return NextResponse.json({
      ok: true,
      source: 'template',
      provider: llmStatus(),
      text: template,
      note: `${client.name} unavailable: ${result.error.kind}`,
    });
  }

  const text = result.value.text.trim();
  // An empty or suspiciously long answer is worse than the template.
  if (!text || text.length > 400) {
    return NextResponse.json({ ok: true, source: 'template', provider: llmStatus(), text: template });
  }

  return NextResponse.json({
    ok: true,
    source: client.name,
    provider: llmStatus(),
    model: result.value.model,
    text,
  });
}
