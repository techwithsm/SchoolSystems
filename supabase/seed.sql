-- =============================================================================
-- Seed data: lookup values + the 20 Phase-1 pilot countries
-- -----------------------------------------------------------------------------
-- Only standard codes and category definitions live here (ISO, UN M49,
-- ISCED 2011, the project taxonomy). Country FACTS (ages, stages, shares,
-- ministries) are NOT seeded: they must be entered from cited sources,
-- with a row in core.sources + core.record_sources.
-- Safe to re-run: every insert uses ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- CORE
-- ---------------------------------------------------------------------------

insert into core.continents (code, name, sort_order) values
  ('AF', 'Africa', 1),
  ('AN', 'Antarctica', 7),
  ('AS', 'Asia', 2),
  ('EU', 'Europe', 3),
  ('NA', 'North America', 4),
  ('OC', 'Oceania', 6),
  ('SA', 'South America', 5)
on conflict do nothing;

-- UN M49 sub-regions needed by the pilot countries (add more per continent rollout).
insert into core.regions (m49_code, name, continent_code) values
  ('005', 'South America',             'SA'),
  ('011', 'Western Africa',            'AF'),
  ('013', 'Central America',           'NA'),
  ('018', 'Southern Africa',           'AF'),
  ('021', 'Northern America',          'NA'),
  ('030', 'Eastern Asia',              'AS'),
  ('034', 'Southern Asia',             'AS'),
  ('035', 'South-eastern Asia',        'AS'),
  ('053', 'Australia and New Zealand', 'OC'),
  ('145', 'Western Asia',              'AS'),
  ('154', 'Northern Europe',           'EU'),
  ('155', 'Western Europe',            'EU')
on conflict do nothing;

-- Phase-1 pilot countries (ISO 3166-1). is_active stays false until the
-- country's data has been entered and reviewed.
insert into core.countries (iso2, iso3, iso_numeric, name, continent_code, region_m49_code) values
  ('US', 'USA', '840', 'United States',        'NA', '021'),
  ('CA', 'CAN', '124', 'Canada',               'NA', '021'),
  ('MX', 'MEX', '484', 'Mexico',               'NA', '013'),
  ('BR', 'BRA', '076', 'Brazil',               'SA', '005'),
  ('GB', 'GBR', '826', 'United Kingdom',       'EU', '154'),
  ('IE', 'IRL', '372', 'Ireland',              'EU', '154'),
  ('FR', 'FRA', '250', 'France',               'EU', '155'),
  ('DE', 'DEU', '276', 'Germany',              'EU', '155'),
  ('FI', 'FIN', '246', 'Finland',              'EU', '154'),
  ('NL', 'NLD', '528', 'Netherlands',          'EU', '155'),
  ('IN', 'IND', '356', 'India',                'AS', '034'),
  ('CN', 'CHN', '156', 'China',                'AS', '030'),
  ('JP', 'JPN', '392', 'Japan',                'AS', '030'),
  ('KR', 'KOR', '410', 'South Korea',          'AS', '030'),
  ('SG', 'SGP', '702', 'Singapore',            'AS', '035'),
  ('AE', 'ARE', '784', 'United Arab Emirates', 'AS', '145'),
  ('AU', 'AUS', '036', 'Australia',            'OC', '053'),
  ('NZ', 'NZL', '554', 'New Zealand',          'OC', '053'),
  ('ZA', 'ZAF', '710', 'South Africa',         'AF', '018'),
  ('NG', 'NGA', '566', 'Nigeria',              'AF', '011')
on conflict do nothing;

-- ISO 639-1 languages likely needed for the pilot countries.
insert into core.languages (code, name, native_name) values
  ('af', 'Afrikaans', 'Afrikaans'),
  ('ar', 'Arabic', 'العربية'),
  ('de', 'German', 'Deutsch'),
  ('en', 'English', 'English'),
  ('es', 'Spanish', 'Español'),
  ('fi', 'Finnish', 'Suomi'),
  ('fr', 'French', 'Français'),
  ('ga', 'Irish', 'Gaeilge'),
  ('ha', 'Hausa', 'Hausa'),
  ('hi', 'Hindi', 'हिन्दी'),
  ('ig', 'Igbo', 'Igbo'),
  ('ja', 'Japanese', '日本語'),
  ('ko', 'Korean', '한국어'),
  ('mi', 'Māori', 'Te reo Māori'),
  ('ms', 'Malay', 'Bahasa Melayu'),
  ('nl', 'Dutch', 'Nederlands'),
  ('pt', 'Portuguese', 'Português'),
  ('sv', 'Swedish', 'Svenska'),
  ('ta', 'Tamil', 'தமிழ்'),
  ('xh', 'Xhosa', 'isiXhosa'),
  ('yo', 'Yoruba', 'Yorùbá'),
  ('zh', 'Chinese', '中文'),
  ('zu', 'Zulu', 'isiZulu')
