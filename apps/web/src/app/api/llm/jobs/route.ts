import { NextResponse } from 'next/server';
import { serviceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Mac mini worker's only door. Outbound-only by design: the mini polls this
 * endpoint, claims a job, runs it against LM Studio, and posts the result back.
 * No tunnels, no inbound ports (CLAUDE.md invariant 3).
 */
function authorized(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN ?? process.env.CRON_SECRET ?? '';
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}

/** Claim the next queued job. */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const supabase = serviceSupabase();
  if (!supabase) return NextResponse.json({ ok: true, jobs: [] });

  const { data, error } = await supabase
    .from('llm_jobs')
    .select('*')
    .is('claimed_at', null)
    .order('created_at')
    .limit(1);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const job = data?.[0] as { id?: string } | undefined;
  if (job?.id) {
    await supabase.from('llm_jobs').update({ claimed_at: new Date().toISOString() }).eq('id', job.id);
  }
  return NextResponse.json({ ok: true, jobs: job ? [job] : [] });
}

/** Post a result back. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; result?: unknown; error?: string };
  if (!body.id) return NextResponse.json({ ok: false, reason: 'missing_id' }, { status: 400 });

  const supabase = serviceSupabase();
  if (!supabase) return NextResponse.json({ ok: true, stored: false });

  const { error } = await supabase
    .from('llm_jobs')
    .update({
      result: body.result ?? null,
      error: body.error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', body.id);

  return error
    ? NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    : NextResponse.json({ ok: true, stored: true });
}
