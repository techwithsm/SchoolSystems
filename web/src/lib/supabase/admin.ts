import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

/**
 * Supabase client with the SERVICE ROLE key. Bypasses RLS, so it can write to
 * every table. Only call this after the caller has been verified as an admin
 * (see requireAdmin in src/lib/auth.ts). The 'server-only' import makes the
 * build fail if this file is ever imported into browser code.
 */
export function createServiceClient(): SupabaseClient {
  return createClient(publicEnv.supabaseUrl(), serverEnv.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
