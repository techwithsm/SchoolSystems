import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from '../csv';
import { stableId } from '../ids';
import {
  applyProfileFacts,
  isProfileFactField,
  listCountries,
  PROFILE_FACT_FIELDS,
  type ProfileFact,
} from '../profile-facts';
import type { SourceInput } from '../citations';
import type { SyncSource } from '../types';

/** Folder for any other local statistics, as CSV files (format in data/README.md). */
export const STATS_DIR = path.join(process.cwd(), 'data', 'stats');

const REQUIRED = ['country_iso2', 'field', 'value', 'source_key', 'source_title', 'source_type'] as const;

export const localCsvSource: SyncSource = {
  key: 'local_csv',
  label: 'Local CSV statistics',
  description: `Any other local figures in web/data/stats/*.csv (one fact per row, with its source). Fields: ${Object.keys(PROFILE_FACT_FIELDS).join(', ')}.`,

  async run(ctx) {
    let names: string[];
    try {
      names = (await readdir(STATS_DIR)).filter((n) => n.toLowerCase().endsWith('.csv')).sort();
    } catch {
      ctx.warn(`Folder not found: ${STATS_DIR}`);
      return;
    }
    if (names.length === 0) {
      ctx.warn('No CSV files in data/stats (nothing to do).');
      return;
    }

    const known = new Set((await listCountries(ctx)).map((c) => c.iso2));
    const sources = new Map<string, SourceInput>();
    const facts: ProfileFact[] = [];

    for (const name of names) {
      const rows = parseCsv(await readFile(path.join(STATS_DIR, name), 'utf8'));
      const header = rows[0] ? Object.keys(rows[0]) : [];
      const missingCols = REQUIRED.filter((c) => !header.includes(c));
      if (rows.length && missingCols.length) {
        ctx.warn(`${name}: missing columns ${missingCols.join(', ')}; file skipped`);
        continue;
      }

      rows.forEach((r, i) => {
        const where = `${name} line ${i + 2}`;
        const iso2 = r.country_iso2.toUpperCase();
        const value = Number(r.value);
        const year = r.year ? Number(r.year) : null;

        if (!known.has(iso2)) return ctx.warn(`${where}: unknown country '${r.country_iso2}'`);
        if (!isProfileFactField(r.field)) return ctx.warn(`${where}: field '${r.field}' is not supported`);
        if (r.value === '' || Number.isNaN(value)) return ctx.warn(`${where}: value '${r.value}' is not a number`);
        if (year !== null && !Number.isInteger(year)) return ctx.warn(`${where}: year '${r.year}' is not a whole number`);
        if (PROFILE_FACT_FIELDS[r.field] && year === null) return ctx.warn(`${where}: '${r.field}' needs a year`);

        const sourceKey = `csv_${r.source_key}`;
        const sourceId = stableId(`CSV/src/${r.source_key}`);
        if (!sources.has(sourceId)) {
          sources.set(sourceId, {
            id: sourceId,
            title: r.source_title,
            url: r.source_url || null,
            publisher: r.source_publisher || null,
            source_type_code: r.source_type,
            country_iso2: null,
            accessed_on: r.accessed_on || ctx.today,
            notes: `Loaded from data/stats/${name}`,
          });
        }
        facts.push({ countryIso2: iso2, field: r.field, value, year, sourceId, sourceKey, note: r.note || undefined });
      });
    }

    await applyProfileFacts(ctx, [...sources.values()], facts);
  },
};
