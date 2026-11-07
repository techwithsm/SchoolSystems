-- =============================================================================
-- Migration 2: EDU schema - lookup (reference) tables
-- -----------------------------------------------------------------------------
-- Every lookup uses a stable machine `code` (e.g. 'boarding') plus a display
-- `label`. Store codes in data tables; translate labels in the UI later.
--
-- Design choice: one small table per lookup (rather than a single generic
-- lookups table) so every column gets a real foreign key and the Supabase
-- table editor shows a dropdown for it.
-- =============================================================================

create schema if not exists edu;

-- ---------------------------------------------------------------------------
-- Education structure
-- ---------------------------------------------------------------------------

-- UNESCO ISCED 2011 levels 0-8: the backbone for cross-country comparison.
create table edu.isced_levels (
  code         text primary key check (code ~ '^[0-8]$'),
  name         text not null,
  description  text,
  sort_order   smallint not null
);

-- Generic stage names that local stages map to (Primary, Lower secondary...).
create table edu.stage_types (
  code         text primary key,
  label        text not null,
  isced_code   text references edu.isced_levels (code),
  sort_order   smallint not null default 0
);

-- ISCED programme orientation (general vs vocational tracks).
create table edu.programme_orientations (
  code        text primary key,
  label       text not null,
  sort_order  smallint not null default 0
);

create table edu.term_structures (
  code        text primary key,
  label       text not null,
  sort_order  smallint not null default 0
);

-- ---------------------------------------------------------------------------
-- School classification (independent attributes; a school can be several)
-- ---------------------------------------------------------------------------

-- The 15 standard categories from the project taxonomy.
create table edu.school_types (
  code         text primary key,
  label        text not null,
  description  text,
  sort_order   smallint not null default 0
);

create table edu.management_types (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.funding_types (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.fee_policies (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.religious_affiliations (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.gender_policies (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.residential_types (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.pedagogies (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.special_needs_categories (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.selectivity_types (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.school_statuses (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.locality_types (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);
create table edu.instruction_modes (
  code text primary key, label text not null, description text, sort_order smallint not null default 0
);

-- ---------------------------------------------------------------------------
-- Curricula and authorities
-- ---------------------------------------------------------------------------

-- Curricula / programmes. parent_code groups families (IB -> IB DP).
create table edu.curricula (
  code             text primary key,
  name             text not null,
  provider         text,                                  -- 'International Baccalaureate', 'Cambridge International'
  curriculum_type  text not null check (curriculum_type in ('national', 'international', 'foreign_national')),
  parent_code      text references edu.curricula (code),
  country_iso2     char(2) references core.countries (iso2), -- set for national curricula
  url              text check (url is null or url ~* '^https?://'),
  sort_order       smallint not null default 0
);

-- Ministries, agencies, inspectorates, exam boards and accreditors in ONE table,
-- distinguished by body_type (fewer tables, same queries).
create table edu.education_bodies (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                          -- optional short code, e.g. 'CBSE', 'IBO'
  name                text not null,
  local_name          text,
  body_type           text not null check (body_type in (
                        'ministry', 'national_agency', 'regional_authority', 'local_authority',
                        'inspectorate', 'exam_board', 'accreditor', 'curriculum_provider', 'other')),
  level               text not null check (level in ('international', 'national', 'subnational', 'local')),
  country_iso2        char(2) references core.countries (iso2),   -- null for international bodies
  subdivision_code    text references core.subdivisions (code),
  url                 text check (url is null or url ~* '^https?://'),
  verification_status core.verification_status not null default 'draft',
  last_verified       date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- international bodies have no country; everything else must have one
  check ((level = 'international') = (country_iso2 is null))
);
create index education_bodies_country_idx on edu.education_bodies (country_iso2);

-- Exit qualifications (A-Level, Abitur, IB Diploma, CBSE Class XII...).
create table edu.qualifications (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  local_name          text,
  country_iso2        char(2) references core.countries (iso2),   -- null for international (IB DP)
  isced_code          text references edu.isced_levels (code),
  orientation_code    text references edu.programme_orientations (code),
  awarding_body_id    uuid references edu.education_bodies (id),
  curriculum_code     text references edu.curricula (code),
  verification_status core.verification_status not null default 'draft',
  last_verified       date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index qualifications_country_idx on edu.qualifications (country_iso2);

create table edu.grading_systems (
  id                  uuid primary key default gen_random_uuid(),
  country_iso2        char(2) references core.countries (iso2),
  name                text not null,                       -- e.g. '4-10 scale'
  scale_description   text,                                -- free text: grades and meanings
  best_grade          text,
  lowest_pass_grade   text,
  verification_status core.verification_status not null default 'draft',
  last_verified       date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger education_bodies_updated_at before update on edu.education_bodies
  for each row execute function core.set_updated_at();
create trigger qualifications_updated_at before update on edu.qualifications
  for each row execute function core.set_updated_at();
create trigger grading_systems_updated_at before update on edu.grading_systems
  for each row execute function core.set_updated_at();
