import { chunk } from './http';
import { upsertCitations, upsertSources, type SourceInput } from './citations';
import { sameValue } from './upsert';
import type { Row, SyncContext } from './types';

/**
 * Columns of edu.country_profiles that automated sources (APIs, CSV files) may
 * fill. Each maps to its companion "year" column when the table has one.
 */
export const PROFILE_FACT_FIELDS = {
  compulsory_start_age: null,
  compulsory_end_age: null,
  compulsory_years: null,
  academic_year_start_month: null,
  academic_year_end_month: null,
  private_enrollment_pct: 'private_enrollment_year',
  public_spending_pct_gdp: 'public_spending_year',
  literacy_rate_pct: 'literacy_rate_year',
} as const;

export type ProfileFactField = keyof typeof PROFILE_FACT_FIELDS;

export function isProfileFactField(f: string): f is ProfileFactField {
  return Object.prototype.hasOwnProperty.call(PROFILE_FACT_FIELDS, f);
}

export interface ProfileFact {
  countryIso2: string;
  field: ProfileFactField;
  value: number;
  /** Reference year of the value (stored in the year column, or the citation note). */
  year: number | null;
  /** core.sources id that backs this value. */
  sourceId: string;
  /** Short readable source key used to build the citation id. */
  sourceKey: string;
  note?: string;
}

/**
 * Writes statistic-style facts into edu.country_profiles with these rules:
 *  - NULL current value             -> set it.
 *  - same value (and year)          -> leave it, refresh the citation.
 *  - different value:
 *      * only this source cites it  -> update (newer data from the same source),
 *                                      unless the incoming year is older.
 *      * otherwise (another source,
 *        or no citation at all)     -> do NOT overwrite; report a conflict.
 *  - changed profiles go back to 'needs_verification'.
 *  - missing profile rows are created.
 */
export async function applyProfileFacts(
  ctx: SyncContext,
  sources: SourceInput[],
  facts: ProfileFact[],
): Promise<void> {
  if (facts.length === 0) return;
  await upsertSources(ctx, sources);

  const countries = Array.from(new Set(facts.map((f) => f.countryIso2)));
  const fields = Array.from(new Set(facts.map((f) => f.field)));
  const yearCols = fields.map((f) => PROFILE_FACT_FIELDS[f]).filter((c): c is NonNullable<typeof c> => !!c);

  // Current profile values.
  const profiles = new Map<string, Row>();
  for (const part of chunk(countries, 100)) {
    const { data, error } = await ctx.db
      .schema('edu')
      .from('country_profiles')
      .select(['country_iso2', ...fields, ...yearCols].join(','))
      .in('country_iso2', part);
    if (error) throw new Error(`edu.country_profiles: read failed: ${error.message}`);
    for (const r of (data ?? []) as unknown as Row[]) profiles.set(String(r.country_iso2), r);
  }

  // Which sources currently back each (country, field).
  const citedBy = new Map<string, Set<string>>();
  for (const part of chunk(countries, 100)) {
    const { data, error } = await ctx.db
      .schema('core')
      .from('record_sources')
      .select('entity_id, field_name, source_id')
      .eq('entity_table', 'edu.country_profiles')
      .in('entity_id', part)
      .in('field_name', fields);
    if (error) throw new Error(`core.record_sources: read failed: ${error.message}`);
    for (const r of data ?? []) {
      const k = `${r.entity_id}|${r.field_name}`;
      if (!citedBy.has(k)) citedBy.set(k, new Set());
      citedBy.get(k)!.add(r.source_id);
    }
  }

  const patches = new Map<string, Row>();
  const citations: Parameters<typeof upsertCitations>[1] = [];

  for (const f of facts) {
    const current = profiles.get(f.countryIso2);
    const yearCol = PROFILE_FACT_FIELDS[f.field];
    const curValue = current?.[f.field] ?? null;
    const curYear = yearCol ? (current?.[yearCol] ?? null) : null;
    const backers = citedBy.get(`${f.countryIso2}|${f.field}`) ?? new Set<string>();

    const cite = () =>
      citations.push({
        key: `edu.country_profiles|${f.countryIso2}|${f.field}|${f.sourceKey}`,
        entity_table: 'edu.country_profiles',
        entity_id: f.countryIso2,
        field_name: f.field,
        source_id: f.sourceId,
        note: f.note ?? (f.year ? `Value for ${f.year}` : null),
      });

    const sameNow = sameValue(curValue, f.value) && (!yearCol || sameValue(curYear, f.year));
    if (sameNow) {
      cite();
      continue;
    }

    if (curValue !== null) {
      // An existing value with no citation, or backed by another source, is
      // treated as curated and never overwritten automatically.
      const onlyThisSource = backers.size === 1 && backers.has(f.sourceId);
      if (!onlyThisSource) {
        // Same value from a different source just adds a second citation.
        if (sameValue(curValue, f.value)) {
          cite();
          continue;
        }
        ctx.conflict({
          table: 'edu.country_profiles',
          entity: f.countryIso2,
          field: f.field,
          current: yearCol ? `${curValue} (${curYear ?? '?'})` : curValue,
          incoming: f.year ? `${f.value} (${f.year})` : f.value,
          note: 'Kept the existing value because another source backs it. Review manually.',
        });
        continue;
      }
      if (yearCol && curYear !== null && f.year !== null && Number(curYear) > f.year) continue;
    }

    const patch = patches.get(f.countryIso2) ?? {};
    patch[f.field] = f.value;
    if (yearCol) patch[yearCol] = f.year;
    patches.set(f.countryIso2, patch);
    cite();
  }

  // Write changed / new profiles.
  for (const [iso2, patch] of patches) {
    const verification = { verification_status: 'needs_verification', last_verified: null };
    if (ctx.dryRun) {
      ctx.count('edu.country_profiles', profiles.has(iso2) ? 'updated' : 'inserted');
      continue;
    }
    if (profiles.has(iso2)) {
      const { error } = await ctx.db
        .schema('edu')
        .from('country_profiles')
        .update({ ...patch, ...verification })
        .eq('country_iso2', iso2);
      if (error) throw new Error(`edu.country_profiles: update ${iso2} failed: ${error.message}`);
      ctx.count('edu.country_profiles', 'updated');
    } else {
      const { error } = await ctx.db
        .schema('edu')
        .from('country_profiles')
        .insert({ country_iso2: iso2, ...patch, verification_status: 'needs_verification' });
      if (error) throw new Error(`edu.country_profiles: insert ${iso2} failed: ${error.message}`);
      ctx.count('edu.country_profiles', 'inserted');
    }
  }
  const untouched = countries.filter((c) => !patches.has(c)).length;
  if (untouched) ctx.count('edu.country_profiles', 'unchanged', untouched);

  await upsertCitations(ctx, citations);
}

/** All countries in core.countries as { iso2, iso3 }. */
export async function listCountries(ctx: SyncContext): Promise<{ iso2: string; iso3: string }[]> {
  const { data, error } = await ctx.db.schema('core').from('countries').select('iso2, iso3').order('iso2');
  if (error) throw new Error(`core.countries: read failed: ${error.message}`);
  return (data ?? []).map((r) => ({ iso2: String(r.iso2).trim(), iso3: String(r.iso3).trim() }));
}
