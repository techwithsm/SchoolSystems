import { chunk } from './http';
import { stableId } from './ids';
import { syncRows } from './upsert';
import type { SyncContext } from './types';

/** Tables allowed by the CHECK constraint on core.record_sources.entity_table. */
export type CitableTable =
  | 'edu.country_profiles'
  | 'edu.education_stages'
  | 'edu.country_school_types'
  | 'edu.country_curricula'
  | 'edu.education_bodies'
  | 'edu.qualifications'
  | 'edu.grading_systems'
  | 'edu.schools';

export interface SourceInput {
  id: string;
  title: string;
  url: string | null;
  publisher: string | null;
  source_type_code: string;
  country_iso2: string | null;
  published_on?: string | null;
  accessed_on: string;
  notes?: string | null;
  license_code?: string | null;
}

export interface CitationInput {
  /**
   * Readable key the citation id is derived from. Keep it stable: changing it
   * creates a new row. Convention: 'table|entity|field|source' (field omitted
   * when citing the whole row), matching md5(concat_ws('|', ...)) in SQL.
   */
  key: string;
  entity_table: CitableTable;
  /** PK of the cited row as text (uuid, iso2, or 'FI:ib_dp' for composite keys). */
  entity_id: string;
  field_name: string | null;
  source_id: string;
  note?: string | null;
}

/** Inserts/updates rows in core.sources. */
export async function upsertSources(ctx: SyncContext, sources: SourceInput[]): Promise<void> {
  await syncRows(ctx, {
    schema: 'core',
    table: 'sources',
    keyColumns: ['id'],
    rows: sources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      publisher: s.publisher,
      source_type_code: s.source_type_code,
      country_iso2: s.country_iso2,
      published_on: s.published_on ?? null,
      accessed_on: s.accessed_on,
      notes: s.notes ?? null,
      ...(s.license_code !== undefined ? { license_code: s.license_code } : {}),
    })),
  });
}

/** Inserts/updates rows in core.record_sources (id derived from `key`). */
export async function upsertCitations(ctx: SyncContext, citations: CitationInput[]): Promise<void> {
  await syncRows(ctx, {
    schema: 'core',
    table: 'record_sources',
    keyColumns: ['id'],
    rows: citations.map((c) => ({
      id: stableId(c.key),
      entity_table: c.entity_table,
      entity_id: c.entity_id,
      field_name: c.field_name,
      source_id: c.source_id,
      note: c.note ?? null,
    })),
  });
}

/**
 * Deletes citations that point at `sourceIds` but are no longer wanted
 * (e.g. a source was removed from an entity in a country file).
 * Citations from other sources are never touched.
 */
export async function pruneCitations(
  ctx: SyncContext,
  sourceIds: string[],
  keepCitationKeys: string[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  const keep = new Set(keepCitationKeys.map(stableId));
  const stale: string[] = [];

  for (const part of chunk(sourceIds, 200)) {
    const { data, error } = await ctx.db.schema('core').from('record_sources').select('id').in('source_id', part);
    if (error) throw new Error(`core.record_sources: read failed: ${error.message}`);
    for (const r of data ?? []) if (!keep.has(r.id)) stale.push(r.id);
  }
  for (const part of chunk(ctx.dryRun ? [] : stale, 200)) {
    const { error } = await ctx.db.schema('core').from('record_sources').delete().in('id', part);
    if (error) throw new Error(`core.record_sources: delete failed: ${error.message}`);
  }
  if (stale.length) ctx.count('core.record_sources', 'deleted', stale.length);
}
