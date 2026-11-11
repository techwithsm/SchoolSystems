import { chunk } from '../http';
import { pickWebsite } from '../cleanse';
import { stableId } from '../ids';
import { upsertSources } from '../citations';
import type { Row, SyncContext, SyncSource } from '../types';
import { STATES as MX_STATES } from './mx-sep';
import {
  cleanCoord,
  cleanEmail,
  cleanPhone,
  cleanYear,
  ensureSubdivisions,
  mapLimit,
  Tally,
  writeInstitutions,
} from './common';

/**
 * Generic "colleges and universities of one country" source from Wikidata
 * (CC0), for countries without a downloadable official directory.
 *
 * Two light steps so a busy Wikidata query service does not time out:
 *   1. list the items per institution type (direct "instance of", one query each)
 *   2. fetch details in batches of 150 items (VALUES), with retries.
 * Rows are keyed by Wikidata item id (external_id_scheme 'WIKIDATA').
 */
export interface WikidataCountryConfig {
  key: string;
  label: string;
  description: string;
  iso2: string;
  countryQid: string;
  /** Label languages, most preferred first (e.g. ['en', 'fr']). */
  languages: string[];
  universityClasses: string[];
  collegeClasses: string[];
  /** ISO 3166-2 code -> [name, type]; ensured in core.subdivisions. */
  subdivisions: Record<string, [name: string, type: string]>;
  /** Items of a college class whose name matches this are counted as universities. */
  universityNamePattern?: RegExp;
  /** Skip items that have this property (e.g. 'P6392' AISHE code: covered by another source). */
  excludeProperty?: string;
  /** Old ISO 3166-2 codes still used in Wikidata -> current code (e.g. IN-OR -> IN-OD). */
  isoAliases?: Record<string, string>;
  /**
   * Skip an item when the country already has an institution with the same
   * normalized name in the same state/province (avoids duplicates of rows
   * that came from another source under a different id).
   */
  skipExistingNames?: boolean;
  /** Distinguishes several Wikidata sources for one country (ids and citation). */
  variant?: string;
  /**
   * For countries not in the seed: created in core.countries (inactive) and,
   * if needed, its UN M49 region in core.regions. Existing rows are left as they are.
   */
  country?: {
    iso3: string;
    isoNumeric: string;
    name: string;
    continentCode: string;
    region: { m49: string; name: string };
  };
}

/** Inserts the country (and its region) if missing; never changes an existing row. */
async function ensureCountry(ctx: SyncContext, cfg: WikidataCountryConfig): Promise<void> {
  const c = cfg.country;
  if (!c) return;
  const { data, error } = await ctx.db.schema('core').from('countries').select('iso2').eq('iso2', cfg.iso2).maybeSingle();
  if (error) throw new Error(`core.countries: read failed: ${error.message}`);
  if (data) return;
  if (ctx.dryRun) {
    ctx.count('core.countries', 'inserted');
    return;
  }
  const region = await ctx.db
    .schema('core')
    .from('regions')
    .upsert({ m49_code: c.region.m49, name: c.region.name, continent_code: c.continentCode }, { onConflict: 'm49_code', ignoreDuplicates: true });
  if (region.error) throw new Error(`core.regions: insert failed: ${region.error.message}`);
  const country = await ctx.db.schema('core').from('countries').insert({
    iso2: cfg.iso2,
    iso3: c.iso3,
    iso_numeric: c.isoNumeric,
    name: c.name,
    continent_code: c.continentCode,
    region_m49_code: c.region.m49,
    is_active: false,
  });
  if (country.error) throw new Error(`core.countries: insert failed: ${country.error.message}`);
  ctx.count('core.countries', 'inserted');
}