on conflict do nothing;

insert into core.currencies (code, name) values
  ('AED', 'UAE dirham'), ('AUD', 'Australian dollar'), ('BRL', 'Brazilian real'),
  ('CAD', 'Canadian dollar'), ('CNY', 'Chinese yuan'), ('EUR', 'Euro'),
  ('GBP', 'Pound sterling'), ('INR', 'Indian rupee'), ('JPY', 'Japanese yen'),
  ('KRW', 'South Korean won'), ('MXN', 'Mexican peso'), ('NGN', 'Nigerian naira'),
  ('NZD', 'New Zealand dollar'), ('SGD', 'Singapore dollar'), ('USD', 'US dollar'),
  ('ZAR', 'South African rand')
on conflict do nothing;

insert into core.source_types (code, label, sort_order) values
  ('ministry',          'National education ministry / government portal', 1),
  ('unesco',            'UNESCO / UNESCO Institute for Statistics',         2),
  ('eurydice',          'Eurydice (European Commission)',                   3),
  ('oecd',              'OECD',                                             4),
  ('world_bank',        'World Bank',                                       5),
  ('curriculum_body',   'Curriculum / exam body (IBO, Cambridge...)',       6),
  ('statistics_office', 'National statistics office',                       7),
  ('school_website',    'School website',                                   8),
  ('other',             'Other (explain in notes)',                         9)
on conflict do nothing;

