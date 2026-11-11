import { cleanPhoneNumber, standardizeInstitution } from '../cleanse';
import { candidateDomains, isSoftError, mentionsInstitution } from '../website-verify';
import type { Row, SyncContext, SyncSource } from '../types';
import { mapLimit } from './common';

// =============================================================================
// 1. Standardize existing records (no download): applies the same cleansing
//    rules every source now uses on write, to rows already in the database.
// =============================================================================

const STANDARD_COLUMNS = ['id', 'country_iso2', 'school_type_code', 'name', 'local_type', 'city', 'district', 'address_line', 'phone', 'phone_source', 'website', 'email'];

export const standardizeRecordsSource: SyncSource = {
  key: 'dq_standardize',
  label: 'Data quality: standardize existing records',
  description:
    'Cleans what is already loaded, without downloading anything: Title Case categories, tidy names (no stray punctuation, no ALL CAPS), phone numbers validated and written with the country code, website addresses checked for valid syntax.',

  async run(ctx: SyncContext) {
    const changed: Row[] = [];
    let unusableNames = 0;
    let scanned = 0;

    for (let from = 0; ; from += 1000) {
      const { data, error } = await ctx.db
        .schema('edu')
        .from('schools')
        .select(STANDARD_COLUMNS.join(','))
        .order('id')
        .range(from, from + 999);
      if (error) throw new Error(`edu.schools: read failed: ${error.message}`);
      const rows = (data ?? []) as unknown as Row[];
      scanned += rows.length;

      for (const row of rows) {
        const clean = standardizeInstitution(row);
        if (!clean) {
          unusableNames++; // nothing is deleted; reported for manual review
          continue;
        }
        const patch: Row = {};
        for (const col of STANDARD_COLUMNS) {
          if (col === 'id' || col === 'country_iso2' || col === 'school_type_code') continue;
          if ((clean[col] ?? null) !== (row[col] ?? null)) patch[col] = clean[col] ?? null;
        }
        if (Object.keys(patch).length) changed.push({ id: row.id, ...patch });
      }
      if (rows.length < 1000) break;
    }

    if (!ctx.dryRun) {
      let failed = 0;
      await mapLimit(changed, 8, async ({ id, ...patch }) => {
        const { error } = await ctx.db.schema('edu').from('schools').update(patch).eq('id', id as string);
        if (error) failed++;
      });
      if (failed) ctx.warn(`${failed} rows could not be updated (see server log).`);
    }
    ctx.count('edu.schools', 'updated', changed.length);
    ctx.count('edu.schools', 'unchanged', scanned - changed.length - unusableNames);
    if (unusableNames) ctx.warn(`${unusableNames} records have no usable name (e.g. only digits); left as they are for manual review.`);
  },
};

// =============================================================================
// 2. Check websites and find phone numbers.
//    Visits each website (never-checked first, then those checked > 30 days
//    ago) for a limited time per run, records whether it works, and the
//    address that worked. Public profiles only show checked, working links.
//    If the institution has no phone, its homepage's tel: links are read
//    (unless robots.txt disallows it) and a number valid for the country kept.
// =============================================================================

const USER_AGENT = 'SchoolSystemsDirectory-LinkCheck/1.0 (+https://school-systems-theta.vercel.app)';
const RECHECK_DAYS = 30;
const CONCURRENCY = 20;
const BATCH = 200;
const MAX_HTML_BYTES = 512 * 1024;

/** Seconds per run: the admin page is limited to ~5 minutes; the CLI can set more. */
const timeBudgetMs = () => Number(process.env.WEBSITE_CHECK_SECONDS ?? 240) * 1000;

type CheckResult = {
  status: 'ok' | 'restricted' | 'broken';
  http: number | null;
  workingUrl: string | null;
  html: string | null;
};

async function readLimited(res: Response): Promise<string | null> {
  if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? '') || !res.body) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

