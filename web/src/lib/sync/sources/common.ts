import { syncRows } from '../upsert';
import type { Row, SyncContext } from '../types';

/** Helpers shared by the institution sources of every country. */

export function cleanYear(text: string | null): number | null {
  const m = text?.match(/\b(1\d{3}|20\d{2})\b/);
  const y = m ? Number(m[1]) : NaN;
  return y >= 1000 && y <= new Date().getUTCFullYear() + 1 ? y : null;
}

export const cleanEmail = (s: string | null) =>
  s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.replace(/^mailto:/i, '').trim())
    ? s.replace(/^mailto:/i, '').trim().toLowerCase()
    : null;

export const cleanPhone = (s: string | null) => {
  const v = s?.replace(/^tel:/i, '').trim() ?? null;
  return v && /^\+?[0-9 ()./-]{5,30}$/.test(v) ? v : null;
};

export const cleanUrl = (s: string | null) => {
  if (!s) return null;
  const t = s.trim();
  const u = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  return /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(u) ? u : null;
};

/** Latitude/longitude rounded to the column precision, or null if out of range. */
export function cleanCoord(v: string | number | null | undefined, min: number, max: number): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max && n !== 0 ? Math.round(n * 1e6) / 1e6 : null;
}

/** Counts unmapped values so the admin sees e.g. "management 'Xyz' (120 rows)". */
export class Tally {
  private m = new Map<string, number>();
  add(k: string) {
    this.m.set(k, (this.m.get(k) ?? 0) + 1);
  }
  report(ctx: SyncContext, label: string) {
    for (const [k, n] of [...this.m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      ctx.warn(`${label} '${k}' could not be mapped (${n} rows); left empty`);
    }
  }
}

/** All rows in one insert batch must have the same columns (missing -> null). */
export function uniform(rows: Row[]): Row[] {
  const cols = new Set(rows.flatMap((r) => Object.keys(r)));
  return rows.map((r) => Object.fromEntries([...cols].map((c) => [c, r[c] ?? null])));
}

/** Makes sure a country's states/provinces exist in core.subdivisions (ISO 3166-2). */
export async function ensureSubdivisions(
  ctx: SyncContext,
  countryIso2: string,
  list: Record<string, [name: string, type: string]>,
): Promise<void> {
  await syncRows(ctx, {
    schema: 'core',
    table: 'subdivisions',
    keyColumns: ['code'],
    rows: Object.entries(list).map(([code, [name, type]]) => ({ code, country_iso2: countryIso2, name, type })),
  });
}

/**
 * Writes a country's institutions with the paged diff. The comparison covers
 * all of the country's rows (not one type), so an institution that changes
 * from college to university is updated rather than skipped. Universities go
 * first so colleges can reference them.
 */
export async function writeInstitutions(ctx: SyncContext, countryIso2: string, rows: Row[]): Promise<void> {
  const rank = (r: Row) => (r.school_type_code === 'higher_ed_university' ? 0 : 1);
  await syncRows(ctx, {
    schema: 'edu',
    table: 'schools',
    keyColumns: ['id'],
    tracksVerification: true,
    scope: { country_iso2: countryIso2 },
    rows: uniform([...rows].sort((a, b) => rank(a) - rank(b))),
  });
}

/** Runs async jobs with limited parallelism, preserving input order in the results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
