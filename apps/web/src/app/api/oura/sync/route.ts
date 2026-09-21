import { NextResponse } from 'next/server';
import { normalizeOuraBundle } from '@longevity/integrations';
import { notWired, ouraClient } from '@/lib/integrations-bridge';
import { serviceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Nightly Oura pull (PRD §8.1).
 *
 * Idempotent: rows are upserted on (user_id, date), so re-running it is free and
 * a partial failure is fixed by running it again. Never called from the today
 * card's render path — if this has not run, the card falls back to the sliders
 * and Seth notices nothing (CLAUDE.md invariant 2).
 *
 * Endpoints that fail contribute nothing rather than failing the whole sync: a
 * night with readiness but no VO2max reading is still worth storing.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(30, Number(url.searchParams.get('days') ?? 7) || 7);

  const client = ouraClient();
  if (!client) {
    return NextResponse.json(
      { ...notWired('oura'), days, hint: 'Set OURA_PAT. See docs/SETUP.md step 7.' },
      { status: 503 },
    );
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, reason: 'supabase_not_configured' }, { status: 503 });
  }

  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const range = { start_date: iso(start), end_date: iso(end) };

  // One call per endpoint, all of them tolerant of individual failure.
  const bundle = await client.fetchDailyBundle(range);
  const { days: rows, warnings } = normalizeOuraBundle(bundle);

  if (rows.length === 0) {
    return NextResponse.json(
      { ok: true, days, upserted: 0, warnings, note: 'Oura returned nothing for this range.' },
      { status: 200 },
    );
  }

  const userId = process.env.LONGEVITY_USER_ID;
  if (!userId) {
    return NextResponse.json(
      { ok: false, reason: 'no_user', hint: 'Set LONGEVITY_USER_ID to the row id in public.users.' },
      { status: 503 },
    );
  }

  const { error } = await supabase
    .from('oura_daily')
    .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: 'user_id,date' });

  if (error) {
    // A failed sync is not an incident. Report it and let the next run retry.
    return NextResponse.json({ ok: false, reason: 'upsert_failed', error: error.message, warnings }, { status: 500 });
  }

  return NextResponse.json({ ok: true, days, upserted: rows.length, warnings });
}

/** Vercel Hobby cron issues GETs, so the two verbs do the same thing. */
export async function GET(request: Request) {
  return POST(request);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
