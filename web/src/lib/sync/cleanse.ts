import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { titleCase } from '@/lib/text';
import type { Row } from './types';

export { titleCase };

/**
 * Standardization applied to every institution before it is written, from
 * any source, and by the "standardize existing records" job.
 *   - names: trimmed, stray leading punctuation removed, ALL-CAPS -> Title Case
 *   - labels (category): Title Case; non-education labels replaced
 *   - phone: validated for the country, formatted internationally (+91 231 260 2001)
 *   - website: syntactically valid http(s) URL (whether it WORKS is checked
 *     separately by the website checker; profiles only show checked links)
 */

/** True when a name is written in capitals (e.g. 'UNIVERSIDAD TECNOLOGICA'). */
function isShouting(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return letters.length >= 6 && letters === letters.toUpperCase() && /\p{Lu}/u.test(letters);
}

/**
 * Cleans an institution name. Returns null when nothing usable is left
 * (e.g. '01', '-', '?'), so the record is skipped instead of shown.
 */
export function cleanName(name: string | null | undefined): string | null {
  if (!name) return null;
  let n = name
    .normalize('NFC')
    .replace(/[\u0000-\u001f​-‍﻿]/g, '') // control / zero-width chars
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s:;,.\-–—|/\\*•·"'`]+/, '') // stray leading punctuation (': Sardar Patel ...')
    .replace(/[\s:;,\-–—|/\\*•·]+$/, '') // and trailing
    .trim();
  if (n.replace(/[^\p{L}]/gu, '').length < 3) return null; // '01', 'A1', '' -> unusable
  // All capitals: acronyms can't be told apart from words, so lower-case first
  // ('UNIVERSIDAD TECNOLOGICA DE LA HUASTECA' -> 'Universidad Tecnologica de la Huasteca').
  if (isShouting(n)) n = titleCase(n.toLowerCase())!;
  return n;
}

/**
 * Category labels must describe an education institution; values such as
 * 'open-access publisher' (a Wikidata type unrelated to teaching) are replaced.
 */
const EDUCATION_LABEL =
  /universit|college|school|institut|polytechnic|academ|seminar|conservator|faculty|centre|center|campus|educat|teacher|normal|cegep|cégep|universidad|instituto|escuela|colegio|tecnol|politécn|jamia|vidyalaya|vidyapeeth|mahavidyalaya|public|private|state|community|technical|vocational|medical|nursing|pharmacy|engineering|law|business|arts|science/i;

export function cleanCategory(label: string | null | undefined, fallback: string | null): string | null {
  const l = label?.replace(/\s+/g, ' ').trim();
  if (l && EDUCATION_LABEL.test(l)) return titleCase(l);
  return fallback;
}

/** Validates a phone number for the country; returns '+CC ...' or null. */
export function cleanPhoneNumber(raw: string | null | undefined, countryIso2: string): string | null {
  if (!raw) return null;
  const candidate = raw.replace(/^tel:/i, '').replace(/[^\d+()\-.\s/]/g, ' ').trim();
  if (!candidate) return null;
  try {
    const p = parsePhoneNumberFromString(candidate, countryIso2 as CountryCode);
    return p && p.isValid() ? p.formatInternational() : null;
  } catch {
    return null;
  }
}

/** Syntactically valid absolute http(s) URL with a dotted host, else null. */
export function cleanWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/\s+/g, '');
  if (!t) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (!/^https?:$/.test(url.protocol) || !/\.[a-z]{2,}$/i.test(url.hostname)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

const TYPE_FALLBACK: Record<string, string> = {
  higher_ed_university: 'University',
  higher_ed_college: 'College',
};

/**
 * Applies the rules above to one institution row (in place-safe copy).
 * Returns null when the row has no usable name. Only columns present in the
 * row are touched, so partial rows stay partial.
 */
export function standardizeInstitution(row: Row): Row | null {
  const out: Row = { ...row };
  const country = String(row.country_iso2 ?? '');

  if ('name' in out) {
    const name = cleanName(out.name as string | null);
    if (!name) return null;
    out.name = name;
  }
  if ('local_type' in out) {
    out.local_type = cleanCategory(out.local_type as string | null, TYPE_FALLBACK[String(out.school_type_code)] ?? null);
  }
  for (const col of ['city', 'district', 'address_line'] as const) {
    if (col in out && typeof out[col] === 'string') {
      const v = (out[col] as string).replace(/\s+/g, ' ').trim();
      out[col] = !v ? null : isShouting(v) ? titleCase(v.toLowerCase()) : v;
    }
  }
  if ('phone' in out) {
    const phone = cleanPhoneNumber(out.phone as string | null, country);
    out.phone = phone;
    if (!phone && 'phone_source' in out) out.phone_source = null;
  }
  if ('website' in out) out.website = cleanWebsite(out.website as string | null);
  if ('email' in out && typeof out.email === 'string') {
    const e = out.email.trim().toLowerCase();
    out.email = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) ? e : null;
  }
  return out;
}

/** Standardizes many rows, dropping unusable ones; reports how many were dropped. */
export function standardizeAll(rows: Row[]): { rows: Row[]; dropped: number } {
  const out: Row[] = [];
  let dropped = 0;
  for (const r of rows) {
    const s = standardizeInstitution(r);
    if (s) out.push(s);
    else dropped++;
  }
  return { rows: out, dropped };
}