/** Category label shown for each Wikidata class we match (Title Case). */
const CLASS_LABELS: Record<string, string> = {
  Q3918: 'University',
  Q875538: 'Public University',
  Q902104: 'Private University',
  Q15936437: 'Research University',
  Q23002054: 'Private Not-for-Profit University',
  Q3520135: 'Deemed University',
  Q47531586: 'Institute of National Importance',
  Q189004: 'College',
  Q1663017: 'Engineering College',
  Q494230: 'Medical College',
  Q845392: 'Polytechnic',
  Q2120173: 'College of Education',
  Q1371037: 'Institute of Technology',
  Q38723: 'Higher Education Institution',
  Q162633: 'Academy',
  Q1336920: 'Community College',
  Q1110056: 'CEGEP',
  Q108415947: 'College of Applied Arts and Technology',
};

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'SchoolSystemsDirectory-Sync/1.0 (education directory; Supabase sync)';
const BATCH = 150;

type Binding = Record<string, { value: string } | undefined>;

/** POST a SPARQL query; retries timeouts/5xx/429 with backoff (busy service). */
async function sparql(query: string, attempts = 4): Promise<Record<string, string | null>[]> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/sparql-results+json',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(75_000),
        cache: 'no-store',
      });
      if (res.ok) {
        const body = (await res.json()) as { results: { bindings: Binding[] } };
        return body.results.bindings.map((b) =>
          Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v?.value?.trim() || null])),
        );
      }
      last = new Error(`Wikidata HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 3000 * 2 ** i));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const qid = (uri: string | null) => uri?.replace(/^.*\/entity\//, '') ?? null;

function detailsQuery(ids: string[], cfg: WikidataCountryConfig): string {
  const prefix = `${cfg.iso2}-`;
  // One label variable per language; the first language that has a label wins.
  const labelVars = cfg.languages.map((_, n) => `(MIN(?l${n}) AS ?name${n})`).join(' ');
  const labelOptionals = cfg.languages
    .map((l, n) => `OPTIONAL { ?i rdfs:label ?l${n} FILTER(LANG(?l${n}) = "${l}") }`)
    .join('\n  ');
  return `
SELECT ?i ${labelVars} (MIN(?iso) AS ?state) (MIN(?locLabel) AS ?place)
       (MIN(?inc) AS ?founded) (GROUP_CONCAT(DISTINCT ?web; separator=" ") AS ?website) (MIN(?coord) AS ?coords)
       (MIN(?ph) AS ?phone) (MIN(?em) AS ?email) (MIN(?addr) AS ?address) (MIN(?pc) AS ?postal)
WHERE {
  VALUES ?i { ${ids.map((q) => `wd:${q}`).join(' ')} }
  ${labelOptionals}
  OPTIONAL { ?i wdt:P131 ?loc . ?loc rdfs:label ?locLabel FILTER(LANG(?locLabel) = "${cfg.languages[0]}") }
  OPTIONAL { ?i wdt:P131/wdt:P131* ?st . ?st wdt:P300 ?iso . FILTER(STRSTARTS(?iso, "${prefix}")) }
  OPTIONAL { ?i wdt:P571 ?inc }
  OPTIONAL { ?i p:P856 ?webSt . ?webSt ps:P856 ?web . FILTER NOT EXISTS { ?webSt pq:P582 [] } FILTER EXISTS { ?i wdt:P856 ?web } }
  OPTIONAL { ?i wdt:P625 ?coord }
  OPTIONAL { ?i wdt:P1329 ?ph }
  OPTIONAL { ?i wdt:P968 ?em }
  OPTIONAL { ?i wdt:P6375 ?addr }
  OPTIONAL { ?i wdt:P281 ?pc }
}
GROUP BY ?i`;
}

function parsePoint(p: string | null) {
  const m = p?.match(/^Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/);
  return m ? { lat: cleanCoord(m[2], -90, 90), lon: cleanCoord(m[1], -180, 180) } : { lat: null, lon: null };
}

export function createWikidataHigherEdSource(cfg: WikidataCountryConfig): SyncSource {
  return {
    key: cfg.key,
    label: cfg.label,
    description: cfg.description,

    async run(ctx: SyncContext) {
      await ensureCountry(ctx, cfg);
      await ensureSubdivisions(ctx, cfg.iso2, cfg.subdivisions);

      // 1. Which items are universities / colleges (universities win).
      const kind = new Map<string, 'higher_ed_university' | 'higher_ed_college'>();
      const exclude = cfg.excludeProperty ? `FILTER NOT EXISTS { ?i wdt:${cfg.excludeProperty} [] }` : '';
      // Skip sub-units: faculties/schools that are "part of" (P361) or have a
      // "parent organization" (P749) that is itself a university or college,
      // e.g. "Cockrell School of Engineering" (part of UT Austin).
      const parentClasses = [...new Set([...cfg.universityClasses, ...cfg.collegeClasses])].map((c) => `wd:${c}`).join(' ');
      const noSubunits = `FILTER NOT EXISTS { ?i wdt:P361|wdt:P749 ?parent . ?parent wdt:P31 ?pc . VALUES ?pc { ${parentClasses} } }`;
      const listFor = (cls: string) =>
        sparql(
          `SELECT DISTINCT ?i WHERE { ?i wdt:P31 wd:${cls} ; wdt:P17 wd:${cfg.countryQid} . FILTER NOT EXISTS { ?i wdt:P576 [] } ${exclude} ${noSubunits} }`,
        );
      // The class each item matched gives its category label (later sets win:
      // university classes override college classes).
      const category = new Map<string, string>();
      for (const [classes, type] of [
        [cfg.collegeClasses, 'higher_ed_college'],
        [cfg.universityClasses, 'higher_ed_university'],
      ] as const) {
        const lists = await mapLimit(classes, 2, listFor);
        lists.forEach((rows, n) => {
          for (const r of rows) {
            const id = qid(r.i);
            if (!id) continue;
            kind.set(id, type);
            category.set(id, CLASS_LABELS[classes[n]] ?? (type === 'higher_ed_university' ? 'University' : 'College'));
          }
        });
      }
      if (kind.size === 0) throw new Error('Wikidata returned no institutions (service busy?). Try again later.');

      // 2. Details in batches.
      const batches = chunk([...kind.keys()], BATCH);
      let failedBatches = 0;
      const detailRows = (
        await mapLimit(batches, 2, async (ids) => {
          try {
            return await sparql(detailsQuery(ids, cfg));
          } catch (err) {
            failedBatches++;
            ctx.warn(`Wikidata details batch failed: ${err instanceof Error ? err.message : String(err)}`);
            return [];
          }
        })
      ).flat();
      if (failedBatches > batches.length / 4) throw new Error(`Wikidata: ${failedBatches} of ${batches.length} batches failed; try again later.`);

      const variant = cfg.variant ? `_${cfg.variant}` : '';
      const sourceId = stableId(`${cfg.iso2}/src/wikidata_higher_ed${variant}`);
      await upsertSources(ctx, [
        {
          id: sourceId,
          title: `Wikidata: higher education institutions in ${cfg.label.split(':')[0]}`,
          // Unique per source: core.sources allows one row per (url, accessed_on).
          url: `https://www.wikidata.org/wiki/${cfg.countryQid}${cfg.variant ? `#${cfg.variant}` : ''}`,
          publisher: 'Wikidata (Wikimedia Foundation)',
          source_type_code: 'other',
          country_iso2: cfg.iso2,
          accessed_on: ctx.today,
          license_code: 'cc0',
          notes: `Community-maintained. Items that are instances of ${[...cfg.universityClasses, ...cfg.collegeClasses].join(', ')} in ${cfg.countryQid}, not dissolved.`,
        },
      ]);

      // Names already in the database for this country (other sources), per state.
      const existingNames = new Set<string>(); // name|state
      const existingAnyState = new Set<string>(); // name (used when Wikidata has no state)
      // Case-, accent- and punctuation-insensitive: 'AUTONOMA' matches 'Autónoma'.
      const normName = (s: string) =>
        s
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .toLowerCase()
          .replace(/&/g, ' and ')
          .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
          .trim();
      if (cfg.skipExistingNames) {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await ctx.db
            .schema('edu')
            .from('schools')
            .select('name, subdivision_code, source_id')
            .eq('country_iso2', cfg.iso2)
            .order('id')
            .range(from, from + 999);
          if (error) throw new Error(`edu.schools: read failed: ${error.message}`);
          for (const s of data ?? []) {
            if (s.source_id !== sourceId) {
              existingNames.add(`${normName(s.name)}|${s.subdivision_code ?? ''}`);
              existingAnyState.add(normName(s.name));
            }
          }
          if (!data || data.length < 1000) break;
        }
      }

      const badState = new Tally();
      let noName = 0;
      let duplicates = 0;
      const rows: Row[] = [];
      for (const r of detailRows) {
        const id = qid(r.i);
        if (!id) continue;
        const name = cfg.languages.map((_, n) => r[`name${n}`]).find(Boolean) ?? null;
        if (!name) {
          noName++;
          continue;
        }
        const iso = r.state ? (cfg.isoAliases?.[r.state] ?? r.state) : null;
        const state = iso && cfg.subdivisions[iso] ? iso : null;
        if (r.state && !state) badState.add(r.state);
        const isDuplicate = state
          ? existingNames.has(`${normName(name)}|${state}`)
          : existingAnyState.has(normName(name));
        if (cfg.skipExistingNames && isDuplicate) {
          duplicates++;
          continue;
        }
        const stateName = state ? cfg.subdivisions[state][0] : null;
        const { lat, lon } = parsePoint(r.coords);
        // A college-class item whose name says it is a university is counted as one.
        const promoted = kind.get(id) === 'higher_ed_college' && !!cfg.universityNamePattern?.test(name);
        rows.push({
          id: stableId(`${cfg.iso2}/wikidata/${id}`), // same item -> same row, whichever variant
          country_iso2: cfg.iso2,
          subdivision_code: state,
          city: r.place && r.place !== stateName ? r.place : null,
          name,
          school_type_code: promoted ? 'higher_ed_university' : kind.get(id),
          local_type: promoted ? 'University' : (category.get(id) ?? null),
          year_established: cleanYear(r.founded),
          website: pickWebsite(r.website),
          latitude: lat,
          longitude: lon,
          phone: cleanPhone(r.phone),
          email: cleanEmail(r.email),
          address_line: r.address,
          postal_code: r.postal,
          external_id: id,
          external_id_scheme: 'WIKIDATA',
          source_id: sourceId,
        });
      }

      await writeInstitutions(ctx, cfg.iso2, rows);

      const unis = rows.filter((r) => r.school_type_code === 'higher_ed_university').length;
      ctx.warn(`Wikidata: ${unis} universities and ${rows.length - unis} colleges.`);
      if (noName) ctx.warn(`${noName} items had no name in ${cfg.languages.join('/')} and were skipped.`);
      if (duplicates) ctx.warn(`${duplicates} items skipped: same name already listed in the same state from another source.`);
      badState.report(ctx, 'Province/state code');
    },
  };
}

