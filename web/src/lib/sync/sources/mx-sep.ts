import { stableId } from '../ids';
import { upsertSources } from '../citations';
import { parseCsv } from '../csv';
import type { Row, SyncContext, SyncSource } from '../types';
import { cleanCoord, cleanEmail, ensureSubdivisions, mapLimit, Tally, writeInstitutions } from './common';

/**
 * Mexico higher education institutions from the SEP "Catálogo de centros de
 * trabajo" (official register of every education work centre), published on
 * datos.gob.mx under CC BY 4.0. One CSV per state; the file list comes from
 * the portal's CKAN API, so new uploads are picked up automatically.
 *
 * Included: active (c_estatus = ACTIVO) schools (c_tipo = ESCUELA) whose CCT
 * key has a higher-education type (letters 4-5 of the key, see HIGHER_ED).
 *
 * PRIVACY: the file also has a contact person (name, CURP, RFC). Those
 * columns are never read. Only an institutional phone and a non-webmail email
 * are kept.
 */
const CKAN = 'https://www.datos.gob.mx/api/3/action/package_show?id=catalogo_centros_trabajo_sep';
const DATASET_URL = 'https://www.datos.gob.mx/dataset/catalogo_centros_trabajo_sep';
const UA = 'Mozilla/5.0 (compatible; SchoolSystemsDirectory-Sync/1.0)';

/** CCT type letters (positions 4-5) for higher education -> label. */
const HIGHER_ED: Record<string, string> = {
  SU: 'Institución de educación superior',
  UT: 'Universidad tecnológica',
  PO: 'Universidad politécnica',
  UI: 'Universidad intercultural',
  IT: 'Instituto tecnológico',
  UP: 'Universidad Pedagógica Nacional',
  NL: 'Escuela normal',
  NE: 'Escuela normal',
  NP: 'Escuela normal',
  NS: 'Escuela normal superior',
};
const UNIVERSITY_TYPES = new Set(['UT', 'PO', 'UI', 'UP']);

/** INEGI state number -> ISO 3166-2:MX. */
export const STATES: Record<string, [code: string, name: string]> = {
  '01': ['MX-AGU', 'Aguascalientes'], '02': ['MX-BCN', 'Baja California'], '03': ['MX-BCS', 'Baja California Sur'],
  '04': ['MX-CAM', 'Campeche'], '05': ['MX-COA', 'Coahuila'], '06': ['MX-COL', 'Colima'], '07': ['MX-CHP', 'Chiapas'],
  '08': ['MX-CHH', 'Chihuahua'], '09': ['MX-CMX', 'Ciudad de México'], '10': ['MX-DUR', 'Durango'],
  '11': ['MX-GUA', 'Guanajuato'], '12': ['MX-GRO', 'Guerrero'], '13': ['MX-HID', 'Hidalgo'], '14': ['MX-JAL', 'Jalisco'],
  '15': ['MX-MEX', 'México'], '16': ['MX-MIC', 'Michoacán'], '17': ['MX-MOR', 'Morelos'], '18': ['MX-NAY', 'Nayarit'],
  '19': ['MX-NLE', 'Nuevo León'], '20': ['MX-OAX', 'Oaxaca'], '21': ['MX-PUE', 'Puebla'], '22': ['MX-QUE', 'Querétaro'],
  '23': ['MX-ROO', 'Quintana Roo'], '24': ['MX-SLP', 'San Luis Potosí'], '25': ['MX-SIN', 'Sinaloa'], '26': ['MX-SON', 'Sonora'],
  '27': ['MX-TAB', 'Tabasco'], '28': ['MX-TAM', 'Tamaulipas'], '29': ['MX-TLA', 'Tlaxcala'], '30': ['MX-VER', 'Veracruz'],
  '31': ['MX-YUC', 'Yucatán'], '32': ['MX-ZAC', 'Zacatecas'],
};

const WEBMAIL = /@(gmail|hotmail|yahoo|outlook|live|icloud|prodigy|msn|aol|protonmail)\./i;

