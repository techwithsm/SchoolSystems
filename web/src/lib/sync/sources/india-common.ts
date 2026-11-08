import { stableId } from '../ids';
import type { Row, SyncContext } from '../types';

// Generic helpers live in ./common; re-exported for the India sources.
export { cleanEmail, cleanPhone, cleanUrl, cleanYear, Tally, uniform } from './common';

/** Shared by the India institution sources (AISHE file, Wikidata). */

/** Normalized name used for matching and for university ids. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Institutions with an AISHE code (C-, S-, U-...) are keyed by that code. */
export const collegeId = (aisheCode: string) => stableId(`IN/aishe/${aisheCode}`);
/** Universities known only by name (e.g. an affiliation without a code). */
export const universityId = (name: string) => stableId(`IN/univ/${norm(name)}`);

/**
 * Resolves university ids so the same university always gets ONE row, no
 * matter which source or name variant mentions it. Seeded from the database,
 * then updated as the run assigns ids.
 */
export class UniversityResolver {
  private byCode = new Map<string, string>();
  private byName = new Map<string, { id: string; code: string | null }>();

  static async load(ctx: SyncContext): Promise<UniversityResolver> {
    const r = new UniversityResolver();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await ctx.db
        .schema('edu')
        .from('schools')
        .select('id, name, external_id')
        .eq('country_iso2', 'IN')
        .eq('school_type_code', 'higher_ed_university')
        .order('id')
        .range(from, from + 999);
      if (error) throw new Error(`edu.schools: read failed: ${error.message}`);
      for (const u of data ?? []) r.remember(u.id, u.name, u.external_id);
      if (!data || data.length < 1000) break;
    }
    return r;
  }

  private remember(id: string, name: string, code: string | null) {
    if (code && !this.byCode.has(code)) this.byCode.set(code, id);
    const key = norm(name);
    const prev = this.byName.get(key);
    if (!prev) this.byName.set(key, { id, code });
    else if (prev.id === id && !prev.code && code) prev.code = code;
  }

  /**
   * 1. A row that already has this AISHE code.
   * 2. Otherwise a row with the same name that has no code or the same code
   *    (a same-named row with a DIFFERENT code is a different university).
   * 3. Otherwise a new id: from the code, or from the name if there is no code.
   */
  resolve(code: string | null, name: string): string {
    let id = code ? this.byCode.get(code) : undefined;
    if (!id) {
      const named = this.byName.get(norm(name));
      if (named && (!code || !named.code || named.code === code)) id = named.id;
    }
    id ??= code ? collegeId(code) : universityId(name);
    this.remember(id, name, code);
    return id;
  }

  /** The AISHE code this run/database associates with an id, if any. */
  codeOf(id: string): string | null {
    for (const [code, v] of this.byCode) if (v === id) return code;
    return null;
  }
}
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

/**
 * Guard for the UNIQUE (country_iso2, external_id_scheme, external_id) rule:
 * a code may belong to only one row, in this batch and in the database.
 * Any extra holder keeps its data but loses the duplicate code.
 */
export async function dropDuplicateCodes(ctx: SyncContext, rows: Row[]): Promise<void> {
  const dbOwner = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.db
      .schema('edu')
      .from('schools')
      .select('id, external_id')
      .eq('country_iso2', 'IN')
      .eq('external_id_scheme', 'AISHE')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`edu.schools: read failed: ${error.message}`);
    for (const r of data ?? []) if (r.external_id) dbOwner.set(r.external_id, r.id);
    if (!data || data.length < 1000) break;
  }

  const owner = new Map<string, string>();
  let dropped = 0;
  for (const r of rows) {
    const code = r.external_id as string | null;
    if (!code) continue;
    const id = r.id as string;
    const taken = owner.get(code) ?? dbOwner.get(code);
    if (taken && taken !== id) {
      r.external_id = null;
      r.external_id_scheme = null;
      dropped++;
    } else {
      owner.set(code, id);
    }
  }
  if (dropped) ctx.warn(`${dropped} rows shared an AISHE code with another row; the code was kept on the first one only.`);
}