// -----------------------------------------------------------------------------
// Institution types used for every country (Wikidata classes, direct P31).
// -----------------------------------------------------------------------------

/** university, public/private university, research university, private non-profit. */
const UNIVERSITY_CLASSES = ['Q3918', 'Q875538', 'Q902104', 'Q15936437', 'Q23002054'];
/** college, engineering school, medical school, polytechnic, school of education,
 *  university of technology, higher education institution, academy. */
const COLLEGE_CLASSES = ['Q189004', 'Q1663017', 'Q494230', 'Q845392', 'Q2120173', 'Q1371037', 'Q38723', 'Q162633'];

// -----------------------------------------------------------------------------
// India: institutions WITHOUT an AISHE code (the AISHE-coded ones come from the
// 'India: colleges & universities (Wikidata)' source). Fills gaps such as TKIET.
// -----------------------------------------------------------------------------

export const indiaWikidataExtraSource = createWikidataHigherEdSource({
  key: 'in_wikidata_extra',
  label: 'India: more colleges & universities (Wikidata, no AISHE code)',
  description:
    'Indian universities, engineering and medical colleges, polytechnics and institutes that are in Wikidata but have no AISHE code yet (~1,500). Skips names already listed in the same state. Takes about a minute.',
  iso2: 'IN',
  countryQid: 'Q668',
  languages: ['en'],
  variant: 'no_aishe',
  // Vishwavidyalaya/Vidyapeeth = university (but Mahavidyalaya = college).
  universityNamePattern: /university|vishwa ?vidyalaya|vishva ?vidyalaya|vidyapee?th|vidyapith/i,
  excludeProperty: 'P6392',
  skipExistingNames: true,
  universityClasses: [...UNIVERSITY_CLASSES, 'Q3520135', 'Q47531586'], // + deemed university, Institute of National Importance
  collegeClasses: COLLEGE_CLASSES,
  isoAliases: { 'IN-OR': 'IN-OD', 'IN-CT': 'IN-CG', 'IN-TG': 'IN-TS', 'IN-UT': 'IN-UK' },
  subdivisions: {
    'IN-AP': ['Andhra Pradesh', 'state'], 'IN-AR': ['Arunachal Pradesh', 'state'], 'IN-AS': ['Assam', 'state'],
    'IN-BR': ['Bihar', 'state'], 'IN-CG': ['Chhattisgarh', 'state'], 'IN-GA': ['Goa', 'state'],
    'IN-GJ': ['Gujarat', 'state'], 'IN-HR': ['Haryana', 'state'], 'IN-HP': ['Himachal Pradesh', 'state'],
    'IN-JH': ['Jharkhand', 'state'], 'IN-KA': ['Karnataka', 'state'], 'IN-KL': ['Kerala', 'state'],
    'IN-MP': ['Madhya Pradesh', 'state'], 'IN-MH': ['Maharashtra', 'state'], 'IN-MN': ['Manipur', 'state'],
    'IN-ML': ['Meghalaya', 'state'], 'IN-MZ': ['Mizoram', 'state'], 'IN-NL': ['Nagaland', 'state'],
    'IN-OD': ['Odisha', 'state'], 'IN-PB': ['Punjab', 'state'], 'IN-RJ': ['Rajasthan', 'state'],
    'IN-SK': ['Sikkim', 'state'], 'IN-TN': ['Tamil Nadu', 'state'], 'IN-TS': ['Telangana', 'state'],
    'IN-TR': ['Tripura', 'state'], 'IN-UP': ['Uttar Pradesh', 'state'], 'IN-UK': ['Uttarakhand', 'state'],
    'IN-WB': ['West Bengal', 'state'],
    'IN-AN': ['Andaman and Nicobar Islands', 'union_territory'], 'IN-CH': ['Chandigarh', 'union_territory'],
    'IN-DH': ['Dadra and Nagar Haveli and Daman and Diu', 'union_territory'], 'IN-DL': ['Delhi', 'union_territory'],
    'IN-JK': ['Jammu and Kashmir', 'union_territory'], 'IN-LA': ['Ladakh', 'union_territory'],
    'IN-LD': ['Lakshadweep', 'union_territory'], 'IN-PY': ['Puducherry', 'union_territory'],
  },
});

