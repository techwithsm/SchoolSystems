import 'server-only';
import { cache } from 'react';
import { cacheLife, cacheTag } from 'next/cache';

/** Cache tag for directory filter data; cleared after an admin sync. */
export const DIRECTORY_CACHE_TAG = 'directory';
import { createPublicClient } from '@/lib/supabase/public';
import { titleCase } from '@/lib/text';

/** Every label shown to visitors is Title Case, whatever the source wrote. */
function withTitleCaseLabels<T extends { school_type_label?: string | null; management_label?: string | null; local_type?: string | null }>(row: T): T {
  return {
    ...row,
    ...('school_type_label' in row ? { school_type_label: titleCase(row.school_type_label) } : {}),
    ...('management_label' in row ? { management_label: titleCase(row.management_label) } : {}),
    ...('local_type' in row ? { local_type: titleCase(row.local_type) } : {}),
  };
}

// -----------------------------------------------------------------------------
// Filters (from the URL, so searches are shareable and work without JavaScript)
// -----------------------------------------------------------------------------

export const PAGE_SIZE = 20;
const MAX_PAGE = 500;

export interface Filters {
  q: string; // name contains (every word must match)
  country: string; // ISO 3166-1 alpha-2
  state: string; // ISO 3166-2
  place: string; // city or district contains
  type: string; // edu.school_types code
  management: string; // edu.management_types code
  page: number;
  sel: string; // id of the institution shown in the detail panel ('' = none)
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Free text: trimmed, max 100 chars, without characters that have meaning in filters. */
function cleanText(v: string): string {
  return v
    .replace(/[%_*,()"\\:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/** Untrusted URL params -> safe, validated filters. Invalid values are dropped. */
export function parseFilters(params: RawParams): Filters {
  const country = first(params.country).toUpperCase();
  const state = first(params.state).toUpperCase();
  const type = first(params.type);
  const management = first(params.management);
  const page = Number.parseInt(first(params.page), 10);

  return {
    q: cleanText(first(params.q)),
    country: /^[A-Z]{2}$/.test(country) ? country : '',
    state: /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(state) && (!country || state.startsWith(`${country}-`)) ? state : '',
    place: cleanText(first(params.place)),
    type: /^[a-z_]{1,40}$/.test(type) ? type : '',
    management: /^[a-z_]{1,40}$/.test(management) ? management : '',
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
    sel: isUuid(first(params.sel)) ? first(params.sel).toLowerCase() : '',
  };
}

export function hasAnyFilter(f: Filters): boolean {
  return !!(f.q || f.country || f.state || f.place || f.type || f.management);
}

/** URL for these filters, with overrides (e.g. another page). Empty values are omitted. */
export function filtersToHref(f: Filters, overrides: Partial<Filters> = {}): string {
  const merged = { ...f, ...overrides };
  const sp = new URLSearchParams();
  for (const key of ['q', 'country', 'state', 'place', 'type', 'management'] as const) {
    if (merged[key]) sp.set(key, merged[key]);
  }
  if (merged.page > 1) sp.set('page', String(merged.page));
  if (merged.sel) sp.set('sel', merged.sel);
  const qs = sp.toString();
  return qs ? `/?${qs}` : '/';
}

// -----------------------------------------------------------------------------
// Filter options (cached: they change only when data is synced)
// -----------------------------------------------------------------------------

export interface FacetRow {
  country_iso2: string;
  country_name: string;
  subdivision_code: string | null;
  subdivision_name: string | null;
  school_type_code: string;
  school_type_label: string;
  school_type_sort: number;
  institutions: number;
}

export interface Option {
  value: string;
  label: string;
  count?: number;
}

export async function getFacets(): Promise<FacetRow[]> {
  'use cache';
  cacheLife('hours');
  cacheTag(DIRECTORY_CACHE_TAG);
  const db = createPublicClient();
  const rows: FacetRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .schema('edu')
      .from('v_institution_facets')
      .select('*')
      .range(from, from + 999);
    if (error) throw new Error(`Could not load filters: ${error.message}`);
    rows.push(...((data ?? []) as FacetRow[]).map((r) => ({ ...r, school_type_label: titleCase(r.school_type_label) ?? r.school_type_label })));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function getManagementOptions(): Promise<Option[]> {
  'use cache';
  cacheLife('days');
  const { data, error } = await createPublicClient()
    .schema('edu')
    .from('management_types')
    .select('code, label')
    .order('sort_order');
  if (error) throw new Error(`Could not load management types: ${error.message}`);
  return (data ?? []).map((m) => ({ value: m.code, label: titleCase(m.label) ?? m.label }));
}

function sumBy(rows: FacetRow[], key: (r: FacetRow) => string | null, label: (r: FacetRow) => string): Option[] {
  const map = new Map<string, Option>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const o = map.get(k) ?? { value: k, label: label(r), count: 0 };
    o.count! += r.institutions;
    map.set(k, o);
  }
  return [...map.values()];
}

/** Options for each dropdown, narrowed by the other selections. */
export function buildOptions(facets: FacetRow[], f: Filters) {
  const inCountry = f.country ? facets.filter((r) => r.country_iso2 === f.country) : facets;
  const inState = f.state ? inCountry.filter((r) => r.subdivision_code === f.state) : inCountry;

  const countries = sumBy(facets, (r) => r.country_iso2, (r) => r.country_name).sort((a, b) => a.label.localeCompare(b.label));
  const states = f.country
    ? sumBy(inCountry, (r) => r.subdivision_code, (r) => r.subdivision_name ?? r.subdivision_code ?? '').sort((a, b) =>
        a.label.localeCompare(b.label),
      )
    : [];
  const typeSort = new Map(facets.map((r) => [r.school_type_code, r.school_type_sort]));
  const types = sumBy(inState, (r) => r.school_type_code, (r) => r.school_type_label).sort(
    (a, b) => (typeSort.get(a.value) ?? 0) - (typeSort.get(b.value) ?? 0),
  );
  const total = facets.reduce((n, r) => n + r.institutions, 0);
  return { countries, states, types, total };
}

// -----------------------------------------------------------------------------
// Search results
// -----------------------------------------------------------------------------

export interface InstitutionRow {
  id: string;
  name: string;
  local_name: string | null;
  school_type_code: string;
  school_type_label: string;
  local_type: string | null;
  management_label: string | null;
  country_iso2: string;
  country_name: string;
  subdivision_name: string | null;
  district: string | null;
  city: string | null;
  address_line: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  year_established: number | null;
  locality_type_code: string | null;
  affiliated_to_id: string | null;
  affiliated_to_name: string | null;
}

const LIST_COLUMNS =
  'id, name, local_name, school_type_code, school_type_label, local_type, management_label, country_iso2, country_name, subdivision_name, district, city, address_line, postal_code, phone, email, website, year_established, locality_type_code, affiliated_to_id, affiliated_to_name';

export async function searchInstitutions(f: Filters): Promise<{ rows: InstitutionRow[]; total: number }> {
  let query = createPublicClient().schema('edu').from('v_institutions').select(LIST_COLUMNS, { count: 'exact' });

  for (const word of f.q.split(' ').filter(Boolean)) query = query.ilike('name', `%${word}%`);
  if (f.country) query = query.eq('country_iso2', f.country);
  if (f.state) query = query.eq('subdivision_code', f.state);
  if (f.type) query = query.eq('school_type_code', f.type);
  if (f.management) query = query.eq('management_type_code', f.management);
  if (f.place) query = query.or(`city.ilike.*${f.place}*,district.ilike.*${f.place}*`);

  const from = (f.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order('name')
    .order('id')
    .range(from, from + PAGE_SIZE - 1);

  // Asking for a page past the end returns an error from PostgREST; treat as empty.
  if (error && error.code !== 'PGRST103') throw new Error(`Search failed: ${error.message}`);
  return { rows: ((data ?? []) as unknown as InstitutionRow[]).map(withTitleCaseLabels), total: count ?? 0 };
}

// -----------------------------------------------------------------------------
// Detail page
// -----------------------------------------------------------------------------

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export interface InstitutionDetail extends InstitutionRow {
  latitude: number | null;
  longitude: number | null;
  enrollment: number | null;
  enrollment_year: number | null;
  external_id: string | null;
  external_id_scheme: string | null;
  status_code: string | null;
  verification_status: string;
  last_verified: string | null;
  source: { title: string; url: string | null; publisher: string | null; accessed_on: string } | null;
  affiliatedColleges: { id: string; name: string; district: string | null }[];
  affiliatedCount: number;
}

/** Cached per request: the panel and the mobile inline view share one fetch. */
export const getInstitution = cache(async (id: string): Promise<InstitutionDetail | null> => {
  if (!isUuid(id)) return null;
  const db = createPublicClient();

  const { data, error } = await db
    .schema('edu')
    .from('v_institutions')
    .select(
      `${LIST_COLUMNS}, latitude, longitude, enrollment, enrollment_year, external_id, external_id_scheme, status_code, verification_status, last_verified, source_id`,
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not load institution: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as InstitutionRow & Record<string, unknown>;

  const [sourceRes, collegesRes] = await Promise.all([
    row.source_id
      ? db.schema('core').from('sources').select('title, url, publisher, accessed_on').eq('id', row.source_id as string).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .schema('edu')
      .from('v_institutions')
      .select('id, name, district', { count: 'exact' })
      .eq('affiliated_to_id', id)
      .order('name')
      .limit(50),
  ]);

  return {
    ...withTitleCaseLabels(row as unknown as InstitutionDetail),
    source: (sourceRes.data as InstitutionDetail['source']) ?? null,
    affiliatedColleges: (collegesRes.data ?? []) as InstitutionDetail['affiliatedColleges'],
    affiliatedCount: collegesRes.count ?? 0,
  };
});
