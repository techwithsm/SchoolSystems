import { strFromU8, unzipSync } from 'fflate';
import { stableId } from '../ids';
import { upsertSources } from '../citations';
import { parseCsv } from '../csv';
import { syncRows } from '../upsert';
import type { Row, SyncContext, SyncSource } from '../types';
import { cleanUrl, uniform } from './common';

/**
 * United States colleges and universities from IPEDS (Integrated
 * Postsecondary Education Data System, NCES, U.S. Department of Education).
 * Public domain. Downloads the newest "Directory information" (HD) file.
 *
 * Included: institutions active in the current year (CYACTIVE=1) that grant
 * degrees (DEGGRANT=1), excluding system/administrative offices (SECTOR=0)
 * and the freely associated states (FM, MH, PW), which are separate countries.
 */
const DOWNLOAD = (year: number) => `https://nces.ed.gov/ipeds/datacenter/data/HD${year}.zip`;

/** ISO 3166-2:US: states, DC and the outlying areas IPEDS covers. */
const US_SUBDIVISIONS: Record<string, [name: string, type: string]> = {
  AL: ['Alabama', 'state'], AK: ['Alaska', 'state'], AZ: ['Arizona', 'state'], AR: ['Arkansas', 'state'],
  CA: ['California', 'state'], CO: ['Colorado', 'state'], CT: ['Connecticut', 'state'], DE: ['Delaware', 'state'],
  FL: ['Florida', 'state'], GA: ['Georgia', 'state'], HI: ['Hawaii', 'state'], ID: ['Idaho', 'state'],
  IL: ['Illinois', 'state'], IN: ['Indiana', 'state'], IA: ['Iowa', 'state'], KS: ['Kansas', 'state'],
  KY: ['Kentucky', 'state'], LA: ['Louisiana', 'state'], ME: ['Maine', 'state'], MD: ['Maryland', 'state'],
  MA: ['Massachusetts', 'state'], MI: ['Michigan', 'state'], MN: ['Minnesota', 'state'], MS: ['Mississippi', 'state'],
  MO: ['Missouri', 'state'], MT: ['Montana', 'state'], NE: ['Nebraska', 'state'], NV: ['Nevada', 'state'],
  NH: ['New Hampshire', 'state'], NJ: ['New Jersey', 'state'], NM: ['New Mexico', 'state'], NY: ['New York', 'state'],
  NC: ['North Carolina', 'state'], ND: ['North Dakota', 'state'], OH: ['Ohio', 'state'], OK: ['Oklahoma', 'state'],
  OR: ['Oregon', 'state'], PA: ['Pennsylvania', 'state'], RI: ['Rhode Island', 'state'], SC: ['South Carolina', 'state'],
  SD: ['South Dakota', 'state'], TN: ['Tennessee', 'state'], TX: ['Texas', 'state'], UT: ['Utah', 'state'],
  VT: ['Vermont', 'state'], VA: ['Virginia', 'state'], WA: ['Washington', 'state'], WV: ['West Virginia', 'state'],
  WI: ['Wisconsin', 'state'], WY: ['Wyoming', 'state'],
  DC: ['District of Columbia', 'district'],
  AS: ['American Samoa', 'outlying_area'], GU: ['Guam', 'outlying_area'], MP: ['Northern Mariana Islands', 'outlying_area'],
  PR: ['Puerto Rico', 'outlying_area'], VI: ['U.S. Virgin Islands', 'outlying_area'],
};

/** IPEDS SECTOR codes (official labels), stored in local_type. */
const SECTOR: Record<string, string> = {
  '1': 'Public, 4-year or above',
  '2': 'Private not-for-profit, 4-year or above',
  '3': 'Private for-profit, 4-year or above',
  '4': 'Public, 2-year',
  '5': 'Private not-for-profit, 2-year',
  '6': 'Private for-profit, 2-year',
  '7': 'Public, less-than 2-year',
  '8': 'Private not-for-profit, less-than 2-year',
  '9': 'Private for-profit, less-than 2-year',
};

/** CONTROL: 1 public, 2 private not-for-profit, 3 private for-profit. */
const MANAGEMENT: Record<string, string> = { '1': 'government', '2': 'private', '3': 'private' };

/** LOCALE (NCES urban-centric): 1x city, 2x suburb, 3x town, 4x rural (43 = remote). */
function mapLocale(code: string): string | null {
  if (/^1[123]$/.test(code)) return 'urban';
  if (/^2[123]$/.test(code)) return 'suburban';
  if (code === '43') return 'remote';
  if (/^4[12]$/.test(code)) return 'rural';
  return null; // towns (3x) have no matching category; unknown = NULL
}

/**
 * "University" here means a doctoral research institution (HDEGOFR1 11/12)
 * or one that calls itself a university; everything else is a college.
 * The exact IPEDS sector is always kept in local_type.
 */
const isUniversity = (r: Record<string, string>) =>
  r.HDEGOFR1 === '11' || r.HDEGOFR1 === '12' || /\buniversity\b/i.test(r.INSTNM);

function formatPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `+1 ${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d.length >= 5 && d.length <= 15 ? d : null;
}

function coord(v: string, min: number, max: number): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1e6) / 1e6 : null;
}

/** Downloads the newest published HD file (tries this year back to 4 years ago). */
async function downloadLatest(ctx: SyncContext): Promise<{ year: number; csv: string; url: string }> {
  const thisYear = new Date().getUTCFullYear();
  for (let year = thisYear; year >= thisYear - 4; year--) {
    const url = DOWNLOAD(year);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SchoolSystemsDirectory-Sync/1.0' },
      signal: AbortSignal.timeout(120_000),
      cache: 'no-store',
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`IPEDS download failed: HTTP ${res.status} for ${url}`);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    // Prefer the revised file (hdYYYY_rv.csv) when NCES has published one.
    const names = Object.keys(files).filter((n) => /\.csv$/i.test(n));
    const name = names.find((n) => /_rv\.csv$/i.test(n)) ?? names[0];
    if (!name) throw new Error(`No CSV inside ${url}`);
    return { year, csv: strFromU8(files[name]), url };
  }
  ctx.warn('No IPEDS directory file found for the last 5 years.');
  throw new Error('IPEDS directory file not found.');
}

export const usIpedsSource: SyncSource = {
  key: 'us_ipeds',
  label: 'United States: colleges & universities (IPEDS)',
  description:
    'About 4,000 active degree-granting U.S. colleges and universities from the Department of Education (NCES IPEDS, public domain): address, county, phone, website, map location, public/private and sector. Downloads automatically.',

  async run(ctx) {
    // 1. Make sure every state/territory exists (reference data, ISO 3166-2:US).
    await syncRows(ctx, {
      schema: 'core',
      table: 'subdivisions',
      keyColumns: ['code'],
      rows: Object.entries(US_SUBDIVISIONS).map(([abbr, [name, type]]) => ({
        code: `US-${abbr}`,
        country_iso2: 'US',
        name,
        type,
      })),
    });

    // 2. Download and parse the newest directory file.
    const { year, csv, url } = await downloadLatest(ctx);
    const rows = parseCsv(csv);
    if (!rows.length || !('UNITID' in rows[0])) throw new Error(`HD${year}: unexpected file format`);

    const sourceId = stableId('US/src/ipeds_hd');
    await upsertSources(ctx, [
      {
        id: sourceId,
        title: `IPEDS Institutional Characteristics: Directory information (HD${year})`,
        url: 'https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx',
        publisher: 'National Center for Education Statistics (NCES), U.S. Department of Education',
        source_type_code: 'statistics_office',
        country_iso2: 'US',
        published_on: null,
        accessed_on: ctx.today,
        license_code: 'public_domain',
        notes: `Downloaded from ${url}. Active (CYACTIVE=1), degree-granting (DEGGRANT=1) institutions; SECTOR 0 excluded.`,
      },
    ]);

    // 3. Map rows.
    const universities: Row[] = [];
    const colleges: Row[] = [];
    let skippedOutside = 0;

    for (const r of rows) {
      if (r.CYACTIVE !== '1' || r.DEGGRANT !== '1' || r.SECTOR === '0') continue;
      const abbr = r.STABBR?.toUpperCase();
      if (!abbr || !US_SUBDIVISIONS[abbr]) {
        skippedOutside++;
        continue;
      }
      const university = isUniversity(r);
      const row: Row = {
        id: stableId(`US/ipeds/${r.UNITID}`),
        country_iso2: 'US',
        subdivision_code: `US-${abbr}`,
        district: r.COUNTYNM || null,
        city: r.CITY || null,
        address_line: r.ADDR || null,
        postal_code: r.ZIP || null,
        name: r.INSTNM,
        school_type_code: university ? 'higher_ed_university' : 'higher_ed_college',
        local_type: SECTOR[r.SECTOR] ?? null,
        management_type_code: MANAGEMENT[r.CONTROL] ?? null,
        locality_type_code: mapLocale(r.LOCALE ?? ''),
        phone: formatPhone(r.GENTELE ?? ''),
        website: cleanUrl(r.WEBADDR?.trim() || null),
        latitude: coord(r.LATITUDE ?? '', -90, 90),
        longitude: coord(r.LONGITUD ?? '', -180, 180),
        external_id: r.UNITID,
        external_id_scheme: 'IPEDS',
        status_code: 'open',
        source_id: sourceId,
      };
      (university ? universities : colleges).push(row);
    }

    // 4. Write (paged diff per type, same as the India sources).
    await syncRows(ctx, {
      schema: 'edu',
      table: 'schools',
      keyColumns: ['id'],
      tracksVerification: true,
      scope: { country_iso2: 'US', school_type_code: 'higher_ed_university' },
      rows: uniform(universities),
    });
    await syncRows(ctx, {
      schema: 'edu',
      table: 'schools',
      keyColumns: ['id'],
      tracksVerification: true,
      scope: { country_iso2: 'US', school_type_code: 'higher_ed_college' },
      rows: uniform(colleges),
    });

    ctx.warn(
      `IPEDS HD${year}: ${universities.length} universities and ${colleges.length} colleges` +
        (skippedOutside ? `; ${skippedOutside} outside the U.S. (FM, MH, PW) skipped` : '') +
        '.',
    );
  },
};
