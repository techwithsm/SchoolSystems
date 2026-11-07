-- =============================================================================
-- Migration 1: CORE schema (shared across all Application Builder apps)
-- -----------------------------------------------------------------------------
-- Holds reference data that is not specific to education and will be reused
-- by future apps (universities, healthcare, visas, public services):
--   continents, regions, countries, subdivisions, languages, currencies,
--   and the citation system (sources).
-- =============================================================================

create schema if not exists core;
create schema if not exists extensions;   -- Supabase already has this; harmless elsewhere

-- -----------------------------------------------------------------------------
-- Shared types and helpers
-- -----------------------------------------------------------------------------

-- Data-quality status used on every fact-bearing record in every app.
create type core.verification_status as enum ('draft', 'needs_verification', 'verified');

-- Keeps updated_at current on every UPDATE. Attached to tables via trigger.
create or replace function core.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Geography
-- -----------------------------------------------------------------------------

-- 7-continent model used for browsing (World -> Continent -> Country).
create table core.continents (
  code        text primary key check (code ~ '^[A-Z]{2}$'),   -- AF, AN, AS, EU, NA, OC, SA
  name        text not null unique,
  sort_order  smallint not null default 0
);

-- UN M49 sub-regions (e.g. 154 = Northern Europe). Code kept as text to
-- preserve leading zeros ('005' = South America).
create table core.regions (
  m49_code        text primary key check (m49_code ~ '^[0-9]{3}$'),
  name            text not null unique,
  continent_code  text not null references core.continents (code)
);

-- ISO 3166-1. iso2 is the primary key used across every app.
create table core.countries (
  iso2             char(2) primary key check (iso2 ~ '^[A-Z]{2}$'),
  iso3             char(3) not null unique check (iso3 ~ '^[A-Z]{3}$'),
  iso_numeric      char(3) unique check (iso_numeric ~ '^[0-9]{3}$'),
  name             text not null,
  official_name    text,
  continent_code   text not null references core.continents (code),
  region_m49_code  text references core.regions (m49_code),
  is_un_member     boolean not null default true,
  is_active        boolean not null default false,   -- true once the country is published in the app
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index countries_continent_idx on core.countries (continent_code);

-- ISO 3166-2 first-level subdivisions (states, provinces, Länder...).
-- Needed because many education systems are run below national level.
create table core.subdivisions (
  code          text primary key check (code ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'),  -- e.g. US-CA, DE-BY
  country_iso2  char(2) not null references core.countries (iso2) on delete cascade,
  name          text not null,
  local_name    text,
  type          text,   -- 'state', 'province', 'territory', 'land'...
  unique (country_iso2, name)
);
create index subdivisions_country_idx on core.subdivisions (country_iso2);

-- ISO 639 languages. Use 639-1 (2 letters) where it exists, else 639-3.
create table core.languages (
  code         text primary key check (code ~ '^[a-z]{2,3}$'),
  name         text not null,
  native_name  text
);

-- ISO 4217 currencies (for fees, spending figures).
create table core.currencies (
  code  char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name  text not null
);

-- Which languages a country uses, and in what role.
create table core.country_languages (
  country_iso2   char(2) not null references core.countries (iso2) on delete cascade,
  language_code  text not null references core.languages (code),
  role           text not null check (role in ('official', 'regional_official', 'national', 'widely_used')),
  primary key (country_iso2, language_code, role)
);

-- -----------------------------------------------------------------------------
-- Citations: every fact in every app should trace back to a source row.
-- -----------------------------------------------------------------------------

create table core.source_types (
  code        text primary key,
  label       text not null,
  sort_order  smallint not null default 0
);

create table core.data_licenses (
  code   text primary key,
  label  text not null,
  url    text
);

create table core.sources (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  url               text check (url is null or url ~* '^https?://'),
  publisher         text,                                   -- e.g. 'UNESCO Institute for Statistics'
  source_type_code  text not null references core.source_types (code),
  license_code      text references core.data_licenses (code),
  country_iso2      char(2) references core.countries (iso2), -- null = international/multi-country
  published_on      date,
  accessed_on       date not null default current_date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (url, accessed_on)
);
create index sources_country_idx on core.sources (country_iso2);

-- Polymorphic link: "this row (or this field of this row) is backed by this source".
-- Trade-off: no FK to the cited row (it can live in any table), but one table
-- serves every app. entity_table is restricted to known tables via CHECK; extend
-- the list when new apps add tables.
create table core.record_sources (
  id            uuid primary key default gen_random_uuid(),
  entity_table  text not null check (entity_table in (
                  'edu.country_profiles', 'edu.education_stages', 'edu.country_school_types',
                  'edu.country_curricula', 'edu.education_bodies', 'edu.qualifications',
                  'edu.grading_systems', 'edu.schools')),
  entity_id     text not null,          -- PK of the cited row, as text (uuid or iso2)
  field_name    text,                   -- null = whole row; else the specific column
  source_id     uuid not null references core.sources (id) on delete cascade,
  note          text,
  created_at    timestamptz not null default now(),
  unique (entity_table, entity_id, field_name, source_id)
);
create index record_sources_entity_idx on core.record_sources (entity_table, entity_id);

-- updated_at triggers
create trigger countries_updated_at before update on core.countries
  for each row execute function core.set_updated_at();
create trigger sources_updated_at before update on core.sources
  for each row execute function core.set_updated_at();
