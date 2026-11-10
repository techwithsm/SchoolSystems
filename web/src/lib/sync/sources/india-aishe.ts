import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { upsertSources } from '../citations';
import { pick, readTableFile } from '../table-file';
import { writeInstitutionRows } from './common';
import type { Row, SyncSource } from '../types';
import {
  AISHE_FILE_SOURCE_ID,
  cleanEmail,
  cleanPhone,
  cleanUrl,
  cleanYear,
  collegeId,
  loadIndiaStates,
  mapManagement,
  Tally,
  uniform,
  UniversityResolver,
  dropDuplicateCodes,
} from './india-common';

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

function mapLocality(text: string | null): string | null {
  const t = text?.toLowerCase() ?? '';
  return t.startsWith('rural') ? 'rural' : t.startsWith('urban') ? 'urban' : null;
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
    const toState = (await loadIndiaStates(ctx)).fromName;

    // One citation row for the whole directory, dated by the newest file.
    const newest = Math.max(...(await Promise.all(names.map(async (n) => (await stat(path.join(INDIA_AISHE_DIR, n))).mtimeMs))));
    const sourceId = AISHE_FILE_SOURCE_ID;
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

    const resolver = await UniversityResolver.load(ctx);
    const universities = new Map<string, Row>(); // key: university id
    const colleges = new Map<string, Row>(); // key: AISHE code
    const badState = new Tally();
    const badMgmt = new Tally();
    let dupCodes = 0;
    let droppedContact = 0;

    /** Adds or merges a university; returns its id. Explicit rows win over names from affiliations. */
    const addUniversity = (name: string, code: string | null, fields: Row) => {
      const id = resolver.resolve(code, name);
      const merged: Row = { ...(universities.get(id) ?? {}) };
      for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) merged[k] = v;
      merged.id = id;
      merged.name ??= name;
      universities.set(id, merged);
      return id;
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
          addUniversity(name, code, { ...base, school_type_code: 'higher_ed_university', local_type: universityType });
          continue;
        }

        if (colleges.has(code)) dupCodes++;
        const college: Row = {
          ...base,
          id: collegeId(code),
          school_type_code: 'higher_ed_college',
          local_type: collegeType ?? (code.startsWith('S-') ? 'Standalone Institution' : null),
        };

        const affilName = pick(r, COL.affilName);
        if (affilName) {
          const affilType = pick(r, COL.affilType);
          const id = addUniversity(affilName, null, {});
          const u = universities.get(id)!;
          // Fill type/management for universities known only by name.
          if (affilType && !u.local_type) u.local_type = affilType;
          if (affilType && !u.management_type_code) u.management_type_code = mapManagement(affilType);
          college.affiliated_to_id = id;
        }
        colleges.set(code, college);
      }
    }

    // Universities known only from the colleges file: required defaults.
    for (const u of universities.values()) {
      u.country_iso2 = 'IN';
      u.school_type_code = 'higher_ed_university';
      u.source_id = sourceId;
      if (u.external_id === undefined) {
        // Keep the code an earlier sync (e.g. Wikidata) stored for this row.
        const known = resolver.codeOf(u.id as string);
        u.external_id = known;
        u.external_id_scheme = known ? 'AISHE' : null;
      }
    }

    const uniRows = uniform([...universities.values()]);
    const collegeRows = uniform([...colleges.values()]);
    await dropDuplicateCodes(ctx, [...uniRows, ...collegeRows]);

    // Shared write path: standardize, universities first, phones kept safe.
    await writeInstitutionRows(ctx, [...uniRows, ...collegeRows], { country_iso2: 'IN' });

    ctx.warn(`Read ${colleges.size} colleges/standalone institutions and ${universities.size} universities from ${names.length} file(s).`);
    if (dupCodes) ctx.warn(`${dupCodes} duplicate AISHE codes in the files (last one kept).`);
    if (droppedContact) ctx.warn(`${droppedContact} rows had a phone or email in an invalid format (left empty).`);
    badState.report(ctx, 'State');
    badMgmt.report(ctx, 'Management');
  },
};