insert into core.data_licenses (code, label, url) values
  ('cc_by_4',       'Creative Commons Attribution 4.0', 'https://creativecommons.org/licenses/by/4.0/'),
  ('cc_by_sa_4',    'Creative Commons Attribution-ShareAlike 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'),
  ('cc0',           'CC0 / Public domain dedication', 'https://creativecommons.org/publicdomain/zero/1.0/'),
  ('public_domain', 'Public domain (government work)', null),
  ('ogl_uk_3',      'Open Government Licence v3.0 (UK)', 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/'),
  ('all_rights',    'All rights reserved: cite and link only', null),
  ('unknown',       'Unknown: check before reusing', null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- EDU: structure
-- ---------------------------------------------------------------------------

-- ISCED 2011 (UNESCO Institute for Statistics).
insert into edu.isced_levels (code, name, sort_order) values
  ('0', 'Early childhood education',              0),
  ('1', 'Primary education',                      1),
  ('2', 'Lower secondary education',              2),
  ('3', 'Upper secondary education',              3),
  ('4', 'Post-secondary non-tertiary education',  4),
  ('5', 'Short-cycle tertiary education',         5),
  ('6', 'Bachelor''s or equivalent level',        6),
  ('7', 'Master''s or equivalent level',          7),
  ('8', 'Doctoral or equivalent level',           8)
on conflict do nothing;

insert into edu.stage_types (code, label, isced_code, sort_order) values
  ('early_childhood',    'Early childhood / pre-primary',   '0', 0),
  ('primary',            'Primary',                         '1', 1),
  ('lower_secondary',    'Lower secondary',                 '2', 2),
  ('basic_combined',     'Basic education (primary + lower secondary combined)', null, 3),
  ('upper_secondary',    'Upper secondary',                 '3', 4),
  ('post_secondary',     'Post-secondary non-tertiary',     '4', 5),
  ('tertiary_short',     'Short-cycle tertiary',            '5', 6),
  ('tertiary_bachelor',  'Bachelor''s',                     '6', 7),
  ('tertiary_master',    'Master''s',                       '7', 8),
  ('tertiary_doctoral',  'Doctoral',                        '8', 9)
on conflict do nothing;

insert into edu.programme_orientations (code, label, sort_order) values
  ('general',        'General / academic', 1),
  ('vocational',     'Vocational',         2),
  ('pre_vocational', 'Pre-vocational',     3),
  ('mixed',          'Mixed / comprehensive', 4)
on conflict do nothing;

insert into edu.term_structures (code, label, sort_order) values
  ('two_semesters', '2 semesters',          1),
  ('three_terms',   '3 terms',              2),
  ('four_terms',    '4 terms / quarters',   3),
  ('other',         'Other (see notes)',    9)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- EDU: school classification
-- ---------------------------------------------------------------------------

-- Project taxonomy (application-builder-context.md, section 3).
insert into edu.school_types (code, label, description, sort_order) values
  ('public',               'Public / State School',              'Government-funded and run',                                      1),
  ('public_autonomous',    'Publicly Funded, Independently Run', 'e.g. Charter (US), Academy / Free school (UK)',                  2),
  ('private',              'Private / Independent',              'Fee-paying, privately run',                                      3),
  ('religious',            'Faith-Based',                        'Catholic, Islamic, Jewish, etc. (may be public or private)',     4),
  ('international',        'International School',               'IB, Cambridge, American, British and other foreign curricula',   5),
  ('boarding',             'Boarding School',                    'Residential',                                                    6),
  ('vocational',           'Vocational / Technical',             'TVET, apprenticeships, polytechnic secondary',                   7),
  ('special_needs',        'Special Education',                  'Disability and learning-support schools',                        8),
  ('alternative',          'Alternative Pedagogy',               'Montessori, Waldorf/Steiner, Reggio Emilia',                     9),
  ('selective',            'Selective / Gifted',                 'Grammar schools, exam-entry schools',                           10),
  ('homeschool',           'Home Education',                     'Legal status and regulation',                                   11),
  ('online',               'Online / Virtual School',            null,                                                            12),
  ('early_childhood',      'Pre-Primary / Kindergarten',         null,                                                            13),
  ('higher_ed_university', 'University',                         null,                                                            14),
  ('higher_ed_college',    'College / Community College / Polytechnic', null,                                                     15)
on conflict do nothing;

insert into edu.management_types (code, label, description, sort_order) values
  ('government',       'Government',        'Run by a public authority',                              1),
  ('government_aided', 'Government-Aided',  'Privately run, substantially publicly funded',           2),
  ('private',          'Private',           'Privately owned and run',                                3),
  ('community',        'Community',         'Run by a community or parents'' association',            4),
  ('religious_body',   'Religious Body',    'Run by a church, mosque, temple or religious order',     5),
  ('ngo',              'NGO / Non-Profit',  'Run by a charity or non-governmental organisation',      6)
on conflict do nothing;

insert into edu.funding_types (code, label, sort_order) values
  ('public',  'Public',            1),
  ('private', 'Private',           2),
  ('mixed',   'Mixed',             3),
  ('voucher', 'Voucher / per-pupil public funding', 4)
on conflict do nothing;

insert into edu.fee_policies (code, label, description, sort_order) values
  ('free',     'Free',      'No tuition fees',                                  1),
  ('nominal',  'Nominal',   'Small contributions or levies only',               2),
  ('fee',      'Fee-paying','Tuition fees charged',                             3),
  ('varies',   'Varies',    'Differs between schools of this type',             4)
on conflict do nothing;

insert into edu.religious_affiliations (code, label, sort_order) values
  ('none',        'None / secular',  0),
  ('catholic',    'Catholic',        1),
  ('protestant',  'Protestant',      2),
  ('orthodox',    'Orthodox Christian', 3),
  ('christian',   'Christian (other / non-denominational)', 4),
  ('islamic',     'Islamic',         5),
  ('jewish',      'Jewish',          6),
  ('hindu',       'Hindu',           7),
  ('buddhist',    'Buddhist',        8),
  ('sikh',        'Sikh',            9),
  ('other',       'Other',          10)
on conflict do nothing;

insert into edu.gender_policies (code, label, sort_order) values
  ('coed',  'Co-educational', 1),
  ('boys',  'Boys only',      2),
  ('girls', 'Girls only',     3),
  ('parallel', 'Single-sex classes, shared school', 4)
on conflict do nothing;

insert into edu.residential_types (code, label, sort_order) values
  ('day',          'Day',              1),
  ('boarding',     'Boarding',         2),
  ('day_boarding', 'Day and boarding', 3)
on conflict do nothing;

insert into edu.pedagogies (code, label, sort_order) values
  ('mainstream',     'Mainstream',           0),
  ('montessori',     'Montessori',           1),
  ('waldorf',        'Waldorf / Steiner',    2),
  ('reggio_emilia',  'Reggio Emilia',        3),
  ('democratic',     'Democratic / free school', 4),
  ('forest',         'Forest / outdoor',     5),
  ('other',          'Other',                9)
on conflict do nothing;

insert into edu.special_needs_categories (code, label, sort_order) values
  ('physical',     'Physical disability',            1),
  ('hearing',      'Hearing impairment',             2),
  ('vision',       'Visual impairment',              3),
  ('intellectual', 'Intellectual disability',        4),
  ('autism',       'Autism spectrum',                5),
  ('learning',     'Specific learning difficulties', 6),
  ('behavioural',  'Social, emotional and behavioural', 7),
  ('multiple',     'Multiple / complex needs',       8)
on conflict do nothing;

insert into edu.selectivity_types (code, label, sort_order) values
  ('open',        'Open admission',      1),
  ('catchment',   'Catchment / zoned',   2),
  ('exam',        'Entrance exam',       3),
  ('lottery',     'Lottery',             4),
  ('interview',   'Interview / portfolio', 5),
  ('faith',       'Faith-based criteria', 6)
on conflict do nothing;

insert into edu.school_statuses (code, label, sort_order) values
  ('open',     'Open',     1),
  ('proposed', 'Proposed', 2),
  ('closed',   'Closed',   3),
  ('merged',   'Merged',   4)
on conflict do nothing;

insert into edu.locality_types (code, label, sort_order) values
  ('urban',    'Urban',    1),
  ('suburban', 'Suburban', 2),
  ('rural',    'Rural',    3),
  ('remote',   'Remote',   4)
on conflict do nothing;

insert into edu.instruction_modes (code, label, sort_order) values
  ('in_person', 'In person', 1),
  ('online',    'Online',    2),
  ('hybrid',    'Hybrid',    3)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- EDU: curricula (families first, then programmes that reference them)
-- ---------------------------------------------------------------------------

insert into edu.curricula (code, name, provider, curriculum_type, parent_code, url, sort_order) values
  ('national',   'National curriculum',             null,                             'national',      null, null, 0),
  ('ib',         'International Baccalaureate',     'International Baccalaureate',    'international', null, 'https://www.ibo.org',                        10),
  ('cambridge',  'Cambridge International',         'Cambridge International Education', 'international', null, 'https://www.cambridgeinternational.org', 20),
  ('american',   'American curriculum',             null,                             'foreign_national', null, null,                                    30),
  ('british',    'British curriculum (England)',    null,                             'foreign_national', null, null,                                    40),
  ('french',     'French curriculum abroad',        null,                             'foreign_national', null, null,                                    50),
  ('german',     'German curriculum abroad',        null,                             'foreign_national', null, null,                                    60)
on conflict do nothing;

insert into edu.curricula (code, name, provider, curriculum_type, parent_code, sort_order) values
  ('ib_pyp',             'IB Primary Years Programme',  'International Baccalaureate',       'international', 'ib',        11),
  ('ib_myp',             'IB Middle Years Programme',   'International Baccalaureate',       'international', 'ib',        12),
  ('ib_dp',              'IB Diploma Programme',        'International Baccalaureate',       'international', 'ib',        13),
  ('ib_cp',              'IB Career-related Programme', 'International Baccalaureate',       'international', 'ib',        14),
  ('cambridge_primary',  'Cambridge Primary',           'Cambridge International Education', 'international', 'cambridge', 21),
  ('cambridge_lower_sec','Cambridge Lower Secondary',   'Cambridge International Education', 'international', 'cambridge', 22),
  ('cambridge_igcse',    'Cambridge IGCSE',             'Cambridge International Education', 'international', 'cambridge', 23),
  ('cambridge_a_level',  'Cambridge International AS & A Level', 'Cambridge International Education', 'international', 'cambridge', 24),
  ('american_ap',        'Advanced Placement (AP)',     'College Board',                     'foreign_national', 'american', 31)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- TEMPLATE (commented out): how to add a cited fact.
-- Replace every value with data taken from the source you record.
-- ---------------------------------------------------------------------------
-- with s as (
--   insert into core.sources (title, url, publisher, source_type_code, country_iso2, accessed_on)
--   values ('<page title>', 'https://<official page>', '<publisher>', 'ministry', 'FI', current_date)
--   returning id
-- )
-- insert into core.record_sources (entity_table, entity_id, field_name, source_id)
-- select 'edu.country_profiles', 'FI', 'compulsory_end_age', id from s;
