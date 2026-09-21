import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * Session refresh, on every request.
 *
 * Supabase access tokens last an hour. The refresh token that renews them lives
 * in a cookie, and only a server round trip can rotate it — a Server Component
 * cannot set a cookie mid-render. Without this file the session dies quietly
 * about an hour after he signs in, and the next time he opens the app in a gym
 * he is at the sign-in screen instead of his session. With it, one tap lasts as
 * long as he keeps opening the app.
 *
 * It also decides who gets in at all. An unauthenticated visitor must not land
 * on a today card full of fixtures that looks like real data — that is worse
 * than a locked door, because nothing on the screen says it is fiction.
 */

/** Reachable without a session. Everything else redirects to /sign-in. */
const PUBLIC_PATHS = ['/sign-in', '/auth'];

export async function middleware(request: NextRequest) {
  // The cold-clone path. No Supabase means no accounts, no RLS and no way to
  // sign in — the fixtures ARE the product here, and gating them would leave
  // `npm run dev` on a fresh checkout staring at a form it cannot submit.
  if (!isSupabaseConfigured()) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list: { name: string; value: string; options?: CookieOptions }[]) {
        // Rotated cookies have to reach BOTH the downstream render (via the
        // request) and the browser (via the response), or the page renders
        // against the token that was just replaced.
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Nothing may go between the client and this call. `getUser()` is what
  // performs the refresh; anything awaited first can land after the response
  // has been built, and the rotated cookie is then dropped on the floor.
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    // Come back to whatever he was reaching for. `/` is the default, so it does
    // not need saying.
    if (pathname !== '/') url.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   _next/*                 build output
     *   api/*                   machine endpoints. Telegram, Strava and Vercel
     *                           cron send no cookies; bouncing them to a sign-in
     *                           page would break every webhook. They carry their
     *                           own secrets.
     *   the PWA files + icons   fetched by iOS before any session exists
     */
    '/((?!_next/static|_next/image|api/|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/).*)',
  ],
};
