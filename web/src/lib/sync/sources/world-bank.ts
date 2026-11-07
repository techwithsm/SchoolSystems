import { fetchJson } from '../http';
import { stableId } from '../ids';
import { applyProfileFacts, listCountries, type ProfileFact, type ProfileFactField } from '../profile-facts';
import type { SourceInput } from '../citations';
import type { SyncSource } from '../types';

/**
 * World Bank Indicators API (https://api.worldbank.org/v2). Free, no key.
 * Pulls the most recent non-empty value per country for each indicator.
 */
const INDICATORS: { code: string; field: ProfileFactField; title: string }[] = [
  { code: 'SE.XPD.TOTL.GD.ZS', field: 'public_spending_pct_gdp', title: 'Government expenditure on education, total (% of GDP)' },
  { code: 'SE.ADT.LITR.ZS', field: 'literacy_rate_pct', title: 'Literacy rate, adult total (% of people ages 15 and above)' },
  { code: 'SE.PRM.PRIV.ZS', field: 'private_enrollment_pct', title: 'School enrollment, primary, private (% of total primary)' },
];

interface WbRow {
  countryiso3code: string;
  date: string;
  value: number | null;
}

export const worldBankSource: SyncSource = {
  key: 'world_bank',
  label: 'World Bank indicators',
  description: 'Education spending (% of GDP), adult literacy rate and private primary enrolment share for every country, with year.',

  async run(ctx) {
    const countries = await listCountries(ctx);
    const iso2ByIso3 = new Map(countries.map((c) => [c.iso3, c.iso2]));
    const iso3List = countries.map((c) => c.iso3).join(';');

    const sources: SourceInput[] = [];
    const facts: ProfileFact[] = [];

    for (const ind of INDICATORS) {
      const sourceKey = `wb_${ind.code}`;
      const sourceId = stableId(`API/src/${sourceKey}`);
      sources.push({
        id: sourceId,
        title: ind.title,
        url: `https://data.worldbank.org/indicator/${ind.code}`,
        publisher: 'World Bank',
        source_type_code: 'world_bank',
        country_iso2: null,
        accessed_on: ctx.today,
        notes: 'Synced automatically from the World Bank Indicators API (most recent non-empty value).',
      });

      const url = `https://api.worldbank.org/v2/country/${iso3List}/indicator/${ind.code}?format=json&mrnev=1&per_page=1000`;
      const body = await fetchJson<[unknown, WbRow[] | null]>(url);
      const rows = Array.isArray(body) ? (body[1] ?? []) : [];
      if (!Array.isArray(body)) ctx.warn(`${ind.code}: unexpected response shape`);

      for (const r of rows) {
        const iso2 = iso2ByIso3.get(r.countryiso3code);
        if (!iso2 || r.value === null || r.value === undefined) continue;
        facts.push({
          countryIso2: iso2,
          field: ind.field,
          value: Math.round(r.value * 100) / 100,
          year: Number(r.date) || null,
          sourceId,
          sourceKey,
        });
      }
      const missing = countries.length - rows.filter((r) => r.value !== null).length;
      if (missing > 0) ctx.warn(`${ind.code}: no value for ${missing} of ${countries.length} countries`);
    }

    await applyProfileFacts(ctx, sources, facts);
  },
};
