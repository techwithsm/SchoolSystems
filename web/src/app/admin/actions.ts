'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { createUserClient } from '@/lib/supabase/server';
import { SYNC_SOURCES } from '@/lib/sync/registry';
import { runSync } from '@/lib/sync/runner';
import type { SyncRunSummary } from '@/lib/sync/types';

export type SyncActionState = { summary: SyncRunSummary | null; error: string | null };

/**
 * "Sync data" button. Re-checks admin access on every call (a Server Action
 * is a public POST endpoint), validates the requested sources, runs the sync.
 */
export async function runSyncAction(_prev: SyncActionState, formData: FormData): Promise<SyncActionState> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return { summary: null, error: 'You must be signed in as an admin to sync data.' };
  }

  const validKeys = new Set(SYNC_SOURCES.map((s) => s.key));
  const keys = formData.getAll('source').map(String).filter((k) => validKeys.has(k));
  if (keys.length === 0) return { summary: null, error: 'Select at least one source.' };

  // The "Preview changes" button submits mode=preview.
  const dryRun = formData.get('mode') === 'preview';

  try {
    const summary = await runSync({ sourceKeys: keys, triggeredBy: admin.userId, dryRun });
    refresh(); // re-render the page so "Recent runs" shows this run
    return { summary, error: summary.runId ? null : (summary.error ?? 'Sync could not start.') };
  } catch (err) {
    console.error('[sync] unexpected error', err);
    return { summary: null, error: 'Sync failed unexpectedly. Check the server logs.' };
  }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  redirect('/login');
}
