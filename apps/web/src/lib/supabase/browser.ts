'use client';

import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config';

let cached: ReturnType<typeof createBrowserClient> | null = null;

/** Browser client, or null when Supabase is not configured (demo mode). */
export function browserSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (!cached) cached = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}

export { isSupabaseConfigured };
