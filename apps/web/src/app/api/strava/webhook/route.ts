import { NextResponse, after } from 'next/server';
import { notWired, stravaClient } from '@/lib/integrations-bridge';
import { serviceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Strava push subscription.
 *
 * GET  — the one-time subscription handshake: echo `hub.challenge` when the
 *        verify token matches.
 * POST — events. Strava requires an acknowledgement within 2 seconds, so the
 *        body is captured, 200 is returned immediately, and the fetch of the
 *        activity + HR stream happens in `after()`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = process.env.STRAVA_VERIFY_TOKEN ?? process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

  if (mode !== 'subscribe' || !challenge) {
    return NextResponse.json({ ok: false, reason: 'bad_handshake' }, { status: 400 });
  }
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, reason: 'verify_token_mismatch' }, { status: 403 });
  }
  return NextResponse.json({ 'hub.challenge': challenge });
}

type StravaEvent = {
  object_type?: 'activity' | 'athlete';
  object_id?: number;
  aspect_type?: 'create' | 'update' | 'delete';
  owner_id?: number;
  updates?: Record<string, string>;
};

export async function POST(request: Request) {
  let event: StravaEvent = {};
  try {
    event = (await request.json()) as StravaEvent;
  } catch {
    return NextResponse.json({ ok: true, ignored: 'unparseable' });
  }

  // Acknowledge first; do the work afterwards (Strava's 2-second rule).
  after(async () => {
    if (event.object_type !== 'activity' || event.aspect_type === 'delete') return;
    const client = stravaClient();
    const supabase = serviceSupabase();
    if (!client || !supabase) return;
    // TODO(integrations): const activity = await client.activity(event.object_id);
    //                     const streams  = await client.streams(event.object_id, ['heartrate','time']);
    // TODO(db): compute zone minutes from HRmax, upsert cardio_logs + strava_activities,
    //           then match against today's cardio prescription for the compliance score.
  });

  return NextResponse.json({ ok: true, received: event.object_id ?? null });
}
