import { chunk } from './http';
import type { Row, SyncContext } from './types';

export interface SyncRowsOptions {
  schema: 'core' | 'edu';
  table: string;
  /** Primary-key (or unique) columns used to match existing rows. */
  keyColumns: string[];
  rows: Row[];
  /**
   * For fact-bearing tables: new or changed rows get
   * verification_status = 'needs_verification' and last_verified = NULL.
   * Unchanged rows keep whatever status a human gave them.
   */
  tracksVerification?: boolean;
  /**
   * For big tables: load existing rows with these equality filters (paged)
   * instead of looking them up key by key. Must cover every row in `rows`.
   */
  scope?: Record<string, string>;
}

/** Loose equality that treats 6, 6.0 and '6.0' as equal and undefined as null. */
export function sameValue(a: unknown, b: unknown): boolean {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  if (na === null || nb === null) return na === nb;
  const numA = typeof na === 'number' ? na : typeof na === 'string' && na.trim() !== '' ? Number(na) : NaN;
  const numB = typeof nb === 'number' ? nb : typeof nb === 'string' && nb.trim() !== '' ? Number(nb) : NaN;
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && (typeof na === 'number' || typeof nb === 'number')) {
    return numA === numB;
  }
  if (typeof na === 'object' || typeof nb === 'object') return JSON.stringify(na) === JSON.stringify(nb);
  return na === nb;
}

const keyOf = (row: Row, cols: string[]) => cols.map((c) => String(row[c] ?? '')).join('\u0000');

const INSERT_BATCH = 250;

/** Network drops, timeouts and 5xx are worth retrying; data errors are not. */
function isTransient(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('socket') ||
    /^5\d\d$/.test(error.code ?? '') ||
    error.code === '' // supabase-js uses an empty code for transport errors
  );
}

/** Runs a Supabase write, retrying transient failures with backoff (1s, 2s, 4s, 8s). */
async function withRetry<T extends { error: { message?: string; code?: string } | null }>(
  label: string,
  write: () => PromiseLike<T>,
  attempts = 5,
): Promise<T> {
  let result = await write();
  for (let i = 1; i < attempts && isTransient(result.error); i++) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
    console.warn(`[sync] ${label}: retry ${i} after "${result.error?.message}"`);
    result = await write();
  }
  return result;
}

/**
 * Diff-based upsert: reads the current rows, then inserts new ones, updates
 * only rows whose supplied columns changed, and leaves the rest alone.
 * Columns not present in `rows` are never touched.
 */
export async function syncRows(ctx: SyncContext, opts: SyncRowsOptions): Promise<void> {
  const { schema, table, keyColumns, rows, tracksVerification = false } = opts;
  const label = `${schema}.${table}`;
  if (rows.length === 0) return;

  const columns = Array.from(new Set([...keyColumns, ...rows.flatMap((r) => Object.keys(r))]));

  // 1. Load the existing rows that could match: a whole scope page by page,
  //    or by the first key column.
  const firstKey = keyColumns[0];
  const existing = new Map<string, Row>();
  if (opts.scope) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = ctx.db.schema(schema).from(table).select(columns.join(','));
      for (const [col, val] of Object.entries(opts.scope)) q = q.eq(col, val);
      const { data, error } = await q.order(keyColumns[0]).range(from, from + PAGE - 1);
      if (error) throw new Error(`${label}: read failed: ${error.message}`);
      for (const r of (data ?? []) as unknown as Row[]) existing.set(keyOf(r, keyColumns), r);
      if (!data || data.length < PAGE) break;
    }
  }
  const lookupValues = opts.scope
    ? []
    : Array.from(new Set(rows.map((r) => r[firstKey]).filter((v) => v != null)));
  for (const part of chunk(lookupValues, 200)) {
    const { data, error } = await ctx.db
      .schema(schema)
      .from(table)
      .select(columns.join(','))
      .in(firstKey, part as string[]);
    if (error) throw new Error(`${label}: read failed: ${error.message}`);
    for (const r of (data ?? []) as unknown as Row[]) existing.set(keyOf(r, keyColumns), r);
  }

  // 2. Work out what changed.
  const toInsert: Row[] = [];
  const toUpdate: Row[] = [];
  for (const row of rows) {
    const current = existing.get(keyOf(row, keyColumns));
    if (!current) {
      toInsert.push(tracksVerification ? { ...row, verification_status: 'needs_verification' } : row);
      continue;
    }
    const changed = Object.keys(row).some((c) => !sameValue(row[c], current[c]));
    if (!changed) {
      ctx.count(label, 'unchanged');
      continue;
    }
    toUpdate.push(
      tracksVerification ? { ...row, verification_status: 'needs_verification', last_verified: null } : row,
    );
  }

  // 3. Write (or, in a dry run, only count).
  if (ctx.dryRun) {
    if (toInsert.length) ctx.count(label, 'inserted', toInsert.length);
    if (toUpdate.length) ctx.count(label, 'updated', toUpdate.length);
    return;
  }
  for (const part of chunk(toInsert, INSERT_BATCH)) {
    // "Insert, skip rows whose key already exists": safe to retry if a
    // dropped connection hid the fact that the first attempt succeeded.
    const { error } = await withRetry(label, () =>
      ctx.db
        .schema(schema)
        .from(table)
        .upsert(part, { onConflict: keyColumns.join(','), ignoreDuplicates: true, defaultToNull: false }),
    );
    if (error) throw new Error(`${label}: insert failed: ${error.message}`);
    ctx.count(label, 'inserted', part.length);
  }
  for (const row of toUpdate) {
    const { error } = await withRetry(label, () => {
      let q = ctx.db.schema(schema).from(table).update(row);
      for (const c of keyColumns) q = q.eq(c, row[c] as string);
      return q;
    });
    if (error) throw new Error(`${label}: update failed: ${error.message}`);
    ctx.count(label, 'updated');
  }
}
