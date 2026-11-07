import { chunk, fetchJson } from '../http';
import { stableId } from '../ids';
import { applyProfileFacts, listCountries, type ProfileFact, type ProfileFactField } from '../profile-facts';
import type { SourceInput } from '../citations';
import type { SyncSource } from '../types';

/**
 * UNESCO Institute for Statistics Data API (https://api.uis.unesco.org). Free,
 * no key. Indicator codes come from /api/public/definitions/indicators.
 * Takes the most recent year per country from the last 10 years.
 */
const INDICATORS: { code: string; field: ProfileFactField; title: string }[] = [
  { code: '400', field: 'compulsory_years', title: 'Duration of compulsory education (years)' },
  { code: '401', field: 'compulsory_start_age', title: 'Official entrance age to compulsory education (years)' },
];

interface UisRecord {
  indicatorId: string;
  geoUnit: string;
  year: number;
  value: number | null;
}

export const unescoUisSource: SyncSource = {
  key: 'unesco_uis',
  label: 'UNESCO UIS',
  description: 'Duration of compulsory education and official entrance age to compulsory education for every country.',

  async run(ctx) {
    const countries = await listCountries(ctx);
    const iso2ByIso3 = new Map(countries.map((c) => [c.iso3, c.iso2]));
    const startYear = new Date().getUTCFullYear() - 10;

    // Latest record per (indicator, country).
    const latest = new Map<string, UisRecord>();
    for (const part of chunk(countries, 50)) {
      const params = new URLSearchParams({ start: String(startYear) });
      for (const ind of INDICATORS) params.append('indicator', ind.code);
      for (const c of part) params.append('geoUnit', c.iso3);
      const body = await fetchJson<{ records?: UisRecord[] }>(
        `https://api.uis.unesco.org/api/public/data/indicators?${params}`,
        { timeoutMs: 60_000 },
      );
      for (const r of body.records ?? []) {
        if (r.value === null || r.value === undefined) continue;
        const k = `${r.indicatorId}|${r.geoUnit}`;
        const prev = latest.get(k);
        if (!prev || r.year > prev.year) latest.set(k, r);
      }
    }

    const sources: SourceInput[] = [];
    const facts: ProfileFact[] = [];
    for (const ind of INDICATORS) {
      const sourceKey = `uis_${ind.code}`;
      const sourceId = stableId(`API/src/${sourceKey}`);
      sources.push({
        id: sourceId,
        title: `${ind.title} (UIS indicator ${ind.code})`,
        url: `https://api.uis.unesco.org/api/public/data/indicators?indicator=${ind.code}`,
        publisher: 'UNESCO Institute for Statistics',
        source_type_code: 'unesco',
        country_iso2: null,
        accessed_on: ctx.today,
        notes: 'Synced automatically from the UIS Data API (most recent year in the last 10 years).',
      });

      let found = 0;
      for (const c of countries) {
        const r = latest.get(`${ind.code}|${c.iso3}`);
        if (!r) continue;
        found++;
        facts.push({
          countryIso2: iso2ByIso3.get(c.iso3)!,
          field: ind.field,
          value: r.value!,
          year: r.year,
          sourceId,
          sourceKey,
          note: `UIS value for ${r.year}`,
        });
      }
      if (found < countries.length) ctx.warn(`UIS ${ind.code}: no value for ${countries.length - found} of ${countries.length} countries`);
    }

    await applyProfileFacts(ctx, sources, facts);
  },
};