async function tryUrl(url: string): Promise<CheckResult> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const http = res.status;
  if (res.ok) return { status: 'ok', http, workingUrl: res.url || url, html: await readLimited(res) };
  await res.body?.cancel().catch(() => {});
  // The site exists but refuses automated visitors: a browser will usually work.
  if ([401, 403, 405, 406, 429, 999].includes(http)) return { status: 'restricted', http, workingUrl: res.url || url, html: null };
  return { status: 'broken', http, workingUrl: null, html: null };
}

/** https first; if the connection itself fails (bad certificate, no TLS), plain http. */
async function checkWebsite(url: string): Promise<CheckResult> {
  try {
    return await tryUrl(url);
  } catch {
    if (url.startsWith('https://')) {
      try {
        return await tryUrl(`http://${url.slice(8)}`);
      } catch {
        /* fall through */
      }
    }
    return { status: 'broken', http: null, workingUrl: null, html: null };
  }
}

/** robots.txt: is reading '/' disallowed for all robots or for us? (cached per origin) */
const robotsCache = new Map<string, Promise<boolean>>();
function robotsAllowsHomepage(origin: string): Promise<boolean> {
  let p = robotsCache.get(origin);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`${origin}/robots.txt`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(6_000),
          cache: 'no-store',
        });
        if (!res.ok) return true; // no robots.txt = allowed
        const lines = (await res.text()).split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim());
        let applies = false;
        for (const line of lines) {
          const [rawKey, ...rest] = line.split(':');
          const key = rawKey?.trim().toLowerCase();
          const value = rest.join(':').trim();
          if (key === 'user-agent') applies = value === '*' || /schoolsystemsdirectory/i.test(value);
          else if (applies && key === 'disallow' && value === '/') return false;
        }
        return true;
      } catch {
        return true; // unreachable robots.txt: treat as allowed
      }
    })();
    robotsCache.set(origin, p);
  }
  return p;
}

/** First tel: link on the page that is a valid number for the country. */
function phoneFromHtml(html: string, countryIso2: string): string | null {
  for (const m of html.matchAll(/href\s*=\s*["']\s*tel:([^"'<>]{5,40})["']/gi)) {
    const phone = cleanPhoneNumber(decodeURIComponent(m[1]).trim(), countryIso2);
    if (phone) return phone;
  }
  return null;
}

type CheckRow = { id: string; name: string; website: string | null; phone: string | null; country_iso2: string };

type Verdict = {
  status: 'ok' | 'restricted' | 'broken' | 'mismatch' | null;
  http: number | null;
  url: string | null;
  foundBy: 'source' | 'discovered' | null;
  html: string | null;
};

/** Checks the address the source gave: it must load AND be this institution's page. */
export async function verifySourceWebsite(row: CheckRow): Promise<Verdict> {
  const r = await checkWebsite(row.website!);
  if (r.status === 'restricted') return { status: 'restricted', http: r.http, url: r.workingUrl, foundBy: 'source', html: null };
  if (r.status === 'broken') return { status: 'broken', http: r.http, url: null, foundBy: null, html: null };
  if (r.html && isSoftError(r.html)) return { status: 'broken', http: r.http, url: null, foundBy: null, html: null };
  if (r.html && !mentionsInstitution(row.name, r.html, false)) return { status: 'mismatch', http: r.http, url: null, foundBy: null, html: null };
  return { status: 'ok', http: r.http, url: r.workingUrl, foundBy: 'source', html: r.html };
}

/** Tries the institution's acronym on its country's academic domains; strict name check. */
export async function discoverWebsite(row: CheckRow): Promise<Verdict | null> {
  const sourceHost = row.website ? new URL(row.website).hostname.replace(/^www./, '') : null;
  for (const candidate of candidateDomains(row.name, row.country_iso2)) {
    if (new URL(candidate).hostname === sourceHost) continue;
    let r: CheckResult;
    try {
      r = await tryUrl(candidate);
    } catch {
      continue; // no such domain / no connection
    }
    if (r.status === 'ok' && r.html && !isSoftError(r.html) && mentionsInstitution(row.name, r.html, true)) {
      return { status: 'ok', http: r.http, url: r.workingUrl, foundBy: 'discovered', html: r.html };
    }
  }
  return null;
}

