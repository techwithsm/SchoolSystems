import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { entityKey, stableId } from '../ids';
import { syncRows } from '../upsert';
import {
  pruneCitations,
  upsertCitations,
  upsertSources,
  type CitableTable,
  type CitationInput,
} from '../citations';
import { countryFileSchema, type CountryFile } from './country-file-schema';
import type { Row, SyncContext, SyncSource } from '../types';

/** Folder holding the researched country files (one <ISO2>.json per country). */
export const COUNTRY_FILES_DIR = path.join(process.cwd(), 'data', 'countries');

/** Removes undefined values so only columns present in the file are written. */
function defined(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
}

async function syncCountryFile(ctx: SyncContext, file: CountryFile): Promise<void> {
  const iso = file.country_iso2;
  const sourceKeys = new Set(Object.keys(file.sources));
  const srcId = (k: string) => stableId(`${iso}/src/${k}`);
  const bodyId = (k: string) => stableId(entityKey(iso, 'body', k));
  const gradingId = (k: string) => stableId(entityKey(iso, 'grading', k));

  // ---- Validate cross-references before writing anything ------------------
  const problems: string[] = [];
  const checkSources = (where: string, keys?: string[]) =>
    keys?.forEach((k) => !sourceKeys.has(k) && problems.push(`${where}: unknown source '${k}'`));
  const checkFieldSources = (where: string, fs?: Record<string, string[]>) =>
    Object.entries(fs ?? {}).forEach(([f, keys]) => checkSources(`${where}.${f}`, keys));
  const bodyKeys = new Set(file.education_bodies.map((b) => b.key));
  const gradingKeys = new Set(file.grading_systems.map((g) => g.key));

  file.education_bodies.forEach((b) => checkSources(`body ${b.key}`, b.sources));
  file.grading_systems.forEach((g) => checkSources(`grading ${g.key}`, g.sources));
  file.education_stages.forEach((s) => {
    checkSources(`stage ${s.key}`, s.sources);
    checkFieldSources(`stage ${s.key}`, s.field_sources);
  });
  file.country_curricula.forEach((c) => checkSources(`curriculum ${c.curriculum_code}`, c.sources));
  file.school_types.forEach((t) => {
    checkSources(`school type ${t.key}`, t.sources);
    checkFieldSources(`school type ${t.key}`, t.field_sources);
    if (t.governing_body && !bodyKeys.has(t.governing_body)) problems.push(`school type ${t.key}: unknown body '${t.governing_body}'`);
  });
  file.qualifications.forEach((q) => {
    checkSources(`qualification ${q.key}`, q.sources);
    if (q.awarding_body && !bodyKeys.has(q.awarding_body)) problems.push(`qualification ${q.key}: unknown body '${q.awarding_body}'`);
  });
  if (file.profile) {
    checkFieldSources('profile', file.profile.field_sources);
    if (file.profile.ministry && !bodyKeys.has(file.profile.ministry)) problems.push(`profile: unknown ministry '${file.profile.ministry}'`);
    if (file.profile.grading_system && !gradingKeys.has(file.profile.grading_system))
      problems.push(`profile: unknown grading system '${file.profile.grading_system}'`);
  }
  if (problems.length) throw new Error(`${iso}.json has broken references:\n  ${problems.join('\n  ')}`);

  // ---- Citations are collected while writing, then saved at the end -------
  const citations: CitationInput[] = [];
  const cite = (table: CitableTable, readable: string, entityId: string, keys?: string[], field: string | null = null) =>
    keys?.forEach((k) =>
      citations.push({
        key: [table, readable, field, k].filter((x) => x !== null).join('|'),
        entity_table: table,
        entity_id: entityId,
        field_name: field,
        source_id: srcId(k),
      }),
    );
  const citeFields = (table: CitableTable, readable: string, entityId: string, fs?: Record<string, string[]>) =>
    Object.entries(fs ?? {}).forEach(([f, keys]) => cite(table, readable, entityId, keys, f));

  // 1. Core reference data
  await syncRows(ctx, { schema: 'core', table: 'languages', keyColumns: ['code'], rows: file.languages.map(defined) });
  await syncRows(ctx, {
    schema: 'core',
    table: 'country_languages',
    keyColumns: ['country_iso2', 'language_code', 'role'],
    rows: file.country_languages.map((l) => ({ country_iso2: iso, ...l })),
  });

  // 2. Sources
  await upsertSources(
    ctx,
    Object.entries(file.sources).map(([k, s]) => ({
      id: srcId(k),
      title: s.title,
      url: s.url,
      publisher: s.publisher ?? null,
      source_type_code: s.source_type,
      country_iso2: s.country_iso2 === undefined ? iso : s.country_iso2,
      published_on: s.published_on ?? null,
      accessed_on: file.accessed_on,
      notes: s.notes ?? null,
      ...(s.license !== undefined ? { license_code: s.license } : {}),
    })),
  );

  // 3. Education bodies and grading systems (referenced by later tables)
  await syncRows(ctx, {
    schema: 'edu',
    table: 'education_bodies',
    keyColumns: ['id'],
    tracksVerification: true,
    rows: file.education_bodies.map(({ key, sources, ...b }) => {
      const readable = entityKey(iso, 'body', key);
      cite('edu.education_bodies', readable, stableId(readable), sources);
      return defined({ id: stableId(readable), ...b, country_iso2: b.level === 'international' ? null : iso });
    }),
  });
  await syncRows(ctx, {
    schema: 'edu',
    table: 'grading_systems',
    keyColumns: ['id'],
    tracksVerification: true,
    rows: file.grading_systems.map(({ key, sources, ...g }) => {
      const readable = entityKey(iso, 'grading', key);
      cite('edu.grading_systems', readable, stableId(readable), sources);
      return defined({ id: stableId(readable), country_iso2: iso, ...g });
    }),
  });

  // 4. Curriculum definitions
  await syncRows(ctx, {
    schema: 'edu',
    table: 'curricula',
    keyColumns: ['code'],
    rows: file.curricula.map((c) =>
      defined({ ...c, country_iso2: c.curriculum_type === 'national' ? iso : null }),
    ),
  });

  // 5. Country profile (only the columns present in the file are written)
  if (file.profile) {
    const { field_sources, grading_system, ministry, ...p } = file.profile;
    await syncRows(ctx, {
      schema: 'edu',
      table: 'country_profiles',
      keyColumns: ['country_iso2'],
      tracksVerification: true,
      rows: [
        defined({
          country_iso2: iso,
          ...p,
          grading_system_id: grading_system === undefined ? undefined : grading_system ? gradingId(grading_system) : null,
          ministry_id: ministry === undefined ? undefined : ministry ? bodyId(ministry) : null,
        }),
      ],
    });
    citeFields('edu.country_profiles', iso, iso, field_sources);
  }

  // 6. Languages of instruction
  await syncRows(ctx, {
    schema: 'edu',
    table: 'instruction_languages',
    keyColumns: ['country_iso2', 'language_code'],
    rows: file.instruction_languages.map((l) => defined({ country_iso2: iso, ...l })),
  });

  // 7. Education stages
  await syncRows(ctx, {
    schema: 'edu',
    table: 'education_stages',
    keyColumns: ['id'],
    tracksVerification: true,
    rows: file.education_stages.map(({ key, sources, field_sources, ...s }) => {
      const readable = entityKey(iso, 'stage', key);
      const id = stableId(readable);
      cite('edu.education_stages', readable, id, sources);
      citeFields('edu.education_stages', readable, id, field_sources);
      return defined({ id, country_iso2: iso, ...s });
    }),
  });

  // 8. Curricula offered in the country
  await syncRows(ctx, {
    schema: 'edu',
    table: 'country_curricula',
    keyColumns: ['country_iso2', 'curriculum_code'],
    rows: file.country_curricula.map(({ sources, ...c }) => {
      const readable = `${iso}:${c.curriculum_code}`;
      cite('edu.country_curricula', readable, readable, sources);
      return defined({ country_iso2: iso, ...c });
    }),
  });

  // 9. School types (+ the curricula each type uses)
  const typeCurricula: Row[] = [];
  await syncRows(ctx, {
    schema: 'edu',
    table: 'country_school_types',
    keyColumns: ['id'],
    tracksVerification: true,
    rows: file.school_types.map(({ key, sources, field_sources, curricula, governing_body, ...t }) => {
      const readable = entityKey(iso, 'cst', key);
      const id = stableId(readable);
      cite('edu.country_school_types', readable, id, sources);
      citeFields('edu.country_school_types', readable, id, field_sources);
      curricula.forEach((code) => typeCurricula.push({ country_school_type_id: id, curriculum_code: code }));
      return defined({
        id,
        country_iso2: iso,
        ...t,
        governing_body_id: governing_body === undefined ? undefined : governing_body ? bodyId(governing_body) : null,
      });
    }),
  });
  await syncRows(ctx, {
    schema: 'edu',
    table: 'country_school_type_curricula',
    keyColumns: ['country_school_type_id', 'curriculum_code'],
    rows: typeCurricula,
  });

  // 10. Qualifications
  await syncRows(ctx, {
    schema: 'edu',
    table: 'qualifications',
    keyColumns: ['id'],
    tracksVerification: true,
    rows: file.qualifications.map(({ key, sources, international, awarding_body, ...q }) => {
      const readable = entityKey(iso, 'qual', key);
      const id = stableId(readable);
      cite('edu.qualifications', readable, id, sources);
      return defined({
        id,
        country_iso2: international ? null : iso,
        ...q,
        awarding_body_id: awarding_body === undefined ? undefined : awarding_body ? bodyId(awarding_body) : null,
      });
    }),
  });

  // 11. Citations: save the wanted ones, drop ones this file no longer makes.
  await upsertCitations(ctx, citations);
  await pruneCitations(ctx, [...sourceKeys].map(srcId), citations.map((c) => c.key));
}

export const countryFilesSource: SyncSource = {
  key: 'country_files',
  label: 'Country data files',
  description: 'Researched country data in web/data/countries/*.json: profile, stages, school types, curricula, bodies, grading, qualifications, citations.',

  async run(ctx) {
    let names: string[];
    try {
      names = (await readdir(COUNTRY_FILES_DIR)).filter((n) => /^[A-Z]{2}(_.*)?\.json$/.test(n)).sort();
    } catch {
      ctx.warn(`Folder not found: ${COUNTRY_FILES_DIR}`);
      return;
    }
    if (names.length === 0) ctx.warn('No country files found.');

    const failures: string[] = [];
    for (const name of names) {
      try {
        const raw = JSON.parse(await readFile(path.join(COUNTRY_FILES_DIR, name), 'utf8'));
        const parsed = countryFileSchema.safeParse(raw);
        if (!parsed.success) {
          const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
          throw new Error(`invalid format:\n  ${issues.join('\n  ')}`);
        }
        await syncCountryFile(ctx, parsed.data);
      } catch (err) {
        // One bad file must not block the other countries.
        failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failures.length) throw new Error(failures.join('\n'));
  },
};
