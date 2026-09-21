import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import type { EmailOtpType } from '@supabase/supabase-js';
import { ensureProfile } from '@/lib/auth';
import { serverSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where the magic link lands.
 *
 * TWO SHAPES ARRIVE HERE, and both have to work:
 *
 *   ?token_hash=…&type=email   Supabase's hashed-token form, verified entirely
 *                              server-side. It needs nothing stored in the
 *                              browser, so it survives the link being opened in
 *                              Gmail's in-app browser instead of the Safari tab
 *                              that asked for it — which on an iPhone is the
 *                              normal case, not the edge case. Getting this form
 *                              requires the one-line email-template change in
 *                              docs/SETUP.md.
 *
 *   ?code=…                    the PKCE form the default Supabase email template
 *                              produces. The verifier lives in a cookie written
 *                              when the link was requested, so it only works in
 *                              the same browser — but it works with zero
 *                              dashboard configuration, which is what a first
 *                              deploy has.
 *
 * Failure never renders anything: it goes back to /sign-in with a short reason
 * the page turns into a sentence. No token, code or verifier is ever put in a
 * redirect URL or a log line.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = await publicOrigin(url);

  const raw = url.searchParams.get('next');
  // Only a path on this app — see the same guard on the sign-in page.
  const next = raw?.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  const back = (reason: string) => NextResponse.redirect(new URL(`/sign-in?reason=${reason}`, origin));

  // Supabase reports a refused or stale link in the query string itself.
  if (url.searchParams.get('error')) {
    return back(url.searchParams.get('error_code') === 'otp_expired' ? 'expired' : 'failed');
  }

  const supabase = await serverSupabase();
  // No Supabase configured means no session to create; the demo path owns the
  // app and there is nowhere useful to send him but home.
  if (!supabase) return NextResponse.redirect(new URL('/', origin));

  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const code = url.searchParams.get('code');

  const outcome = tokenHash
    ? await supabase.auth.verifyOtp({ type: (type ?? 'email') as EmailOtpType, token_hash: tokenHash })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : null;

  if (!outcome) return back('failed');
  if (outcome.error) {
    const message = outcome.error.message.toLowerCase();
    if (message.includes('expired') || message.includes('invalid')) return back('expired');
    // "both auth code and code verifier should be non-empty" — the PKCE link was
    // opened somewhere other than where it was asked for.
    if (message.includes('verifier')) return back('mismatch');
    return back('failed');
  }

  const user = outcome.data.user;
  if (!user) return back('failed');

  // First sign-in creates the public.users row every foreign key points at.
  await ensureProfile(supabase, { id: user.id, ...(user.email ? { email: user.email } : {}) });

  return NextResponse.redirect(new URL(next, origin));
}

/**
 * The origin the phone actually typed, not the one the container answered on.
 * Behind Vercel `request.url` carries the internal host, and redirecting to it
 * would drop him on a URL his session cookie is not scoped to.
 */
async function publicOrigin(url: URL): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return url.origin;
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
