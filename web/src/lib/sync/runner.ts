import 'server-only';
import { createServiceClient } from '@/lib/supabase/admin';
import { getSources } from './registry';
import type { SourceResult, SyncContext, SyncRunSummary, TableStats } from './types';

/** A run still 'running' after this long is assumed crashed and released. */
const STALE_RUN_MINUTES = 30;

export interface RunSyncOptions {
  /** Source keys to run; empty/undefined = all, in registry order. */
  sourceKeys?: string[];
  /** auth.users id of the admin who clicked the button. */
  triggeredBy: string | null;
  /** Preview only: compute and report changes without writing data. */
  dryRun?: boolean;
}

/** Fresh SourceResult + SyncContext pair for one source (also used by tests). */
export function createSourceRun(
  source: { key: string; label: string },
  db: SyncContext['db'],
  dryRun = false,
): { result: SourceResult; ctx: SyncContext } {
  const result: SourceResult = {
    key: source.key,
    label: source.label,
    status: 'succeeded',
    durationMs: 0,
    tables: {},
    conflicts: [],
    warnings: [],
  };
  return { result, ctx: makeContext(result, db, dryRun) };
}

function makeContext(result: SourceResult, db: SyncContext['db'], dryRun: boolean): SyncContext {
  return {
    db,
    dryRun,
    today: new Date().toISOString().slice(0, 10),
    count(table, kind, n = 1) {
      const t: TableStats = (result.tables[table] ??= { inserted: 0, updated: 0, unchanged: 0, deleted: 0 });
      t[kind] += n;
    },
    conflict(c) {
      result.conflicts.push(c);
    },
    warn(message) {
      result.warnings.push(message);
    },
  };
}

/**
 * Runs the selected sources one after another and records the run in
 * core.sync_runs. A failing source is reported but does not stop the others.
 * Caller MUST have verified the user is an admin.
 */
export async function runSync({ sourceKeys, triggeredBy, dryRun = false }: RunSyncOptions): Promise<SyncRunSummary> {
  const db = createServiceClient();
  const sources = getSources(sourceKeys);
  const startedAt = new Date().toISOString();

  // Release runs left 'running' by a crash or timeout.
  const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  await db
    .schema('core')
    .from('sync_runs')
    .update({ status: 'failed', finished_at: new Date().toISOString(), error: 'Abandoned (timed out or crashed).' })
    .eq('status', 'running')
    .lt('started_at', staleBefore);

  // Take the lock: the unique index allows only one 'running' row.
  const { data: run, error: lockError } = await db
    .schema('core')
    .from('sync_runs')
    .insert({
      source_keys: sources.map((s) => s.key),
      triggered_by: triggeredBy,
      status: 'running',
      dry_run: dryRun,
      started_at: startedAt, // same clock as finished_at, so durations are accurate
    })
    .select('id')
    .single();

  if (lockError) {
    const busy = lockError.code === '23505';
    return {
      runId: null,
      dryRun,
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      sources: [],
      error: busy ? 'Another sync is already running. Try again when it finishes.' : `Could not start sync: ${lockError.message}`,
    };
  }

  const results: SourceResult[] = [];
  for (const source of sources) {
    const { result, ctx } = createSourceRun(source, db, dryRun);
    const t0 = Date.now();
    try {
      await source.run(ctx);
    } catch (err) {
      result.status = 'failed';
      result.error = err instanceof Error ? err.message : String(err);
      console.error(`[sync] ${source.key} failed:`, err);
    }
    result.durationMs = Date.now() - t0;
    results.push(result);
  }

  const failed = results.filter((r) => r.status === 'failed').length;
  const status: SyncRunSummary['status'] = failed === 0 ? 'succeeded' : failed === results.length ? 'failed' : 'partial';
  const finishedAt = new Date().toISOString();

  const { error: finishError } = await db
    .schema('core')
    .from('sync_runs')
    .update({
      status,
      finished_at: finishedAt,
      summary: { sources: results },
      error: failed ? results.filter((r) => r.error).map((r) => `${r.key}: ${r.error}`).join('\n') : null,
    })
    .eq('id', run.id);
  if (finishError) console.error('[sync] could not record run result:', finishError.message);

  return { runId: run.id, dryRun, status, startedAt, finishedAt, sources: results };
}