const SMALL = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'para', 'por', 'con', 'sin', 'al']);
const ROMAN = /^(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

/** 'UNIVERSIDAD TECNOLOGICA DE LA ZONA' -> 'Universidad Tecnologica de la Zona' (keeps A.C., III, 5/1). */
export function titleCase(s: string | null): string | null {
  if (!s) return null;
  return s
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (/[.\d/]/.test(w) || ROMAN.test(w)) return w.toUpperCase();
      if (i > 0 && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function phone(raw: string | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+52 ${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  return null;
}

function management(control: string, subcontrol: string): string | null {
  const c = control.toUpperCase();
  if (c.startsWith('PÚBLICO') || c.startsWith('PUBLICO')) return 'government';
  if (c.startsWith('PRIVADO')) return subcontrol.toUpperCase().includes('SUBSIDIO') ? 'government_aided' : 'private';
  return null;
}

/** File list from the portal's CKAN API; retries temporary failures (the portal is sometimes busy). */
async function listStateFiles(): Promise<{ urls: string[]; modified: string | null }> {
  let lastError = 'unknown error';
  let body: { result: { metadata_modified?: string; resources: { url: string }[] } } | null = null;
  for (let attempt = 0; attempt < 4 && !body; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 * 2 ** (attempt - 1))); // 3s, 6s, 12s
    try {
      const res = await fetch(CKAN, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000), cache: 'no-store' });
      if (res.ok) body = await res.json();
      else lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!body) {
    throw new Error(
      `datos.gob.mx is not responding (${lastError}) after 4 attempts. The Mexican data portal is temporarily unavailable; existing Mexico data is unchanged. Try again later.`,
    );
  }
  const urls = body.result.resources.map((r) => r.url).filter((u) => /catalogo_centro_trabajo_\d\d_csv\.csv$/i.test(u));
  return { urls, modified: body.result.metadata_modified ?? null };
}

async function downloadText(url: string): Promise<string> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180_000), cache: 'no-store' });
      if (res.ok) return await res.text();
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export const mexicoSepSource: SyncSource = {
  key: 'mx_sep',
  writesInstitutions: true,
  label: 'Mexico: colleges & universities (SEP)',
  description:
    'Official SEP register of education centres (datos.gob.mx, CC BY 4.0): every active university, technological institute and teacher-training college, with address, municipality, postcode, map location and public/private status. Downloads 32 state files (~2 minutes).',

  async run(ctx: SyncContext) {
    await ensureSubdivisions(
      ctx,
      'MX',
      Object.fromEntries(Object.values(STATES).map(([code, name]) => [code, [name, code === 'MX-CMX' ? 'federal_entity' : 'state']])),
    );

    const { urls, modified } = await listStateFiles();
    if (urls.length < 32) ctx.warn(`Expected 32 state files, found ${urls.length}.`);

    const sourceId = stableId('MX/src/sep_cct');
    await upsertSources(ctx, [
      {
        id: sourceId,
        title: 'Catálogo de centros de trabajo SEP',
        url: DATASET_URL,
        publisher: 'Secretaría de Educación Pública (SEP)',
        source_type_code: 'ministry',
        country_iso2: 'MX',
        accessed_on: ctx.today,
        license_code: 'cc_by_4',
        notes: `State CSV files from datos.gob.mx${modified ? ` (dataset modified ${modified.slice(0, 10)})` : ''}. Active schools with a higher-education CCT type.`,
      },
    ]);

    const rows = new Map<string, Row>(); // key: CCT
    const badState = new Tally();
    let failedFiles = 0;

    await mapLimit(urls, 3, async (url) => {
      let text: string;
      try {
        text = await downloadText(url);
      } catch (err) {
        failedFiles++;
        ctx.warn(`Download failed for ${url.split('/').pop()}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      for (const r of parseCsv(text)) {
        const cct = r.cv_cct?.toUpperCase();
        const typeCode = cct?.slice(3, 5) ?? '';
        if (!cct || !HIGHER_ED[typeCode] || r.c_tipo !== 'ESCUELA' || r.c_estatus !== 'ACTIVO') continue;

        const ent = (r.inmueble_cv_ent ?? '').padStart(2, '0');
        const state = STATES[ent]?.[0] ?? STATES[cct.slice(0, 2)]?.[0] ?? null;
        if (!state) badState.add(r.inmueble_cv_ent ?? cct.slice(0, 2));

        const extNum = r.inmueble_n_extnum && r.inmueble_n_extnum !== '0' ? r.inmueble_n_extnum : '';
        const street = [r.inmueble_c_vialidad_principal, `${extNum}${r.inmueble_c_extalf ?? ''}`.trim()].filter(Boolean).join(' ');
        const colonia = r.inmueble_c_nom_asen ? `Col. ${titleCase(r.inmueble_c_nom_asen)}` : null;
        const postal = (r.inmueble_cv_codigo_postal ?? '').replace(/\.0$/, '');
        const email = cleanEmail(r.contacto_c_email ?? null);
        const name = titleCase(r.c_nombre)!;
        const subcontrol = r.sostenimiento_c_subcontrol ?? '';

        rows.set(cct, {
          id: stableId(`MX/sep/${cct}`),
          country_iso2: 'MX',
          subdivision_code: state,
          district: titleCase(r.inmueble_c_nom_mun),
          city: titleCase(r.inmueble_c_nom_loc),
          address_line: [titleCase(street), colonia].filter(Boolean).join(', ') || null,
          postal_code: /^\d{4,5}$/.test(postal) ? postal.padStart(5, '0') : null,
          latitude: cleanCoord(r.latitud, -90, 90),
          longitude: cleanCoord(r.longitud, -180, 180),
          name,
          school_type_code:
            UNIVERSITY_TYPES.has(typeCode) || /\buniversidad\b/i.test(name) ? 'higher_ed_university' : 'higher_ed_college',
          local_type: subcontrol ? `${HIGHER_ED[typeCode]} (${titleCase(subcontrol)})` : HIGHER_ED[typeCode],
          management_type_code: management(r.sostenimiento_c_control ?? '', subcontrol),
          phone: phone(r.contacto_c_telef),
          email: email && !WEBMAIL.test(email) ? email : null,
          external_id: cct,
          external_id_scheme: 'SEP_CCT',
          status_code: 'open',
          source_id: sourceId,
        });
      }
    });

    if (failedFiles > 3) throw new Error(`${failedFiles} state files could not be downloaded; try again later.`);
    const all = [...rows.values()];
    await writeInstitutions(ctx, 'MX', all);

    const unis = all.filter((r) => r.school_type_code === 'higher_ed_university').length;
    ctx.warn(`SEP: ${unis} universities and ${all.length - unis} colleges/institutes from ${urls.length - failedFiles} state files.`);
    badState.report(ctx, 'State');
  },
};