export const websiteCheckSource: SyncSource = {
  key: 'dq_websites',
  label: 'Data quality: check websites & find phone numbers',
  description:
    'For up to 4 minutes per run (unchecked first, then older than 30 days): checks each website loads AND is really the institution (not an error, parking or unrelated page). If it is missing, broken or someone else\x27s, tries the institution\x27s acronym on official academic domains (e.g. acpce.ac.in) and keeps it only if the page names the institution. Reads a phone number from the homepage where missing (robots.txt respected).',

  async run(ctx: SyncContext) {
    const started = Date.now();
    const budget = timeBudgetMs();
    const staleBefore = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
    const tally = { checked: 0, ok: 0, restricted: 0, broken: 0, mismatch: 0, discovered: 0, none: 0, phones: 0 };

    while (Date.now() - started < budget) {
      const { data, error } = await ctx.db
        .schema('edu')
        .from('schools')
        .select('id, name, website, phone, country_iso2')
        .or(`website_checked_at.is.null,website_checked_at.lt.${staleBefore}`)
        .order('website_checked_at', { ascending: true, nullsFirst: true })
        .order('id')
        .limit(BATCH);
      if (error) throw new Error(`edu.schools: read failed: ${error.message}`);
      const rows = (data ?? []) as CheckRow[];
      if (rows.length === 0) break;

      await mapLimit(rows, CONCURRENCY, async (row) => {
        if (Date.now() - started > budget + 30_000) return; // hard stop for slow stragglers
        tally.checked++;

        let v: Verdict = row.website
          ? await verifySourceWebsite(row)
          : { status: null, http: null, url: null, foundBy: null, html: null };
        if (v.status !== 'ok' && v.status !== 'restricted') {
          const found = await discoverWebsite(row);
          if (found) {
            v = found;
            tally.discovered++;
          }
        }
        if (v.status) tally[v.status]++;
        else tally.none++;

        const patch: Row = {
          website_status: v.status,
          website_http_status: v.http,
          website_checked_at: new Date().toISOString(),
          website_checked_url: v.url,
          website_found_by: v.foundBy,
        };
        if (!row.phone && v.status === 'ok' && v.html && v.url) {
          if (await robotsAllowsHomepage(new URL(v.url).origin)) {
            const phone = phoneFromHtml(v.html, row.country_iso2);
            if (phone) {
              patch.phone = phone;
              patch.phone_source = 'website';
              tally.phones++;
            }
          }
        }
        if (!ctx.dryRun) {
          const { error: upErr } = await ctx.db.schema('edu').from('schools').update(patch).eq('id', row.id);
          if (upErr) ctx.warn(`Could not save check for ${row.name}: ${upErr.message}`);
        }
        ctx.count('edu.schools', 'updated');
      });

      if (ctx.dryRun) break; // nothing was saved, so the same rows would come back
    }

    const { count: remaining } = await ctx.db
      .schema('edu')
      .from('schools')
      .select('id', { count: 'exact', head: true })
      .or(`website_checked_at.is.null,website_checked_at.lt.${staleBefore}`);

    ctx.warn(
      `Checked ${tally.checked} institutions in ${Math.round((Date.now() - started) / 1000)}s: ${tally.ok} working website (${tally.discovered} newly found on an official domain), ` +
        `${tally.restricted} reachable but blocking robots (shown), ${tally.broken} broken and ${tally.mismatch} not the institution\x27s site (hidden), ` +
        `${tally.none} without any website. ${tally.phones} phone numbers found on homepages.`,
    );
    if (remaining) ctx.warn(`${remaining.toLocaleString('en')} institutions still to check: run this source again.`);
  },
};
