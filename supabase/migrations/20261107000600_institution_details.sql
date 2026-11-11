-- =============================================================================
-- Migration 6: Institution details for bulk national datasets (first: India)
-- -----------------------------------------------------------------------------
--   * edu.schools: contact (phone, email), district, year established,
--     national type label, and affiliation (college -> university).
--   * edu.subjects + edu.school_subjects: subjects / programmes taught.
--     Empty until a sourced value exists (no official bulk source yet).
--   * core.subdivisions: India's 28 states and 8 union territories.
--   * core.data_licenses: Open Government License - India.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- edu.schools: new columns (all nullable: NULL = unknown)
-- ---------------------------------------------------------------------------
alter table edu.schools
  add column phone             text check (phone is null or phone ~ '^\+?[0-9 ()./-]{5,30}$'),
  add column email             text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column district          text,
  add column year_established  smallint check (year_established between 1000 and 2100),
  -- Type exactly as named in the national dataset, e.g. AISHE 'Affiliated College',
  -- 'State Public University'. school_type_code holds the standard category.
  add column local_type        text,
  -- College -> its affiliating university (both rows in edu.schools).
  add column affiliated_to_id  uuid references edu.schools (id) on delete set null;

create index schools_affiliated_to_idx on edu.schools (affiliated_to_id);
create index schools_country_district_idx on edu.schools (country_iso2, district);

-- ---------------------------------------------------------------------------
-- Subjects / programmes taught
-- ---------------------------------------------------------------------------
create table edu.subjects (
  code         text primary key,                      -- e.g. 'physics', 'btech_cse'
  name         text not null,
  category     text not null check (category in ('school_subject', 'stream', 'programme', 'discipline')),
  isced_code   text references edu.isced_levels (code),
  sort_order   smallint not null default 0
);

create table edu.school_subjects (
  school_id     uuid not null references edu.schools (id) on delete cascade,
  subject_code  text not null references edu.subjects (code),
  source_id     uuid references core.sources (id),
  primary key (school_id, subject_code)
);
create index school_subjects_subject_idx on edu.school_subjects (subject_code);

-- Same public read-only model as every other reference table (migration 4).
alter table edu.subjects        enable row level security;
alter table edu.school_subjects enable row level security;
create policy "Public read access" on edu.subjects        for select to anon, authenticated using (true);
create policy "Public read access" on edu.school_subjects for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
insert into core.data_licenses (code, label, url) values
  ('ogl_in', 'Government Open Data License - India', 'https://data.gov.in/government-open-data-license-india')
on conflict do nothing;

-- On a fresh database migrations run before seed.sql, so make sure India
-- (and its continent/region) exist first. No-op when the seed already ran.
insert into core.continents (code, name, sort_order) values ('AS', 'Asia', 2) on conflict do nothing;
insert into core.regions (m49_code, name, continent_code) values ('034', 'Southern Asia', 'AS') on conflict do nothing;
insert into core.countries (iso2, iso3, iso_numeric, name, continent_code, region_m49_code)
values ('IN', 'IND', '356', 'India', 'AS', '034') on conflict do nothing;

-- ISO 3166-2:IN (codes as updated 2023-11-23: IN-CG, IN-OD, IN-TS, IN-UK).
insert into core.subdivisions (code, country_iso2, name, type) values
  ('IN-AP', 'IN', 'Andhra Pradesh',    'state'),
  ('IN-AR', 'IN', 'Arunachal Pradesh', 'state'),
  ('IN-AS', 'IN', 'Assam',             'state'),
  ('IN-BR', 'IN', 'Bihar',             'state'),
  ('IN-CG', 'IN', 'Chhattisgarh',      'state'),
  ('IN-GA', 'IN', 'Goa',               'state'),
  ('IN-GJ', 'IN', 'Gujarat',           'state'),
  ('IN-HR', 'IN', 'Haryana',           'state'),
  ('IN-HP', 'IN', 'Himachal Pradesh',  'state'),
  ('IN-JH', 'IN', 'Jharkhand',         'state'),
  ('IN-KA', 'IN', 'Karnataka',         'state'),
  ('IN-KL', 'IN', 'Kerala',            'state'),
  ('IN-MP', 'IN', 'Madhya Pradesh',    'state'),
  ('IN-MH', 'IN', 'Maharashtra',       'state'),
  ('IN-MN', 'IN', 'Manipur',           'state'),
  ('IN-ML', 'IN', 'Meghalaya',         'state'),
  ('IN-MZ', 'IN', 'Mizoram',           'state'),
  ('IN-NL', 'IN', 'Nagaland',          'state'),
  ('IN-OD', 'IN', 'Odisha',            'state'),
  ('IN-PB', 'IN', 'Punjab',            'state'),
  ('IN-RJ', 'IN', 'Rajasthan',         'state'),
  ('IN-SK', 'IN', 'Sikkim',            'state'),
  ('IN-TN', 'IN', 'Tamil Nadu',        'state'),
  ('IN-TS', 'IN', 'Telangana',         'state'),
  ('IN-TR', 'IN', 'Tripura',           'state'),
  ('IN-UP', 'IN', 'Uttar Pradesh',     'state'),
  ('IN-UK', 'IN', 'Uttarakhand',       'state'),
  ('IN-WB', 'IN', 'West Bengal',       'state'),
  ('IN-AN', 'IN', 'Andaman and Nicobar Islands',              'union_territory'),
  ('IN-CH', 'IN', 'Chandigarh',                               'union_territory'),
  ('IN-DH', 'IN', 'Dadra and Nagar Haveli and Daman and Diu', 'union_territory'),
  ('IN-DL', 'IN', 'Delhi',                                    'union_territory'),
  ('IN-JK', 'IN', 'Jammu and Kashmir',                        'union_territory'),
  ('IN-LA', 'IN', 'Ladakh',                                   'union_territory'),
  ('IN-LD', 'IN', 'Lakshadweep',                              'union_territory'),
  ('IN-PY', 'IN', 'Puducherry',                               'union_territory')
on conflict do nothing;