// -----------------------------------------------------------------------------
// Nigeria
// -----------------------------------------------------------------------------

export const nigeriaWikidataSource = createWikidataHigherEdSource({
  key: 'ng_wikidata',
  label: 'Nigeria: colleges & universities (Wikidata)',
  description:
    'Nigerian universities (federal, state, private), polytechnics, colleges of education and other colleges from Wikidata (CC0): state, city, year founded, website, map location. Takes about a minute.',
  iso2: 'NG',
  countryQid: 'Q1033',
  languages: ['en'],
  universityClasses: UNIVERSITY_CLASSES,
  collegeClasses: COLLEGE_CLASSES,
  skipExistingNames: true,
  universityNamePattern: /\buniversity\b/i,
  subdivisions: {
    'NG-AB': ['Abia', 'state'], 'NG-AD': ['Adamawa', 'state'], 'NG-AK': ['Akwa Ibom', 'state'],
    'NG-AN': ['Anambra', 'state'], 'NG-BA': ['Bauchi', 'state'], 'NG-BY': ['Bayelsa', 'state'],
    'NG-BE': ['Benue', 'state'], 'NG-BO': ['Borno', 'state'], 'NG-CR': ['Cross River', 'state'],
    'NG-DE': ['Delta', 'state'], 'NG-EB': ['Ebonyi', 'state'], 'NG-ED': ['Edo', 'state'],
    'NG-EK': ['Ekiti', 'state'], 'NG-EN': ['Enugu', 'state'], 'NG-FC': ['Federal Capital Territory', 'capital_territory'],
    'NG-GO': ['Gombe', 'state'], 'NG-IM': ['Imo', 'state'], 'NG-JI': ['Jigawa', 'state'],
    'NG-KD': ['Kaduna', 'state'], 'NG-KN': ['Kano', 'state'], 'NG-KT': ['Katsina', 'state'],
    'NG-KE': ['Kebbi', 'state'], 'NG-KO': ['Kogi', 'state'], 'NG-KW': ['Kwara', 'state'],
    'NG-LA': ['Lagos', 'state'], 'NG-NA': ['Nasarawa', 'state'], 'NG-NI': ['Niger', 'state'],
    'NG-OG': ['Ogun', 'state'], 'NG-ON': ['Ondo', 'state'], 'NG-OS': ['Osun', 'state'],
    'NG-OY': ['Oyo', 'state'], 'NG-PL': ['Plateau', 'state'], 'NG-RI': ['Rivers', 'state'],
    'NG-SO': ['Sokoto', 'state'], 'NG-TA': ['Taraba', 'state'], 'NG-YO': ['Yobe', 'state'],
    'NG-ZA': ['Zamfara', 'state'],
  },
});

