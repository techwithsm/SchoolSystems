import { countryFilesSource } from './sources/country-files';
import { indiaAisheSource } from './sources/india-aishe';
import { indiaWikidataSource } from './sources/india-wikidata';
import { localCsvSource } from './sources/local-csv';
import { unescoUisSource } from './sources/unesco-uis';
import { worldBankSource } from './sources/world-bank';
import type { SyncSource } from './types';

/**
 * Every source the "Sync data" button can run, in run order.
 * Curated files run first so the API sources can see (and respect) their
 * citations. To add a source, implement SyncSource and append it here.
 */
export const SYNC_SOURCES: SyncSource[] = [
  countryFilesSource,
  localCsvSource,
  worldBankSource,
  unescoUisSource,
  indiaWikidataSource,
  indiaAisheSource, // official file last: its values win
];

export function getSources(keys?: string[]): SyncSource[] {
  if (!keys || keys.length === 0) return SYNC_SOURCES;
  const unknown = keys.filter((k) => !SYNC_SOURCES.some((s) => s.key === k));
  if (unknown.length) throw new Error(`Unknown sync source(s): ${unknown.join(', ')}`);
  return SYNC_SOURCES.filter((s) => keys.includes(s.key));
}

/** Plain data for the UI (no functions). */
export function listSourceInfo() {
  return SYNC_SOURCES.map(({ key, label, description }) => ({ key, label, description }));
}
