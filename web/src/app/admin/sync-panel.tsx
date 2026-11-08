'use client';

import { useActionState, useState } from 'react';
import { runSyncAction, type SyncActionState } from './actions';
import type { SourceResult } from '@/lib/sync/types';

type SourceInfo = { key: string; label: string; description: string };

const initialState: SyncActionState = { summary: null, error: null };

export function SyncPanel({ sources }: { sources: SourceInfo[] }) {
  const [state, formAction, pending] = useActionState(runSyncAction, initialState);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sources.map((s) => s.key)));
  const allSelected = selected.size === sources.length;
  const noneSelected = selected.size === 0;

  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const smallButton =
    'rounded-md border border-cyan-200 bg-white px-3 py-1 text-sm font-medium text-teal-800 hover:border-teal-400 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section className="space-y-6">
      <form action={formAction} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
        <fieldset className="space-y-3" disabled={pending}>
          <legend className="sr-only">Sources to sync</legend>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-100 pb-3">
            <span className="font-semibold">
              Sources to sync{' '}
              <span className="text-sm font-normal text-zinc-500">
                ({selected.size} of {sources.length} selected)
              </span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className={smallButton}
                disabled={allSelected}
                onClick={() => setSelected(new Set(sources.map((s) => s.key)))}
              >
                Select all
              </button>
              <button type="button" className={smallButton} disabled={noneSelected} onClick={() => setSelected(new Set())}>
                Deselect all
              </button>
            </div>
          </div>

          {sources.map((s) => (
            <label key={s.key} className="flex cursor-pointer gap-3 rounded-md p-1 hover:bg-cyan-50/60">
              <input
                type="checkbox"
                name="source"
                value={s.key}
                checked={selected.has(s.key)}
                onChange={(e) => toggle(s.key, e.currentTarget.checked)}
                className="mt-1 accent-teal-600"
              />
              <span>
                <span className="font-medium">{s.label}</span>
                <span className="block text-sm text-zinc-600">{s.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            name="mode"
            value="sync"
            disabled={pending || noneSelected}
            className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-700 disabled:cursor-wait disabled:opacity-60"
          >
            Sync data
          </button>
          <button
            type="submit"
            name="mode"
            value="preview"
            disabled={pending || noneSelected}
            className="rounded-md border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Preview changes
          </button>
          {pending && <span className="text-sm text-zinc-500">Working… this can take a minute.</span>}
          {!pending && noneSelected && <span className="text-sm text-zinc-500">Select at least one source.</span>}
        </div>
      </form>

      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">
          {state.error}
        </p>
      )}

      {state.summary && state.summary.sources.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {state.summary.dryRun ? 'Preview (nothing was written)' : 'Result'}:{' '}
            <StatusBadge status={state.summary.status} />
          </h2>
          {state.summary.sources.map((r) => (
            <SourceResultCard key={r.key} result={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'succeeded'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'partial'
        ? 'bg-amber-100 text-amber-800'
        : status === 'running'
          ? 'bg-sky-100 text-sky-800'
          : 'bg-red-100 text-red-800';
  return <span className={`rounded px-2 py-0.5 text-sm font-medium ${color}`}>{status}</span>;
}

function SourceResultCard({ result }: { result: SourceResult }) {
  const tables = Object.entries(result.tables);
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{result.label}</h3>
        <span className="text-sm text-zinc-500">
          <StatusBadge status={result.status} /> {(result.durationMs / 1000).toFixed(1)}s
        </span>
      </div>

      {result.error && <pre className="mb-2 whitespace-pre-wrap text-sm text-red-700">{result.error}</pre>}

      {tables.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-1">Table</th>
              <th>Inserted</th>
              <th>Updated</th>
              <th>Unchanged</th>
              <th>Deleted</th>
            </tr>
          </thead>
          <tbody>
            {tables.map(([name, t]) => (
              <tr key={name} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 font-mono">{name}</td>
                <td>{t.inserted}</td>
                <td>{t.updated}</td>
                <td>{t.unchanged}</td>
                <td>{t.deleted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result.conflicts.length > 0 && (
        <details className="mt-3" open>
          <summary className="cursor-pointer font-medium text-amber-700">
            {result.conflicts.length} conflict(s) kept for manual review
          </summary>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {result.conflicts.map((c, i) => (
              <li key={i}>
                {c.entity} · <span className="font-mono">{c.field}</span>: current {String(c.current)}, incoming{' '}
                {String(c.incoming)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.warnings.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-zinc-600">{result.warnings.length} warning(s)</summary>
          <ul className="mt-1 list-disc pl-5 text-sm text-zinc-600">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export { StatusBadge };