// -----------------------------------------------------------------------------
// Egypt (not in the 20 pilot countries: the source adds it, inactive)
// -----------------------------------------------------------------------------

export const egyptWikidataSource = createWikidataHigherEdSource({
  key: 'eg_wikidata',
  label: 'Egypt: colleges & universities (Wikidata)',
  description:
    'Egyptian public and private universities, academies and higher institutes from Wikidata (CC0): governorate, city, year founded, website, map location. Adds Egypt to the country list (hidden until activated).',
  iso2: 'EG',
  countryQid: 'Q79',
  languages: ['en', 'ar'],
  universityClasses: UNIVERSITY_CLASSES,
  collegeClasses: COLLEGE_CLASSES,
  skipExistingNames: true,
  universityNamePattern: /\buniversity\b|جامعة/i,
  country: {
    iso3: 'EGY',
    isoNumeric: '818',
    name: 'Egypt',
    continentCode: 'AF',
    region: { m49: '015', name: 'Northern Africa' },
  },
  subdivisions: {
    'EG-ALX': ['Alexandria', 'governorate'], 'EG-ASN': ['Aswan', 'governorate'], 'EG-AST': ['Asyut', 'governorate'],
    'EG-BA': ['Red Sea', 'governorate'], 'EG-BH': ['Beheira', 'governorate'], 'EG-BNS': ['Beni Suef', 'governorate'],
    'EG-C': ['Cairo', 'governorate'], 'EG-DK': ['Dakahlia', 'governorate'], 'EG-DT': ['Damietta', 'governorate'],
    'EG-FYM': ['Faiyum', 'governorate'], 'EG-GH': ['Gharbia', 'governorate'], 'EG-GZ': ['Giza', 'governorate'],
    'EG-IS': ['Ismailia', 'governorate'], 'EG-JS': ['South Sinai', 'governorate'], 'EG-KB': ['Qalyubia', 'governorate'],
    'EG-KFS': ['Kafr el-Sheikh', 'governorate'], 'EG-KN': ['Qena', 'governorate'], 'EG-LX': ['Luxor', 'governorate'],
    'EG-MN': ['Minya', 'governorate'], 'EG-MNF': ['Monufia', 'governorate'], 'EG-MT': ['Matrouh', 'governorate'],
    'EG-PTS': ['Port Said', 'governorate'], 'EG-SHG': ['Sohag', 'governorate'], 'EG-SHR': ['Sharqia', 'governorate'],
    'EG-SIN': ['North Sinai', 'governorate'], 'EG-SUZ': ['Suez', 'governorate'], 'EG-WAD': ['New Valley', 'governorate'],
  },
});

