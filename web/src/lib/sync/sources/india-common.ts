import { stableId } from '../ids';
import type { Row, SyncContext } from '../types';

/** Shared by the India institution sources (AISHE file, Wikidata). */

/** Normalized name used for matching and for university ids. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Colleges / standalone institutions are keyed by AISHE code. */
export const collegeId = (aisheCode: string) => stableId(`IN/aishe/${aisheCode}`);
/** Universities are keyed by normalized name (an affiliation may give only the name). */
export const universityId = (name: string) => stableId(`IN/univ/${norm(name)}`);
/** core.sources id of the official AISHE directory file import. */
export const AISHE_FILE_SOURCE_ID = stableId('IN/src/aishe_directory');

const STATE_ALIASES: Record<string, string> = {
  orissa: 'odisha',
  pondicherry: 'puducherry',
  uttaranchal: 'uttarakhand',
  'nct of delhi': 'delhi',
  'andaman and nicobar': 'andaman and nicobar islands',
  'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman and diu': 'dadra and nagar haveli and daman and diu',
};

/** ISO 3166-2 codes changed on 2023-11-23; older data still uses the old ones. */
const OLD_ISO: Record<string, string> = { 'IN-OR': 'IN-OD', 'IN-CT': 'IN-CG', 'IN-TG': 'IN-TS', 'IN-UT': 'IN-UK' };

/** Loads India's states/UTs and returns lookups by name and by ISO code. */
export async function loadIndiaStates(ctx: SyncContext) {
  const { data, error } = await ctx.db.schema('core').from('subdivisions').select('code, name').eq('country_iso2', 'IN');
  if (error) throw new Error(`core.subdivisions: read failed: ${error.message}`);
  if (!data?.length) throw new Error('India states missing in core.subdivisions. Apply migration 20261107000600 first.');
  const byName = new Map(data.map((s) => [norm(s.name), s.code as string]));
  const codes = new Set(data.map((s) => s.code as string));
  return {
    fromName: (s: string | null) => (s ? (byName.get(STATE_ALIASES[norm(s)] ?? norm(s)) ?? null) : null),
    fromIso: (iso: string | null) => {
      if (!iso) return null;
      const c = OLD_ISO[iso.toUpperCase()] ?? iso.toUpperCase();
      return codes.has(c) ? c : null;
    },
  };
}

export function cleanYear(text: string | null): number | null {
  const m = text?.match(/\b(1\d{3}|20\d{2})\b/);
  const y = m ? Number(m[1]) : NaN;
  return y >= 1000 && y <= new Date().getUTCFullYear() + 1 ? y : null;
}

export const cleanEmail = (s: string | null) =>
  s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.replace(/^mailto:/i, '')) ? s.replace(/^mailto:/i, '').toLowerCase() : null;
export const cleanPhone = (s: string | null) => {
  const v = s?.replace(/^tel:/i, '') ?? null;
  return v && /^\+?[0-9 ()./-]{5,30}$/.test(v) ? v : null;
};
export const cleanUrl = (s: string | null) => {
  if (!s) return null;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(u) ? u : null;
};

/** Standard management code from AISHE management / university type text, or null. */
export function mapManagement(text: string | null): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes('private')) {
    if (/un[\s-]?aided/.test(t) || t.includes('self financ')) return 'private';
    if (t.includes('aided')) return 'government_aided';
    return 'private';
  }
  if (t.includes('aided')) return 'government_aided';
  if (/(central|state public|government|govt|national importance|open university|local body|municipal|public)/.test(t)) return 'government';
  return null;
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
