import { Suspense } from 'react';
import Link from 'next/link';
import { getAdminCheck } from '@/lib/auth';
import { createUserClient } from '@/lib/supabase/server';
import { listSourceInfo } from '@/lib/sync/registry';
import { signOutAction } from './actions';
import { StatusBadge, SyncPanel } from './sync-panel';

// Server Actions on this page (the sync) may run for up to 5 minutes.
export const maxDuration = 300;

export const metadata = { title: 'Admin · School Systems Directory' };

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Fetch data from the configured sources and write it into Supabase.
        </p>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Checking access…</p>}>
        <AdminArea />
      </Suspense>
    </main>
  );
}

/** Reads the session, so it streams in behind the Suspense boundary. */
async function AdminArea() {
  const check = await getAdminCheck();

  if (check.status === 'signed_out') {
    return (
      <p>
        Please{' '}
        <Link href="/login" className="font-medium text-teal-700 underline">
          sign in
        </Link>{' '}
        to use the admin area.
      </p>
    );
  }

  if (check.status === 'not_admin') {
    return (
      <div className="space-y-3">
        <p>
          You are signed in as <strong>{check.email}</strong>, but this account is not an admin.
        </p>
        <SignOut />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
        <span>Signed in as {check.email}</span>
        <SignOut />
      </div>
      <SyncPanel sources={listSourceInfo()} />
      <RecentRuns />
    </div>
  );
}

async function RecentRuns() {
  const supabase = await createUserClient();
  const { data: runs, error } = await supabase
    .schema('core')
    .from('sync_runs')
    .select('id, source_keys, status, dry_run, started_at, finished_at, error')
    .order('started_at', { ascending: false })
    .limit(10);

  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">Recent runs</h2>
      {error && <p className="text-red-700">Could not load runs: {error.message}</p>}
      {!error && (runs ?? []).length === 0 && <p className="text-zinc-500">No syncs yet.</p>}
      {(runs ?? []).length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-1">Started (UTC)</th>
              <th>Sources</th>
              <th>Status</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs!.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 align-top dark:border-zinc-800" title={r.error ?? ''}>
                <td className="py-1">{new Date(r.started_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td>{(r.source_keys as string[]).join(', ')}</td>
                <td>
                  <StatusBadge status={r.status} />
                  {r.dry_run && <span className="ml-1 text-xs text-zinc-500">preview</span>}
                </td>
                <td>
                  {r.finished_at
                    ? `${((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000).toFixed(1)}s`
                    : '…'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SignOut() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="underline">
        Sign out
      </button>
    </form>
  );
}
