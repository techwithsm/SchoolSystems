-- =============================================================================
-- Migration 3: EDU schema - country education systems + individual schools
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Country-level education system
-- ---------------------------------------------------------------------------

-- One row per country: the headline facts shown on the country page and in
-- the compare view. All numeric facts are nullable: NULL = unknown, never guess.
create table edu.country_profiles (
  country_iso2               char(2) primary key references core.countries (iso2) on delete cascade,
  overview                   text,
  is_decentralised           boolean,          -- true = system mainly run by states/provinces
  compulsory_start_age       smallint check (compulsory_start_age between 0 and 25),
  compulsory_end_age         smallint check (compulsory_end_age between 0 and 25),
  compulsory_years           smallint check (compulsory_years between 0 and 20),
  compulsory_notes           text,             -- e.g. 'varies by state'
  academic_year_start_month  smallint check (academic_year_start_month between 1 and 12),
  academic_year_end_month    smallint check (academic_year_end_month between 1 and 12),
  term_structure_code        text references edu.term_structures (code),
  grading_system_id          uuid references edu.grading_systems (id),
  ministry_id                uuid references edu.education_bodies (id),
  -- key statistics, each with the year it refers to
  private_enrollment_pct     numeric(5,2) check (private_enrollment_pct between 0 and 100),
  private_enrollment_year    smallint,
  public_spending_pct_gdp    numeric(5,2) check (public_spending_pct_gdp between 0 and 100),
  public_spending_year       smallint,
  literacy_rate_pct          numeric(5,2) check (literacy_rate_pct between 0 and 100),
  literacy_rate_year         smallint,
  verification_status        core.verification_status not null default 'draft',
  last_verified              date,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (compulsory_end_age is null or compulsory_start_age is null
         or compulsory_end_age >= compulsory_start_age)
);

-- Languages used for teaching (separate from official languages in core).
create table edu.instruction_languages (
  country_iso2   char(2) not null references core.countries (iso2) on delete cascade,
  language_code  text not null references core.languages (code),
  scope          text not null default 'main' check (scope in ('main', 'regional', 'minority', 'bilingual_programmes')),
  notes          text,
  primary key (country_iso2, language_code)
);

-- Stages of the system (Esiopetus, Perusopetus, Lukio...). Optional
-- subdivision_code for decentralised systems where stages differ by state.
create table edu.education_stages (
  id                  uuid primary key default gen_random_uuid(),
  country_iso2        char(2) not null references core.countries (iso2) on delete cascade,
  subdivision_code    text references core.subdivisions (code),
  name                text not null,                      -- English name
  local_name          text,
  stage_type_code     text not null references edu.stage_types (code),
  isced_from          text not null references edu.isced_levels (code),
  isced_to            text not null references edu.isced_levels (code),  -- same as from for single level
  orientation_code    text references edu.programme_orientations (code),
  start_age           numeric(3,1) check (start_age between 0 and 30),   -- numeric allows 5.5
  end_age             numeric(3,1) check (end_age between 0 and 30),
  grades_label        text,                               -- '1-9', 'Year 7-11', 'Form 1-4'
  duration_years      numeric(3,1),
  is_compulsory       boolean,
  is_free_public      boolean,
  sort_order          smallint not null default 0,
  notes               text,
  verification_status core.verification_status not null default 'draft',
  last_verified       date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (isced_to >= isced_from),
  check (end_age is null or start_age is null or end_age >= start_age)
);
create index education_stages_country_idx on edu.education_stages (country_iso2, sort_order);

-- Which school types exist in a country, with the local name and details.
-- This is the heart of the directory (UK 'Academy' -> public_autonomous).
create table edu.country_school_types (
  id                       uuid primary key default gen_random_uuid(),
  country_iso2             char(2) not null references core.countries (iso2) on delete cascade,
  school_type_code         text not null references edu.school_types (code),
  local_name               text,
  description              text,
  management_type_code     text references edu.management_types (code),
  funding_type_code        text references edu.funding_types (code),
  fee_policy_code          text references edu.fee_policies (code),
  governing_body_id        uuid references edu.education_bodies (id),
  isced_from               text references edu.isced_levels (code),
  isced_to                 text references edu.isced_levels (code),
  share_of_students_pct    numeric(5,2) check (share_of_students_pct between 0 and 100),
  share_year               smallint,
  number_of_schools        integer check (number_of_schools >= 0),
  number_of_schools_year   smallint,
  legal_status_notes       text,             -- useful for homeschool / charter legality
  sort_order               smallint not null default 0,
  verification_status      core.verification_status not null default 'draft',
  last_verified            date,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- the same local name can't appear twice under the same type
  unique nulls not distinct (country_iso2, school_type_code, local_name)
);
create index country_school_types_type_idx on edu.country_school_types (school_type_code);

-- Curricula commonly used by a given country school type.
create table edu.country_school_type_curricula (
  country_school_type_id  uuid not null references edu.country_school_types (id) on delete cascade,
  curriculum_code         text not null references edu.curricula (code),
  primary key (country_school_type_id, curriculum_code)
);

-- Curricula available in a country at all (drives the curriculum filter).
create table edu.country_curricula (
  country_iso2         char(2) not null references core.countries (iso2) on delete cascade,
  curriculum_code      text not null references edu.curricula (code),
  school_count         integer check (school_count >= 0),
  school_count_as_of   date,
  notes                text,
  primary key (country_iso2, curriculum_code)
);
create index country_curricula_curriculum_idx on edu.country_curricula (curriculum_code);

