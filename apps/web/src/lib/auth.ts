import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { DEMO_USER_ID } from './fixtures/demo';
import { isSupabaseConfigured, serverSupabase } from './supabase/server';

export { DEMO_USER_ID, isSupabaseConfigured };

/** The cookie-bound client `serverSupabase()` hands back, minus the null. */
type ServerClient = NonNullable<Awaited<ReturnType<typeof serverSupabase>>>;

/**
 * Who is asking. Three states, and the app has to tell them apart:
 *
 *   demo      — no Supabase in the environment at all. This is the cold-clone
 *               path: every query is skipped and the fixture athlete renders.
 *               `DEMO_USER_ID` is not a uuid and is never sent to Postgres.
 *   member    — a real signed-in athlete. `userId` is the auth.users uuid, and
 *               it is the only value RLS will ever match (0002_rls.sql keys
 *               every policy on auth.uid()).
 *   anonymous — Supabase is configured but there is no session. Querying with
 *               any id here returns zero rows, which `loadPlanInput` would
 *               quietly turn back into fixtures — a demo pretending to be his
 *               own data. So callers redirect instead of falling through.
 */
export type Viewer =
  | { kind: 'demo'; userId: string; email: null }
  | { kind: 'member'; userId: string; email: string | null }
  | { kind: 'anonymous'; userId: null; email: null };

const DEMO_VIEWER: Viewer = { kind: 'demo', userId: DEMO_USER_ID, email: null };
const ANONYMOUS: Viewer = { kind: 'anonymous', userId: null, email: null };

/**
 * `getUser()` revalidates the JWT against the auth server, so it is a network
 * call — React `cache` collapses it to one per request no matter how many
 * components ask. Middleware has already refreshed the cookie by the time any
 * of this runs.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = await serverSupabase();
  if (!supabase) return DEMO_VIEWER;

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return ANONYMOUS;
    return { kind: 'member', userId: data.user.id, email: data.user.email ?? null };
  } catch {
    // Auth server unreachable. Treating this as "signed in" would show fixtures
    // as if they were his; treating it as anonymous sends him somewhere that
    // says so.
    return ANONYMOUS;
  }
});

/**
 * The id every user-scoped query is filtered by. Sends an unauthenticated
 * visitor to the sign-in page rather than returning a value that matches
 * nothing.
 */
export async function requireUserId(): Promise<string> {
  const viewer = await getViewer();
  if (!viewer.userId) redirect('/sign-in');
  return viewer.userId;
}

/**
 * The same id for server actions, which must not redirect mid-write — they
 * report the failure and leave the cookie-level preference in place.
 */
export async function signedInUserId(): Promise<string | null> {
  return (await getViewer()).userId;
}

/**
 * Make sure the athlete has a `public.users` row.
 *
 * `auth.users` and `public.users` are different tables: every RLS policy and
 * every `user_id` foreign key points at the latter, so without this row he can
 * read (nothing) but cannot write a single set. `0012_auth_bootstrap.sql`
 * normally creates it from a trigger; this runs on the sign-in callback as the
 * belt to that migration's braces, because a deploy where 0012 was never pasted
 * into the SQL editor would otherwise fail on the first logged set — hours
 * later, in a gym.
 *
 * Allowed by the `users_insert_self` policy: the check is `auth.uid() = id`,
 * and this runs on his own session.
 */
export async function ensureProfile(
  supabase: ServerClient,
  user: { id: string; email?: string | undefined },
): Promise<void> {
  try {
    await supabase
      .from('users')
      .upsert({ id: user.id, ...(user.email ? { email: user.email } : {}) }, { onConflict: 'id' });
  } catch {
    // Never block a sign-in on this. The trigger is the primary path.
  }
}
