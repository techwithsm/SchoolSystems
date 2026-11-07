import { stableId } from '../ids';
import { upsertSources } from '../citations';
import { syncRows } from '../upsert';
import type { Row, SyncContext, SyncSource } from '../types';
import {
  AISHE_FILE_SOURCE_ID,
  cleanEmail,
  cleanPhone,
  cleanUrl,
  cleanYear,
  collegeId,
  loadIndiaStates,
  Tally,
  uniform,
  universityId,
} from './india-common';

/**
 * India colleges, universities and standalone institutions from Wikidata
 * (CC0), limited to items that carry an official AISHE code (property P6392).
 * Rows get the same ids as the AISHE-file source, so both can coexist:
 * records already imported from the official AISHE file are left untouched.
 */
const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'SchoolSystemsDirectory-Sync/1.0 (education directory; Supabase sync)';
const CONCURRENCY = 3; // Wikidata allows a few parallel queries per client

/**
 * SPARQL for items whose AISHE code ends with `suffix` (splits the work into batches).
 * MIN() rather than SAMPLE(): when an item has several values (two websites, two
 * types), every run must pick the same one, or re-syncs would flip-flop.
 */
const query = (suffix: string) => `
SELECT ?code (MIN(?label) AS ?name) (MIN(?iso) AS ?state) (MIN(?distLabel) AS ?district)
       (MIN(?locLabel) AS ?place) (MIN(?inc) AS ?founded) (MIN(?web) AS ?website) (MIN(?coord) AS ?coords)
       (MIN(?affCode) AS ?aff_code) (MIN(?affName) AS ?aff_name) (MIN(?typeLabel) AS ?type)
       (MIN(?ph) AS ?phone) (MIN(?em) AS ?email) (MIN(?addr) AS ?address) (MIN(?pc) AS ?postal)
WHERE {
  ?i wdt:P6392 ?code . FILTER(STRENDS(?code, "${suffix}"))
  OPTIONAL { ?i rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?i wdt:P131 ?loc . ?loc rdfs:label ?locLabel FILTER(LANG(?locLabel) = "en") }
  OPTIONAL { ?i wdt:P131/wdt:P131* ?st . ?st wdt:P300 ?iso . FILTER(STRSTARTS(?iso, "IN-")) }
  OPTIONAL { ?i wdt:P131/wdt:P131* ?d . ?d wdt:P31 wd:Q1149652 . ?d rdfs:label ?distLabel FILTER(LANG(?distLabel) = "en") }
  OPTIONAL { ?i wdt:P571 ?inc }
  OPTIONAL { ?i wdt:P856 ?web }
  OPTIONAL { ?i wdt:P625 ?coord }
  OPTIONAL { ?i wdt:P1416 ?aff . ?aff wdt:P6392 ?affCode . ?aff rdfs:label ?affName FILTER(LANG(?affName) = "en") }
  OPTIONAL { ?i wdt:P31 ?t . ?t rdfs:label ?typeLabel FILTER(LANG(?typeLabel) = "en") }
  OPTIONAL { ?i wdt:P1329 ?ph }
  OPTIONAL { ?i wdt:P968 ?em }
  OPTIONAL { ?i wdt:P6375 ?addr }
  OPTIONAL { ?i wdt:P281 ?pc }
}
GROUP BY ?code`;

type Binding = Record<string, { value: string } | undefined>;
type WdRow = Record<string, string | null>;

async function runQuery(suffix: string): Promise<WdRow[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/sparql-results+json',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ query: query(suffix) }),
    signal: AbortSignal.timeout(75_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const body = (await res.json()) as { results: { bindings: Binding[] } };
  return body.results.bindings.map((b) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v?.value?.trim() || null])),
  );
}