-- ---------------------------------------------------------------------------
-- Individual schools (optional layer; load per country from open datasets)
-- ---------------------------------------------------------------------------

create table edu.schools (
  id                         uuid primary key default gen_random_uuid(),
  country_iso2               char(2) not null references core.countries (iso2),
  subdivision_code           text references core.subdivisions (code),
  -- identifier in the official national dataset (e.g. US NCES ID, UK URN)
  external_id                text,
  external_id_scheme         text,          -- 'NCES', 'URN', 'UDISE'...
  name                       text not null,
  local_name                 text,
  -- classification
  school_type_code           text not null references edu.school_types (code),
  management_type_code       text references edu.management_types (code),
  funding_type_code          text references edu.funding_types (code),
  fee_policy_code            text references edu.fee_policies (code),
  religious_affiliation_code text references edu.religious_affiliations (code),
  gender_policy_code         text references edu.gender_policies (code),
  residential_type_code      text references edu.residential_types (code),
  pedagogy_code              text references edu.pedagogies (code),
  selectivity_code           text references edu.selectivity_types (code),
  instruction_mode_code      text references edu.instruction_modes (code),
  locality_type_code         text references edu.locality_types (code),
  status_code                text not null default 'open' references edu.school_statuses (code),
  -- levels taught
  isced_from                 text references edu.isced_levels (code),
  isced_to                   text references edu.isced_levels (code),
  lowest_grade               text,
  highest_grade              text,
  enrollment                 integer check (enrollment >= 0),
  enrollment_year            smallint,
  -- contact and location
  website                    text check (website is null or website ~* '^https?://'),
  address_line               text,
  city                       text,
  postal_code                text,
  latitude                   numeric(9,6) check (latitude between -90 and 90),
  longitude                  numeric(9,6) check (longitude between -180 and 180),
  -- provenance
  source_id                  uuid references core.sources (id),
  verification_status        core.verification_status not null default 'draft',
  last_verified              date,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  -- full-text search over name + city (simple config works across languages)
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(local_name, '') || ' ' || coalesce(city, ''))
  ) stored,
  unique (country_iso2, external_id_scheme, external_id),
  check (isced_to is null or isced_from is null or isced_to >= isced_from)
);
create index schools_country_type_idx on edu.schools (country_iso2, school_type_code);
create index schools_subdivision_idx  on edu.schools (subdivision_code);
create index schools_search_idx       on edu.schools using gin (search_vector);

create table edu.school_curricula (
  school_id        uuid not null references edu.schools (id) on delete cascade,
  curriculum_code  text not null references edu.curricula (code),
  primary key (school_id, curriculum_code)
);
create index school_curricula_curriculum_idx on edu.school_curricula (curriculum_code);

create table edu.school_languages (
  school_id      uuid not null references edu.schools (id) on delete cascade,
  language_code  text not null references core.languages (code),
  primary key (school_id, language_code)
);

create table edu.school_special_needs (
  school_id      uuid not null references edu.schools (id) on delete cascade,
  category_code  text not null references edu.special_needs_categories (code),
  primary key (school_id, category_code)
);

create table edu.school_accreditations (
  school_id         uuid not null references edu.schools (id) on delete cascade,
  body_id           uuid not null references edu.education_bodies (id),
  accredited_since  date,
  primary key (school_id, body_id)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger country_profiles_updated_at before update on edu.country_profiles
  for each row execute function core.set_updated_at();
create trigger education_stages_updated_at before update on edu.education_stages
  for each row execute function core.set_updated_at();
create trigger country_school_types_updated_at before update on edu.country_school_types
  for each row execute function core.set_updated_at();
create trigger schools_updated_at before update on edu.schools
  for each row execute function core.set_updated_at();

-- ---------------------------------------------------------------------------
-- Read views for the front end
-- security_invoker = true makes views respect the caller's RLS policies.
-- ---------------------------------------------------------------------------

-- One row per country for browse cards and the compare page.
create view edu.v_country_overview with (security_invoker = true) as
select
  c.iso2,
  c.iso3,
  c.name,
  c.continent_code,
  ct.name                       as continent_name,
  r.name                        as region_name,
  p.compulsory_start_age,
  p.compulsory_end_age,
  p.compulsory_years,
  p.academic_year_start_month,
  p.academic_year_end_month,
  p.private_enrollment_pct,
  p.private_enrollment_year,
  p.public_spending_pct_gdp,
  p.public_spending_year,
  p.verification_status,
  p.last_verified,
  coalesce((select array_agg(distinct cst.school_type_code order by cst.school_type_code)
            from edu.country_school_types cst where cst.country_iso2 = c.iso2), '{}') as school_type_codes,
  coalesce((select array_agg(cc.curriculum_code order by cc.curriculum_code)
            from edu.country_curricula cc where cc.country_iso2 = c.iso2), '{}')       as curriculum_codes,
  coalesce((select array_agg(il.language_code order by il.language_code)
            from edu.instruction_languages il where il.country_iso2 = c.iso2), '{}')   as instruction_language_codes
from core.countries c
join core.continents ct on ct.code = c.continent_code
left join core.regions r on r.m49_code = c.region_m49_code
left join edu.country_profiles p on p.country_iso2 = c.iso2
where c.is_active;
