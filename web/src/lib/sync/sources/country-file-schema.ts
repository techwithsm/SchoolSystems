import { z } from 'zod';

/**
 * Shape of a researched country file: web/data/countries/<ISO2>.json.
 * Keys ("key") without '/' are local and become '<ISO2>/<kind>/<key>';
 * keys with '/' (e.g. 'INT/body/ibo') are global and shared across countries.
 * "sources" lists source keys citing the whole row; "field_sources" cites
 * individual columns.
 */
const str = z.string().min(1);
const optStr = z.string().nullable().optional();
const optNum = z.number().nullable().optional();
const optInt = z.number().int().nullable().optional();
const sourceKeys = z.array(str).optional();
const fieldSources = z.record(z.string(), z.array(str)).optional();
const isced = z.string().regex(/^[0-8]$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const countryFileSchema = z.object({
  country_iso2: z.string().regex(/^[A-Z]{2}$/),
  accessed_on: date,

  languages: z.array(z.object({ code: z.string().regex(/^[a-z]{2,3}$/), name: str, native_name: optStr })).default([]),
  country_languages: z
    .array(z.object({ language_code: str, role: z.enum(['official', 'regional_official', 'national', 'widely_used']) }))
    .default([]),

  sources: z.record(
    z.string(),
    z.object({
      title: str,
      url: z.string().url().nullable(),
      publisher: optStr,
      source_type: str,
      country_iso2: z.string().length(2).nullable().optional(),
      published_on: date.nullable().optional(),
      license: optStr,
      notes: optStr,
    }),
  ),

  education_bodies: z
    .array(
      z.object({
        key: str,
        code: optStr,
        name: str,
        local_name: optStr,
        body_type: str,
        level: z.enum(['international', 'national', 'subnational', 'local']),
        url: optStr,
        sources: sourceKeys,
      }),
    )
    .default([]),

  grading_systems: z
    .array(
      z.object({
        key: str,
        name: str,
        scale_description: optStr,
        best_grade: optStr,
        lowest_pass_grade: optStr,
        sources: sourceKeys,
      }),
    )
    .default([]),

  curricula: z
    .array(
      z.object({
        code: str,
        name: str,
        provider: optStr,
        curriculum_type: z.enum(['national', 'international', 'foreign_national']),
        parent_code: optStr,
        url: optStr,
        sort_order: optInt,
      }),
    )
    .default([]),

  profile: z
    .object({
      overview: optStr,
      is_decentralised: z.boolean().nullable().optional(),
      compulsory_start_age: optInt,
      compulsory_end_age: optInt,
      compulsory_years: optInt,
      compulsory_notes: optStr,
      academic_year_start_month: optInt,
      academic_year_end_month: optInt,
      term_structure_code: optStr,
      grading_system: optStr,
      ministry: optStr,
      private_enrollment_pct: optNum,
      private_enrollment_year: optInt,
      public_spending_pct_gdp: optNum,
      public_spending_year: optInt,
      literacy_rate_pct: optNum,
      literacy_rate_year: optInt,
      field_sources: fieldSources,
    })
    .optional(),

  instruction_languages: z
    .array(
      z.object({
        language_code: str,
        scope: z.enum(['main', 'regional', 'minority', 'bilingual_programmes']),
        notes: optStr,
      }),
    )
    .default([]),

  education_stages: z
    .array(
      z.object({
        key: str,
        name: str,
        local_name: optStr,
        stage_type_code: str,
        isced_from: isced,
        isced_to: isced,
        orientation_code: optStr,
        start_age: optNum,
        end_age: optNum,
        grades_label: optStr,
        duration_years: optNum,
        is_compulsory: z.boolean().nullable().optional(),
        is_free_public: z.boolean().nullable().optional(),
        sort_order: optInt,
        notes: optStr,
        sources: sourceKeys,
        field_sources: fieldSources,
      }),
    )
    .default([]),

  country_curricula: z
    .array(
      z.object({
        curriculum_code: str,
        school_count: optInt,
        school_count_as_of: date.nullable().optional(),
        notes: optStr,
        sources: sourceKeys,
      }),
    )
    .default([]),

  school_types: z
    .array(
      z.object({
        key: str,
        school_type_code: str,
        local_name: optStr,
        description: optStr,
        management_type_code: optStr,
        funding_type_code: optStr,
        fee_policy_code: optStr,
        governing_body: optStr,
        isced_from: isced.nullable().optional(),
        isced_to: isced.nullable().optional(),
        share_of_students_pct: optNum,
        share_year: optInt,
        number_of_schools: optInt,
        number_of_schools_year: optInt,
        legal_status_notes: optStr,
        sort_order: optInt,
        curricula: z.array(str).default([]),
        sources: sourceKeys,
        field_sources: fieldSources,
      }),
    )
    .default([]),

  qualifications: z
    .array(
      z.object({
        key: str,
        name: str,
        local_name: optStr,
        international: z.boolean().default(false),
        isced_code: isced.nullable().optional(),
        orientation_code: optStr,
        awarding_body: optStr,
        curriculum_code: optStr,
        sources: sourceKeys,
      }),
    )
    .default([]),
});

export type CountryFile = z.infer<typeof countryFileSchema>;