/** One batch per last digit; a batch that fails/times out is split by the last two digits. */
async function fetchAll(ctx: SyncContext): Promise<WdRow[]> {
  const queue = Array.from({ length: 10 }, (_, d) => String(d));
  const out: WdRow[] = [];
  const failed: string[] = [];

  async function worker() {
    for (let s = queue.shift(); s !== undefined; s = queue.shift()) {
      try {
        out.push(...(await runQuery(s)));
      } catch (err) {
        if (s.length === 1) {
          for (let d = 0; d < 10; d++) queue.push(`${d}${s}`);
        } else {
          try {
            out.push(...(await runQuery(s))); // one retry for small batches
          } catch {
            failed.push(s);
            ctx.warn(`Wikidata batch '*${s}' failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failed.length > 5) throw new Error(`Wikidata: ${failed.length} batches failed; try again later.`);
  return out;
}

function parsePoint(p: string | null): { latitude: number; longitude: number } | null {
  const m = p?.match(/^Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
  return { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lon * 1e6) / 1e6 };
}

const stripDistrict = (s: string | null) => s?.replace(/\s+district$/i, '').trim() || null;

export const indiaWikidataSource: SyncSource = {
  key: 'india_wikidata',
  label: 'India: colleges & universities (Wikidata)',
  description:
    'About 24,000 Indian colleges, universities and standalone institutions that have an official AISHE code in Wikidata (CC0): state, district, city, year founded, website, map location, affiliation. Takes 2–4 minutes.',

  async run(ctx) {
    const states = await loadIndiaStates(ctx);
    const sourceId = stableId('IN/src/wikidata_aishe');
    await upsertSources(ctx, [
      {
        id: sourceId,
        title: 'Wikidata: Indian higher education institutions with an AISHE code (P6392)',
        url: 'https://www.wikidata.org/wiki/Property:P6392',
        publisher: 'Wikidata (Wikimedia Foundation)',
        source_type_code: 'other',
        country_iso2: 'IN',
        accessed_on: ctx.today,
        license_code: 'cc0',
        notes: 'Community-maintained; AISHE codes originate from the Ministry of Education AISHE directory.',
      },
    ]);

    const rows = await fetchAll(ctx);

    // Rows already imported from the official AISHE file are left as they are.
    const official = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await ctx.db
        .schema('edu')
        .from('schools')
        .select('id')
        .eq('country_iso2', 'IN')
        .eq('source_id', AISHE_FILE_SOURCE_ID)
        .order('id')
        .range(from, from + 999);
      if (error) throw new Error(`edu.schools: read failed: ${error.message}`);
      for (const r of data ?? []) official.add(r.id);
      if (!data || data.length < 1000) break;
    }

    const universities = new Map<string, Row>(); // key: university id
    const colleges = new Map<string, Row>(); // key: AISHE code
    const universityCodes = new Map<string, string>(); // AISHE U-code -> university id
    const badState = new Tally();
    let noName = 0;
    let dupUniversity = 0;

    const putUniversity = (name: string, code: string | null, fields: Row) => {
      // Same AISHE code under another name: merge into the first row.
      const id = (code && universityCodes.get(code)) || universityId(name);
      const prev = universities.get(id);
      if (prev && code && prev.external_id && prev.external_id !== code) dupUniversity++;
      const merged: Row = { ...(prev ?? {}) };
      for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined && merged[k] == null) merged[k] = v;
      merged.id = id;
      merged.name ??= name;
      if (code && !merged.external_id) {
        merged.external_id = code;
        merged.external_id_scheme = 'AISHE';
        universityCodes.set(code, id);
      }
      universities.set(id, merged);
      return id;
    };

    for (const r of rows) {
      const code = r.code?.toUpperCase().replace(/\s+/g, '') ?? null;
      if (!code || !/^[CUSR]-\d+$/.test(code)) continue;
      if (!r.name) {
        noName++;
        continue;
      }
      const subdivision = states.fromIso(r.state);
      if (r.state && !subdivision) badState.add(r.state);
      const district = stripDistrict(r.district);
      const place = stripDistrict(r.place);
      const point = parsePoint(r.coords);

      const base: Row = {
        country_iso2: 'IN',
        subdivision_code: subdivision,
        district,
        city: place && place !== district ? place : null,
        name: r.name,
        year_established: cleanYear(r.founded),
        website: cleanUrl(r.website),
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        phone: cleanPhone(r.phone),
        email: cleanEmail(r.email),
        address_line: r.address,
        postal_code: r.postal,
        source_id: sourceId,
      };

      if (code.startsWith('U-')) {
        putUniversity(r.name, code, { ...base, school_type_code: 'higher_ed_university', local_type: r.type });
        continue;
      }
      const row: Row = {
        ...base,
        id: collegeId(code),
        school_type_code: 'higher_ed_college',
        local_type: r.type ?? (code.startsWith('S-') ? 'Standalone Institution' : null),
        external_id: code,
        external_id_scheme: 'AISHE',
      };
      if (r.aff_code?.toUpperCase().startsWith('U-') && r.aff_name) {
        row.affiliated_to_id = putUniversity(r.aff_name, r.aff_code.toUpperCase(), {});
      }
      colleges.set(code, row);
    }

    // Universities known only as an affiliation still need the required columns.
    for (const u of universities.values()) {
      u.country_iso2 = 'IN';
      u.school_type_code = 'higher_ed_university';
      u.source_id ??= sourceId;
    }

    const keep = (r: Row) => !official.has(r.id as string);
    const uniRows = uniform([...universities.values()].filter(keep));
    const collegeRows = uniform([...colleges.values()].filter(keep));

    await syncRows(ctx, {
      schema: 'edu',
      table: 'schools',
      keyColumns: ['id'],
      tracksVerification: true,
      scope: { country_iso2: 'IN', school_type_code: 'higher_ed_university' },
      rows: uniRows,
    });
    await syncRows(ctx, {
      schema: 'edu',
      table: 'schools',
      keyColumns: ['id'],
      tracksVerification: true,
      scope: { country_iso2: 'IN', school_type_code: 'higher_ed_college' },
      rows: collegeRows,
    });

    ctx.warn(
      `Wikidata returned ${rows.length} records: ${colleges.size} colleges/standalone, ${universities.size} universities` +
        (official.size ? ` (${official.size} already from the official AISHE file were skipped)` : '') +
        '.',
    );
    if (noName) ctx.warn(`${noName} records had no English name and were skipped.`);
    if (dupUniversity) ctx.warn(`${dupUniversity} universities appear under more than one AISHE code in Wikidata (first kept).`);
    badState.report(ctx, 'State code');
  },
};
