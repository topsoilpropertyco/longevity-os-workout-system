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
 *
 * Auth is OAuth2 since Oura retired personal access tokens in December 2025.
 * The bearer is resolved per request from the token store, which refreshes and
 * re-persists it when it is inside its expiry skew.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(30, Number(url.searchParams.get('days') ?? 7) || 7);

  const client = await ouraClient();
  if (!client) {
    return NextResponse.json(
      {
        ...notWired('oura'),
        days,
        hint: 'Set OURA_CLIENT_ID, OURA_CLIENT_SECRET and OURA_TOKEN_KEY, then connect Oura. See docs/SETUP.md step 8.',
      },
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

  // 409, not 500. A dead grant is not a transient fault: retrying cannot fix
  // it, so a 5xx would put this in the "flaky upstream" bucket and get itself
  // retried forever by the cron. Only a human opening a browser fixes it, and
  // the status code has to say that out loud.
  if (bundle.errors.some((e) => e.kind === 'needs_reauth')) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'needs_reauth',
        days,
        message:
          'Oura needs to be re-authorised in a browser. Open Settings → Connect Oura, or run ' +
          '`npx tsx scripts/oura-auth.ts`. Retrying this endpoint will not help.',
        detail: bundle.errors.find((e) => e.kind === 'needs_reauth')?.message,
      },
      { status: 409 },
    );
  }

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
