import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config';

/**
 * Server client bound to the request's cookies. Returns null in demo mode so
 * callers fall through to fixtures instead of throwing.
 */
export async function serverSupabase() {
  if (!isSupabaseConfigured()) return null;
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component render — middleware refreshes instead.
        }
      },
    },
  });
}

/**
 * Service-role client for route handlers that act without a user session
 * (cron, webhooks). Never import this into a client component.
 */
export function serviceSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!isSupabaseConfigured() || !key) return null;
  return createServerClient(SUPABASE_URL, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

export { isSupabaseConfigured };
