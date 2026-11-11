import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;

/** Counts for one table touched by a source. */
export interface TableStats {
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
}

/**
 * A value the sync did NOT write because a different, curated source already
 * backs a different value. Shown to the admin to decide manually.
 */
export interface SyncConflict {
  table: string;
  entity: string;
  field: string;
  current: unknown;
  incoming: unknown;
  note?: string;
}

export interface SourceResult {
  key: string;
  label: string;
  status: 'succeeded' | 'failed';
  durationMs: number;
  tables: Record<string, TableStats>;
  conflicts: SyncConflict[];
  warnings: string[];
  error?: string;
}

/** Everything a source needs while running. Created fresh for each source. */
export interface SyncContext {
  /** Service-role client (bypasses RLS). Server only. */
  db: SupabaseClient;
  /** Today's date as YYYY-MM-DD, used for citations' accessed_on. */
  today: string;
  /** Preview mode: read and diff as normal, count what WOULD change, write nothing. */
  dryRun: boolean;
  /** Epoch ms by which the source should stop (page/request time limit), or null = no limit. */
  deadline: number | null;
  /** Record inserted/updated/unchanged counts. */
  count(table: string, kind: keyof TableStats, n?: number): void;
  conflict(c: SyncConflict): void;
  warn(message: string): void;
}

/**
 * A pluggable data source. To add one: implement this interface in
 * src/lib/sync/sources/ and register it in src/lib/sync/registry.ts.
 */
export interface SyncSource {
  key: string;
  label: string;
  description: string;
  /** True for sources that write institutions: the website check then follows automatically. */
  writesInstitutions?: boolean;
  run(ctx: SyncContext): Promise<void>;
}

export interface SyncRunSummary {
  runId: string | null;
  dryRun: boolean;
  status: 'succeeded' | 'partial' | 'failed';
  startedAt: string;
  finishedAt: string;
  sources: SourceResult[];
  error?: string;
}
