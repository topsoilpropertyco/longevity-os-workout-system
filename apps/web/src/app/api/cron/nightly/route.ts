import { NextResponse } from 'next/server';
import { getPlanBundle } from '@/lib/plan';
import { notWired, telegramClient } from '@/lib/integrations-bridge';
import { serviceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Nightly maintenance, called by Vercel Cron (or Supabase pg_cron) and guarded
 * by CRON_SECRET. Order matters: pull the inputs, reconcile cardio, snapshot the
 * plan for the audit trail, then queue the morning brief.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';
  const provided = new URL(request.url).searchParams.get('secret') ?? '';
  if (!secret || (auth !== `Bearer ${secret}` && provided !== secret)) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const steps: Record<string, string> = {};
  const origin = new URL(request.url).origin;

  // 1 — Oura
  try {
    const res = await fetch(`${origin}/api/oura/sync?days=3`, { method: 'POST' });
    steps.oura = res.ok ? 'synced' : `skipped (${res.status})`;
  } catch {
    steps.oura = 'unreachable';
  }

  // 2 — Strava reconcile (webhooks can be missed; the nightly pass is the net)
  // TODO(integrations): stravaClient().recentActivities() → upsert cardio_logs.
  steps.strava = 'pending_integration';

  // 3 — Snapshot tomorrow's plan for audit and diffing. The app still re-plans
  //     on open; this is history, not truth.
  const { result } = await getPlanBundle();
  const supabase = serviceSupabase();
  if (supabase) {
    await supabase.from('plans').upsert({
      date: result.today.date,
      signature: result.signature,
      payload: result as unknown as Record<string, unknown>,
    });
    steps.plan = 'snapshotted';
  } else {
    steps.plan = 'supabase_not_configured';
  }

  // 4 — Morning brief
  steps.telegram = telegramClient() ? 'queued' : notWired('telegram').reason;

  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), steps });
}
