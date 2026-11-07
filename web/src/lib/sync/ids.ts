import { createHash } from 'node:crypto';

/**
 * Deterministic UUID from a readable key, identical to Postgres
 * `md5('<key>')::uuid`. The same key always gives the same id, so re-running
 * a sync updates rows instead of duplicating them.
 *
 *   stableId('FI/stage/basic') === md5('FI/stage/basic')::uuid
 */
export function stableId(key: string): string {
  const h = createHash('md5').update(key, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Builds the full key for an entity in a country file. Keys that already
 * contain '/' are global (e.g. 'INT/body/ibo') and used as-is.
 *
 *   entityKey('FI', 'stage', 'basic')        -> 'FI/stage/basic'
 *   entityKey('FI', 'body', 'INT/body/ibo')  -> 'INT/body/ibo'
 */
export function entityKey(countryIso2: string, kind: string, key: string): string {
  return key.includes('/') ? key : `${countryIso2}/${kind}/${key}`;
}
