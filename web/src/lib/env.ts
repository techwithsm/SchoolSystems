// Central place for environment variables, so a missing value fails loudly
// with a clear message instead of an obscure Supabase error.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Add it to web/.env.local (see .env.example).`);
  }
  return value;
}

/** Safe for the browser: project URL and the public (anon/publishable) key. */
export const publicEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
};

/** Server only. The service_role key bypasses RLS: never expose it to the browser. */
export const serverEnv = {
  supabaseServiceRoleKey: () =>
    required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
};
