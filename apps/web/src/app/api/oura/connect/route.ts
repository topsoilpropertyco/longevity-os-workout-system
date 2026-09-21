import { NextResponse } from 'next/server';
import { buildAuthUrl, generatePkce, generateState } from '@longevity/integrations';
import { ouraCredentials, ouraRedirectUri, ouraTokenStore } from '@/lib/integrations-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start the Oura OAuth2 flow (PKCE, S256).
 *
 * Oura retired personal access tokens in December 2025, so connecting Oura from
 * the app means a real authorization-code round trip. This route only builds
 * the URL and parks the two secrets the callback will need:
 *
 *   `oura_oauth_state`    anti-CSRF nonce, compared on the way back
 *   `oura_oauth_verifier` the PKCE verifier, which must never leave the server
 *
 * Both are httpOnly and expire in ten minutes — long enough to sign in to Oura
 * on a phone, short enough that an abandoned attempt leaves nothing behind.
 *
 * The CLI (`npx tsx scripts/oura-auth.ts`) does the same thing with no
 * deployment; this is the same flow for someone already looking at Settings.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const settings = (params: string): NextResponse =>
    NextResponse.redirect(new URL(`/settings?${params}`, url.origin));

  const creds = ouraCredentials();
  if (!creds) return settings('oura=failed&reason=not_configured');
  if (!ouraTokenStore()) return settings('oura=failed&reason=no_token_key');

  const pkce = generatePkce();
  const state = generateState();

  const res = NextResponse.redirect(
    buildAuthUrl({
      clientId: creds.clientId,
      redirectUri: ouraRedirectUri(url.origin),
      state,
      codeChallenge: pkce.challenge,
    }),
  );

  const secure = url.protocol === 'https:';
  const common = { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 600 } as const;
  res.cookies.set('oura_oauth_state', state, common);
  res.cookies.set('oura_oauth_verifier', pkce.verifier, common);
  return res;
}
