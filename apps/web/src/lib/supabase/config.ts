/**
 * Supabase configuration probe.
 *
 * The app must render on a cold clone with no environment at all — that is the
 * demo-data path. Everything that touches the database checks this first.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

export function hasServiceRole(): boolean {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').length > 0;
}
