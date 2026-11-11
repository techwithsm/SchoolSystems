/**
 * Is this web page really the institution's website?
 *   - softError: an error/parking page served with HTTP 200
 *     (e.g. www.acpce.org returns 200 with "403 Forbidden").
 *   - mentionsInstitution: the page names the institution (a distinctive word
 *     of its name, or its acronym).
 *   - candidateDomains: official academic domains to try when the stored
 *     address is missing, broken or someone else's: the acronym of the name on
 *     the country's academic TLDs (A C Patil College of Engineering -> acpce.ac.in).
 */

const SOFT_ERROR =
  /\b(40[0134] ?(forbidden|not found|unauthori[sz]ed)|page not found|not found|account (has been )?suspended|suspended (page|account)|this domain (is|may be) for sale|domain (is )?(for sale|parked|expired)|buy this domain|parked (free|domain)|sedo|hugedomains|dan\.com|default web ?site page|it works!|welcome to nginx|apache2? (ubuntu |debian )?default page|test page for the apache|index of \/|coming soon|under construction|website (is )?(under maintenance|expired)|cpanel|plesk|iis windows server|bad gateway|service unavailable|error establishing a database connection)\b/i;

function textOf(html: string): { title: string; head: string; body: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const metas = [...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:og:site_name|og:title|description|og:description|application-name)["'][^>]*>/gi)]
    .map((m) => m[0].match(/content=["']([^"']*)["']/i)?.[1] ?? '')
    .join(' ');
  const h1 = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].slice(0, 6).map((m) => m[1]).join(' ');
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const clean = (s: string) =>
    decodeEntities(s)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return { title: clean(title), head: clean(`${title} ${metas} ${h1}`), body: clean(body).slice(0, 60_000) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** An error, parking or default server page served with a success code. */
export function isSoftError(html: string): boolean {
  const { title, body } = textOf(html);
  if (SOFT_ERROR.test(title)) return true;
  // Tiny pages that are mostly an error message.
  return body.length < 600 && SOFT_ERROR.test(body);
}

/** Words that appear in many institution names, so they prove nothing. */
const GENERIC = new Set(
  (
    'a an and the of for in at to on by with ' +
    'college colleges university universities institute institution institutions school schools academy campus centre center ' +
    'technology technological technical engineering science sciences arts art commerce management education educational research studies ' +
    'government govt gov public private national state central regional international autonomous deemed ' +
    'degree polytechnic mahavidyalaya mahavidhyalaya vidyalaya vishwavidyalaya vidyapeeth society trust foundation memorial ' +
    'medical medicine nursing pharmacy law dental health hospital women womens girls boys junior senior higher secondary ' +
    'instituto universidad escuela colegio de la del los las y tecnologico tecnologica tecnológico tecnológica superior nacional ' +
    'autonoma autónoma estudios normal centro unidad campus politecnica politécnica'
  ).split(/\s+/),
);

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/** Distinctive words of a name: 'A C Patil College of Engineering' -> ['patil']. */
export function distinctiveWords(name: string): string[] {
  return [...new Set(fold(name).split(/[^a-z0-9]+/))].filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
}

/** Initials of the name's words, skipping 'of/and/the/de...': 'A C Patil College of Engineering' -> 'acpce'. */
export function acronym(name: string): string {
  const skip = new Set(['of', 'and', 'the', 'for', 'in', 'at', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en']);
  return fold(name)
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !skip.has(w) && !/^\d+$/.test(w))
    .map((w) => w[0])
    .join('');
}

/**
 * Does the page name this institution?
 *   strict=false (checking the address a source gave): one distinctive word,
 *     or the acronym, anywhere on the page.
 *   strict=true (a guessed domain): at least two distinctive words (or all of
 *     them, if the name has fewer), or one word plus the acronym.
 * Names without distinctive words cannot be judged: accepted when not strict.
 */
export function mentionsInstitution(name: string, html: string, strict: boolean): boolean {
  const words = distinctiveWords(name);
  const { head, body } = textOf(html);
  const text = fold(`${head} ${body}`);
  const has = (w: string) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(text);
  const found = words.filter(has).length;
  const acr = acronym(name);
  const acrFound = acr.length >= 3 && new RegExp(`(^|[^a-z0-9])${acr}([^a-z0-9]|$)`).test(text);

  if (!strict) return words.length === 0 || found >= 1 || acrFound;
  if (words.length === 0) return false; // guessed domain and nothing to verify with: refuse
  return found >= Math.min(2, words.length) || (found >= 1 && acrFound);
}

/** Official / common academic domain endings per country, most likely first. */
const ACADEMIC_TLDS: Record<string, string[]> = {
  IN: ['.ac.in', '.edu.in', '.org', '.in', '.org.in', '.com'],
  US: ['.edu'],
  CA: ['.ca'],
  MX: ['.edu.mx', '.mx'],
  NG: ['.edu.ng'],
  EG: ['.edu.eg'],
  FI: ['.fi'],
};

/** Candidate homepages for an institution (empty if the acronym is too short/long to be safe). */
export function candidateDomains(name: string, countryIso2: string): string[] {
  const acr = acronym(name);
  const tlds = ACADEMIC_TLDS[countryIso2];
  if (!tlds || acr.length < 4 || acr.length > 10) return [];
  return tlds.map((tld) => `https://${acr}${tld}/`);
}
