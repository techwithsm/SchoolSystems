import 'server-only';
import { createUserClient } from '@/lib/supabase/server';

export type AdminCheck =
  | { status: 'signed_out' }
  | { status: 'not_admin'; userId: string; email: string | null }
  | { status: 'admin'; userId: string; email: string | null };

/**
 * Who is calling, and are they an admin?
 * getClaims() verifies the session JWT; the admin check reads core.admin_users,
 * whose RLS policy only lets a user see their own row.
 */
export async function getAdminCheck(): Promise<AdminCheck> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return { status: 'signed_out' };

  const userId = claims.sub;
  const email = typeof claims.email === 'string' ? claims.email : null;

  const { data: row } = await supabase
    .schema('core')
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  return row ? { status: 'admin', userId, email } : { status: 'not_admin', userId, email };
}

/** For Server Actions / Route Handlers: throws unless the caller is an admin. */
export async function requireAdmin(): Promise<{ userId: string; email: string | null }> {
  const check = await getAdminCheck();
  if (check.status !== 'admin') throw new Error('Forbidden: admin access required.');
  return { userId: check.userId, email: check.email };
}
