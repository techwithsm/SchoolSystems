import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { stableId } from '../ids';
import { upsertSources } from '../citations';
import { pick, readTableFile } from '../table-file';
import { syncRows } from '../upsert';
import type { Row, SyncContext, SyncSource } from '../types';

/**
 * India higher education institutions from the official AISHE directory
 * (All India Survey on Higher Education, Ministry of Education).
 *
 * Put the downloaded file(s) in web/data/india/aishe/ (.xlsx or .csv).
 * Works with the colleges file and, if you also have it, a universities file.
 * Columns are matched by name, so extra/missing columns are fine.
 *
 * Ids:  colleges/standalone -> md5('IN/aishe/<AISHE code>')
 *       universities        -> md5('IN/univ/<normalized name>'), so a university
 *       named only as "Affiliated University" in the colleges file and the
 *       same university in a universities file are one row.
 */
export const INDIA_AISHE_DIR = path.join(process.cwd(), 'data', 'india', 'aishe');

const COL = {
  code: ['aishe_code', 'aishecode', 'aishe_id', 'institution_code'],
  name: ['name_of_the_institution', 'name_of_institution', 'institution_name', 'name_of_the_college', 'college_name', 'name_of_the_university', 'university_name', 'name'],
  state: ['state', 'state_name'],
  district: ['district', 'district_name'],
  year: ['year_of_establishment', 'establishment_year', 'year_established', 'year_of_est'],
  location: ['location', 'area', 'location_type'],
  collegeType: ['college_type', 'institution_type', 'type_of_college'],
  universityType: ['university_type', 'type_of_university'],
  management: ['management', 'management_type', 'type_of_management'],
  affilName: ['affiliated_university_name', 'affiliating_university_name', 'affiliating_university', 'affiliated_university'],
  affilType: ['affiliated_university_type', 'affiliating_university_type'],
  website: ['website', 'website_url', 'url'],
  address: ['address', 'full_address', 'address_line'],
  city: ['city', 'town', 'city_town'],
  pincode: ['pincode', 'pin_code', 'pin', 'postal_code'],
  phone: ['phone', 'phone_number', 'telephone', 'contact_number', 'mobile'],
  email: ['email', 'email_id', 'e_mail'],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const STATE_ALIASES: Record<string, string> = {
  orissa: 'odisha',
  pondicherry: 'puducherry',
  uttaranchal: 'uttarakhand',
  'nct of delhi': 'delhi',
  'andaman and nicobar': 'andaman and nicobar islands',
  'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman and diu': 'dadra and nagar haveli and daman and diu',
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

function mapLocality(text: string | null): string | null {
  const t = text?.toLowerCase() ?? '';
  return t.startsWith('rural') ? 'rural' : t.startsWith('urban') ? 'urban' : null;
}

function cleanYear(text: string | null): number | null {
  const m = text?.match(/\b(1\d{3}|20\d{2})\b/);
  const y = m ? Number(m[1]) : NaN;
  return y >= 1000 && y <= new Date().getUTCFullYear() + 1 ? y : null;
}

const cleanEmail = (s: string | null) => (s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s.toLowerCase() : null);
const cleanPhone = (s: string | null) => (s && /^\+?[0-9 ()./-]{5,30}$/.test(s) ? s : null);
const cleanUrl = (s: string | null) => {
  if (!s) return null;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(u) ? u : null;
};

/** Counts unmapped values so the admin sees e.g. "management 'Xyz' x 120". */
class Tally {
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

export const indiaAisheSource: SyncSource = {
  key: 'india_aishe',
  label: 'India: colleges & universities (AISHE)',
  description:
    'Official AISHE directory files in web/data/india/aishe/ (.xlsx or .csv): every college, university and standalone institution, with state, district, type, management and affiliation.',

  async run(ctx) {
    let names: string[];
    try {
      names = (await readdir(INDIA_AISHE_DIR)).filter((n) => /\.(xlsx|csv)$/i.test(n) && !n.startsWith('~$')).sort();
    } catch {
      ctx.warn(`Folder not found: ${INDIA_AISHE_DIR}. Create it and add the AISHE file.`);
      return;
    }
    if (names.length === 0) {
      ctx.warn('No .xlsx or .csv files in data/india/aishe (nothing to do).');
      return;
    }

    // State name -> ISO 3166-2 code from core.subdivisions.
    const { data: subs, error: subErr } = await ctx.db
      .schema('core')
      .from('subdivisions')
      .select('code, name')
      .eq('country_iso2', 'IN');
    if (subErr) throw new Error(`core.subdivisions: read failed: ${subErr.message}`);
    if (!subs?.length) throw new Error('India states missing in core.subdivisions. Apply migration 20261107000600 first.');
    const stateCode = new Map(subs.map((s) => [norm(s.name), s.code as string]));
    const toState = (s: string | null) => (s ? (stateCode.get(STATE_ALIASES[norm(s)] ?? norm(s)) ?? null) : null);

    // One citation row for the whole directory, dated by the newest file.
    const newest = Math.max(...(await Promise.all(names.map(async (n) => (await stat(path.join(INDIA_AISHE_DIR, n))).mtimeMs))));
    const sourceId = stableId('IN/src/aishe_directory');
    await upsertSources(ctx, [
      {
        id: sourceId,
        title: 'AISHE Higher Education Institutions Directory',
        url: 'https://dashboard.aishe.gov.in/hedirectory/',
        publisher: 'Ministry of Education, Department of Higher Education (AISHE)',
        source_type_code: 'ministry',
        country_iso2: 'IN',
        accessed_on: new Date(newest).toISOString().slice(0, 10),
        license_code: 'ogl_in',
        notes: `Imported from ${names.join(', ')} (also distributed via IndiaAI AIKosh).`,
      },
    ]);

    const universities = new Map<string, Row>(); // key: normalized name
    const colleges = new Map<string, Row>(); // key: AISHE code
    const pendingAffil: { collegeCode: string; univKey: string }[] = [];
    const badState = new Tally();
    const badMgmt = new Tally();
    let dupCodes = 0;
    let droppedContact = 0;

    const addUniversity = (name: string, fields: Row) => {
      const key = norm(name);
      const prev = universities.get(key) ?? {};
      // Explicit rows from a universities file win over names derived from colleges.
      const merged: Row = { ...prev };
      for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) merged[k] = v;
      merged.id = stableId(`IN/univ/${key}`);
      merged.name = merged.name ?? name;
      universities.set(key, merged);
      return key;
    };

    for (const fileName of names) {
      const { headers, rows } = await readTableFile(path.join(INDIA_AISHE_DIR, fileName), (cells) =>
        cells.some((c) => COL.code.includes(c)),
      );
      if (!headers.length) {
        ctx.warn(`${fileName}: no header row with an 'AISHE Code' column found; skipped`);
        continue;
      }
      const has = (names: string[]) => names.some((n) => headers.includes(n));

      for (const r of rows) {
        const code = pick(r, COL.code)?.toUpperCase().replace(/\s+/g, '') ?? null;
        const name = pick(r, COL.name);
        if (!code || !name) continue;

        const stateText = pick(r, COL.state);
        const subdivision = toState(stateText);
        if (stateText && !subdivision) badState.add(stateText);

        const universityType = pick(r, COL.universityType);
        const collegeType = pick(r, COL.collegeType);
        const isUniversity = code.startsWith('U-') || (!!universityType && !collegeType);
        const managementText = pick(r, COL.management) ?? (isUniversity ? universityType : null);
        const management = mapManagement(managementText);
        if (managementText && !management) badMgmt.add(managementText);

        const phoneRaw = pick(r, COL.phone);
        const emailRaw = pick(r, COL.email);
        const phone = cleanPhone(phoneRaw);
        const email = cleanEmail(emailRaw);
        if ((phoneRaw && !phone) || (emailRaw && !email)) droppedContact++;

        // Only write contact/address columns the file actually has.
        const optional: Row = {};
        if (has(COL.website)) optional.website = cleanUrl(pick(r, COL.website));
        if (has(COL.address)) optional.address_line = pick(r, COL.address);
        if (has(COL.city)) optional.city = pick(r, COL.city);
        if (has(COL.pincode)) optional.postal_code = pick(r, COL.pincode);
        if (has(COL.phone)) optional.phone = phone;
        if (has(COL.email)) optional.email = email;

        const base: Row = {
          country_iso2: 'IN',
          subdivision_code: subdivision,
          district: pick(r, COL.district),
          name,
          management_type_code: management,
          locality_type_code: mapLocality(pick(r, COL.location)),
          year_established: cleanYear(pick(r, COL.year)),
          external_id: code,
          external_id_scheme: 'AISHE',
          source_id: sourceId,
          ...optional,
        };

        if (isUniversity) {
          addUniversity(name, { ...base, school_type_code: 'higher_ed_university', local_type: universityType });
          continue;
        }

        if (colleges.has(code)) dupCodes++;
        colleges.set(code, {
          ...base,
          id: stableId(`IN/aishe/${code}`),
          school_type_code: 'higher_ed_college',
          local_type: collegeType ?? (code.startsWith('S-') ? 'Standalone Institution' : null),
        });

        const affilName = pick(r, COL.affilName);
        if (affilName) {
          const affilType = pick(r, COL.affilType);
          const key = addUniversity(affilName, {});
          const u = universities.get(key)!;
          // Fill type/management for universities known only by name.
          if (affilType && !u.local_type) u.local_type = affilType;
          if (affilType && !u.management_type_code) u.management_type_code = mapManagement(affilType);
          pendingAffil.push({ collegeCode: code, univKey: key });
        }
      }
    }

    // Universities known only from the colleges file: required defaults.
    for (const u of universities.values()) {
      u.country_iso2 = 'IN';
      u.school_type_code = 'higher_ed_university';
      u.source_id = sourceId;
      if (u.external_id === undefined) {
        u.external_id = null;
        u.external_id_scheme = null;
      }
    }
    for (const { collegeCode, univKey } of pendingAffil) {
      const c = colleges.get(collegeCode);
      if (c) c.affiliated_to_id = universities.get(univKey)!.id;
    }

    // All rows in a batch must have the same columns.
    const uniform = (rows: Row[]) => {
      const cols = new Set(rows.flatMap((r) => Object.keys(r)));
      return rows.map((r) => Object.fromEntries([...cols].map((c) => [c, r[c] ?? null])));
    };

    // Universities first (colleges reference them).
    await syncRows(ctx, {
      schema: 'edu',
      table: 'schools',
      keyColumns: ['id'],
      tracksVerification: true,
      scope: { country_iso2: 'IN', school_type_code: 'higher_ed_university' },
      rows: uniform([...universities.values()]),
    });
    await syncRows(ctx, {
      schema: 'edu',
      table: 'schools',
      keyColumns: ['id'],
      tracksVerification: true,
      scope: { country_iso2: 'IN', school_type_code: 'higher_ed_college' },
      rows: uniform([...colleges.values()]),
    });

    ctx.warn(`Read ${colleges.size} colleges/standalone institutions and ${universities.size} universities from ${names.length} file(s).`);
    if (dupCodes) ctx.warn(`${dupCodes} duplicate AISHE codes in the files (last one kept).`);
    if (droppedContact) ctx.warn(`${droppedContact} rows had a phone or email in an invalid format (left empty).`);
    badState.report(ctx, 'State');
    badMgmt.report(ctx, 'Management');
  },
};
