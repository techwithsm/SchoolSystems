import 'server-only';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Supabase client acting AS THE SIGNED-IN USER (anon key + their session
 * cookie). Every query goes through RLS. Use in Server Components, Server
 * Actions and Route Handlers.
 */
export async function createUserClient() {
  // Supabase reads the clock (Date.now) to check token expiry. connection()
  // marks this work as per-request, so Cache Components / partial prefetching
  // never try to prerender it ("unstable value Date.now()" error otherwise).
  await connection();
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: src/proxy.ts refreshes the session cookie.
        }
      },
    },
  });
}
