import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { exchangeCode, statesMatch } from '@longevity/integrations';
import { ouraCredentials, ouraRedirectUri, ouraTokenStore } from '@/lib/integrations-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Oura OAuth2 redirect target.
 *
 * Exchanges the code for a token set, persists it ENCRYPTED via the token store
 * (`integration_tokens` when deployed), and sends Seth back to Settings with a
 * plain outcome. He never sees a JSON blob, and no token, code or verifier is
 * ever put in a redirect URL or a log line.
 *
 * Failure is always a redirect with a short machine-readable `reason`, so the
 * Settings screen can say something specific without this route rendering UI.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const done = (params: string): NextResponse => {
    const res = NextResponse.redirect(new URL(`/settings?${params}`, url.origin));
    // The flow is over either way: do not leave a verifier lying around.
    res.cookies.delete('oura_oauth_state');
    res.cookies.delete('oura_oauth_verifier');
    return res;
  };

  const denied = url.searchParams.get('error');
  if (denied) return done(`oura=failed&reason=${encodeURIComponent(denied)}`);

  const code = url.searchParams.get('code');
  if (!code) return done('oura=failed&reason=missing_code');

  const jar = await cookies();
  const expectedState = jar.get('oura_oauth_state')?.value ?? '';
  const codeVerifier = jar.get('oura_oauth_verifier')?.value ?? '';

  // A mismatched or missing state means this redirect did not come from a flow
  // this server started. Nothing is exchanged.
  if (!statesMatch(expectedState, url.searchParams.get('state'))) {
    return done('oura=failed&reason=state_mismatch');
  }
  if (!codeVerifier) return done('oura=failed&reason=expired');

  const creds = ouraCredentials();
  if (!creds) return done('oura=failed&reason=not_configured');

  const store = ouraTokenStore();
  if (!store) return done('oura=failed&reason=no_token_key');

  const exchanged = await exchangeCode({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    code,
    redirectUri: ouraRedirectUri(url.origin),
    codeVerifier,
  });
  if (!exchanged.ok) {
    console.error('[oura/callback] exchange failed', exchanged.error.kind, exchanged.error.message);
    return done(`oura=failed&reason=${encodeURIComponent(exchanged.error.kind)}`);
  }

  // Persist before declaring success: a token set that was not written is a
  // connection that does not exist, and the code cannot be exchanged twice.
  try {
    await store.save(exchanged.value);
  } catch (e) {
    console.error('[oura/callback] could not persist tokens', e);
    return done('oura=failed&reason=save_failed');
  }

  return done('oura=connected');
}