// -----------------------------------------------------------------------------
// Canada
// -----------------------------------------------------------------------------

export const canadaWikidataSource = createWikidataHigherEdSource({
  key: 'ca_wikidata',
  label: 'Canada: colleges & universities (Wikidata)',
  description:
    'Canadian universities, colleges, CEGEPs and community colleges from Wikidata (CC0): province, city, year founded, website, map location. Takes about a minute.',
  iso2: 'CA',
  countryQid: 'Q16',
  languages: ['en', 'fr'],
  universityClasses: UNIVERSITY_CLASSES,
  collegeClasses: [...COLLEGE_CLASSES, 'Q1336920', 'Q1110056', 'Q108415947'], // + community college, CEGEP, Ontario college
  skipExistingNames: true,
  subdivisions: {
    'CA-AB': ['Alberta', 'province'],
    'CA-BC': ['British Columbia', 'province'],
    'CA-MB': ['Manitoba', 'province'],
    'CA-NB': ['New Brunswick', 'province'],
    'CA-NL': ['Newfoundland and Labrador', 'province'],
    'CA-NS': ['Nova Scotia', 'province'],
    'CA-ON': ['Ontario', 'province'],
    'CA-PE': ['Prince Edward Island', 'province'],
    'CA-QC': ['Quebec', 'province'],
    'CA-SK': ['Saskatchewan', 'province'],
    'CA-NT': ['Northwest Territories', 'territory'],
    'CA-NU': ['Nunavut', 'territory'],
    'CA-YT': ['Yukon', 'territory'],
  },
});

// -----------------------------------------------------------------------------
// Mexico: Wikidata items not already in the official SEP register (matched by
// name within the state, as Wikidata has no SEP work-centre key).
// -----------------------------------------------------------------------------

export const mexicoWikidataExtraSource = createWikidataHigherEdSource({
  key: 'mx_wikidata_extra',
  label: 'Mexico: more colleges & universities (Wikidata)',
  description:
    'Mexican universities and institutes in Wikidata whose name is not already listed in the same state from the SEP register. Run after the SEP source.',
  iso2: 'MX',
  countryQid: 'Q96',
  languages: ['es', 'en'],
  variant: 'extra',
  skipExistingNames: true,
  universityClasses: UNIVERSITY_CLASSES,
  collegeClasses: COLLEGE_CLASSES,
  universityNamePattern: /universidad|university/i,
  subdivisions: Object.fromEntries(
    Object.values(MX_STATES).map(([code, name]) => [code, [name, code === 'MX-CMX' ? 'federal_entity' : 'state']]),
  ),
});
