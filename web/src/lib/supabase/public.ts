import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';

let client: SupabaseClient | null = null;

/**
 * Anonymous Supabase client for public pages (no login, no cookies).
 * Uses the anon key, so RLS allows read-only access to public data.
 */
export function createPublicClient(): SupabaseClient {
  client ??= createClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
