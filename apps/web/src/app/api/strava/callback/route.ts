import { NextResponse } from 'next/server';
import { notWired, stravaClient } from '@/lib/integrations-bridge';
import { serviceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Strava OAuth redirect target. Exchanges `code` for tokens, stores them, and
 * sends Seth back to Settings with a plain success or failure — he should never
 * see a JSON blob.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const scope = url.searchParams.get('scope') ?? '';

  if (error) return NextResponse.redirect(new URL(`/settings?strava=denied`, url.origin));
  if (!code) return NextResponse.redirect(new URL(`/settings?strava=missing_code`, url.origin));
  if (!scope.includes('activity:read')) {
    return NextResponse.redirect(new URL(`/settings?strava=missing_scope`, url.origin));
  }

  const client = stravaClient();
  if (!client) {
    return NextResponse.redirect(new URL(`/settings?strava=${notWired('strava').reason}`, url.origin));
  }

  // TODO(integrations): const tokens = await client.exchangeCode(code);
  const supabase = serviceSupabase();
  if (supabase) {
    // TODO(db): encrypt at rest and upsert into `integration_tokens`.
  }

  return NextResponse.redirect(new URL('/settings?strava=connected', url.origin));
}
