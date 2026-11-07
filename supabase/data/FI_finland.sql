-- =============================================================================
-- Country data: FINLAND (FI)
-- -----------------------------------------------------------------------------
-- Researched 2026-11-07 from the sources listed in section 1. Every row is
-- 'needs_verification' and last_verified is NULL until a human reviews it.
-- Values that could not be sourced are left NULL (see "Known gaps" at the end).
-- core.countries.is_active stays FALSE: flip it after review.
--
-- Idempotent: every row has a deterministic id (md5 of a readable key cast to
-- uuid) and every insert uses ON CONFLICT DO NOTHING, so the file can be re-run.
-- Run with: supabase db query --linked -f supabase/data/FI_finland.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Core reference additions needed by Finland
-- -----------------------------------------------------------------------------
insert into core.languages (code, name, native_name) values
  ('se', 'Northern Sami', 'Davvisámegiella')
on conflict do nothing;

insert into core.country_languages (country_iso2, language_code, role) values
  ('FI', 'fi', 'official'),
  ('FI', 'sv', 'official'),
  ('FI', 'se', 'regional_official')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 1. Sources  (id = md5('FI/src/<key>')::uuid)
-- -----------------------------------------------------------------------------
insert into core.sources (id, title, url, publisher, source_type_code, country_iso2, published_on, accessed_on, notes)
select md5('FI/src/' || k)::uuid, title, url, publisher, st, c, pub::date, date '2026-11-07', notes
from (values
  ('eury_compulsory18', 'Finland: compulsory education extended until age 18',
     'https://eurydice.eacea.ec.europa.eu/news/finland-compulsory-education-extended-until-age-18',
     'Eurydice (European Commission)', 'eurydice', 'FI', null, 'Reform in force from 1 August 2021'),
  ('eury_ecec', 'Finland: Early childhood education and care',
     'https://eurydice.eacea.ec.europa.eu/national-education-systems/finland/early-childhood-education-and-care',
     'Eurydice (European Commission)', 'eurydice', 'FI', null, 'Pre-primary participation mandatory since August 2015'),
  ('okm_preprimary', 'Pre-primary education',
     'https://stm.fi/en/web/okm/pre-primary-education1',
     'Ministry of Education and Culture', 'ministry', 'FI', null, null),
  ('eury_structure', 'Finland: Organisation of the education system and of its structure',
     'https://eurydice.eacea.ec.europa.eu/eurypedia/finland/organisation-education-system-and-its-structure',
     'Eurydice (European Commission)', 'eurydice', 'FI', null, 'Also states compulsory education, not compulsory school attendance'),
  ('eury_assess_basic', 'Finland: Assessment in single structure education',
     'https://eurydice.eacea.ec.europa.eu/eurypedia/finland/assessment-single-structure-education',
     'Eurydice (European Commission)', 'eurydice', 'FI', null, '4-10 grading scale; basic education certificate'),
  ('eury_assess_upsec', 'Finland: Assessment in general upper secondary education',
     'https://eurydice.eacea.ec.europa.eu/national-education-systems/finland/assessment-general-upper-secondary-education',
     'Eurydice (European Commission)', 'eurydice', 'FI', null, '4-10 course grades; matriculation examination'),
  ('norden_grading', 'Grading scales in Finland',
     'https://www.norden.org/en/info-norden/grading-scales-finland',
     'Info Norden (Nordic Council of Ministers)', 'other', 'FI', null, 'Vocational 1-5 and higher education 0-5 scales'),
  ('eury_funding', 'Finland: Early childhood and school education funding',
     'https://eurydice.eacea.ec.europa.eu/national-education-systems/finland/early-childhood-and-school-education-funding',
     'Eurydice (European Commission)', 'eurydice', 'FI', null, 'ECEC fees income-related; private school funding'),
  ('gem_peer_nsa', 'Finland: Non-state actors in education',
     'https://education-profiles.org/node/812',
     'UNESCO GEM Report: PEER country profiles', 'unesco', 'FI', null, '~3% of basic-level schools and enrolments non-state; ~10% upper secondary'),
  ('eur_agency_fi', 'Finland: Country background information',
     'https://www.european-agency.org/node/26950',
     'European Agency for Special Needs and Inclusive Education', 'other', 'FI', null, 'Home education needs notification only'),
  ('norden_basic', 'Basic education in Finland',
     'https://www.norden.org/en/info-norden/basic-education-finland',
     'Info Norden (Nordic Council of Ministers)', 'other', 'FI', null, 'Languages of instruction'),
  ('eury_english_2026', 'Finland: English language option in general upper secondary education launching 2026',
     'https://eurydice.eacea.ec.europa.eu/news/finland-english-language-option-general-upper-secondary-education-launching-2026',
     'Eurydice (European Commission)', 'eurydice', 'FI', null, 'From August 2026'),
  ('hollola_calendar', 'Working and holiday hours in pre-primary and primary education for the 2025-2026 academic year',
     'https://hollola.fi/en/kasvatus-ja-opetus/perusopetus/kodin-ja-koulun-yhteistyo/tyo-ja-loma-ajat/',
     'Municipality of Hollola', 'other', 'FI', null, 'Cites Basic Education Decree s.7 (year ends last weekday of week 22) and Act s.23 (190 days)'),
  ('eury_school_time', 'The organisation of school time in Europe: primary and general secondary education 2021/22',
     'https://eurydice.eacea.ec.europa.eu/publications/organisation-school-time-europe-primary-and-general-secondary-education-202122',
     'Eurydice (European Commission)', 'eurydice', null, null, 'Finland among earliest school-year starts (August)'),
  ('wb_spending', 'Government expenditure on education, total (% of GDP): Finland',
     'https://data.worldbank.org/indicator/SE.XPD.TOTL.GD.ZS?locations=FI',
     'World Bank', 'world_bank', 'FI', null, 'API value for 2022: 6.37578; dataset updated 2026-10-08'),
  ('sif_2021', 'Study in Finland presentation 2021',
     'https://www.educationfinland.fi/sites/default/files/2021-09/SiF%20presentation%202021%20Tokio.pdf',
     'Finnish National Agency for Education (Study in Finland)', 'ministry', 'FI', '2021-09-01', '13 universities, 22 universities of applied sciences'),
  ('eury_tuition', 'Finland: tuition fees for non-EU/EEA students have been evaluated',
     'https://eurydice.eacea.ec.europa.eu/news/finland-tuition-fees-non-eueea-students-have-been-evaluated',
     'Eurydice (European Commission)', 'eurydice', 'FI', null, 'Fees for non-EU/EEA students since 2017'),
  ('iaswece_fi', 'Steiner Waldorf early childhood education: Finland',
     'https://iaswece.org/europe/finland/',
     'International Association for Steiner/Waldorf Early Childhood Education', 'other', 'FI', null, null),
  ('ibo_ish', 'International School of Helsinki',
     'https://ibo.org/school/000652/',
     'International Baccalaureate', 'curriculum_body', 'FI', null, 'PYP, MYP and DP; IB school since 1992'),
  ('web_okm', 'Ministry of Education and Culture', 'https://okm.fi/en',
     'Ministry of Education and Culture', 'ministry', 'FI', null, null),
  ('web_oph', 'Finnish National Agency for Education', 'https://www.oph.fi/en',
     'Finnish National Agency for Education', 'ministry', 'FI', null, null),
  ('web_ytl', 'Matriculation Examination Board', 'https://www.ylioppilastutkinto.fi/en',
     'Matriculation Examination Board', 'curriculum_body', 'FI', null, null),
  ('web_karvi', 'Finnish Education Evaluation Centre', 'https://karvi.fi/en/',
     'Finnish Education Evaluation Centre', 'ministry', 'FI', null, null),
  ('web_ibo', 'International Baccalaureate', 'https://www.ibo.org',
     'International Baccalaureate', 'curriculum_body', null, null, null)
) v(k, title, url, publisher, st, c, pub, notes)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Education bodies  (id = md5('FI/body/<key>')::uuid)
-- -----------------------------------------------------------------------------
insert into edu.education_bodies (id, code, name, local_name, body_type, level, country_iso2, url, verification_status) values
  (md5('FI/body/okm')::uuid,   'FI-OKM',   'Ministry of Education and Culture',        'Opetus- ja kulttuuriministeriö',          'ministry',            'national',      'FI', 'https://okm.fi/en',                     'needs_verification'),
  (md5('FI/body/oph')::uuid,   'FI-EDUFI', 'Finnish National Agency for Education',    'Opetushallitus',                          'national_agency',     'national',      'FI', 'https://www.oph.fi/en',                 'needs_verification'),
  (md5('FI/body/ytl')::uuid,   'FI-YTL',   'Matriculation Examination Board',          'Ylioppilastutkintolautakunta',            'exam_board',          'national',      'FI', 'https://www.ylioppilastutkinto.fi/en',  'needs_verification'),
  (md5('FI/body/karvi')::uuid, 'FI-KARVI', 'Finnish Education Evaluation Centre',      'Kansallinen koulutuksen arviointikeskus', 'national_agency',     'national',      'FI', 'https://karvi.fi/en/',                  'needs_verification'),
  (md5('INT/body/ibo')::uuid,  'IBO',      'International Baccalaureate Organization', null,                                      'curriculum_provider', 'international', null, 'https://www.ibo.org',                   'needs_verification')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. Grading systems  (id = md5('FI/grading/<key>')::uuid)
-- -----------------------------------------------------------------------------
insert into edu.grading_systems (id, country_iso2, name, scale_description, best_grade, lowest_pass_grade, verification_status) values
  (md5('FI/grading/4_10')::uuid, 'FI', '4-10 scale (basic and general upper secondary education)',
     '10 excellent, 9 very good, 8 good, 7 satisfactory, 6 moderate, 5 adequate, 4 fail. Some courses are assessed pass/fail.',
     '10', '5', 'needs_verification'),
  (md5('FI/grading/matric')::uuid, 'FI', 'Matriculation examination grades',
     'L laudatur, E eximia cum laude approbatur, M magna cum laude approbatur, C cum laude approbatur, B lubenter approbatur, A approbatur, I improbatur (fail).',
     'L', 'A', 'needs_verification'),
  (md5('FI/grading/voc_1_5')::uuid, 'FI', '1-5 scale (vocational qualifications)',
     '1-5 numerical scale used for vocational upper secondary qualifications.',
     '5', '1', 'needs_verification'),
  (md5('FI/grading/he_0_5')::uuid, 'FI', '0-5 scale (higher education)',
     '1-5 pass grades, 0 fail.',
     '5', '1', 'needs_verification')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 4. Country profile
-- -----------------------------------------------------------------------------
insert into edu.country_profiles (
  country_iso2, overview, is_decentralised,
  compulsory_start_age, compulsory_end_age, compulsory_years, compulsory_notes,
  academic_year_start_month, academic_year_end_month, term_structure_code,
  grading_system_id, ministry_id,
  private_enrollment_pct, private_enrollment_year,
  public_spending_pct_gdp, public_spending_year,
  literacy_rate_pct, literacy_rate_year,
  verification_status)
values (
  'FI',
  'Finland has a single-structure basic education (perusopetus, grades 1-9) followed by general (lukio) or vocational upper secondary education. '
  || 'Since 1 August 2021 compulsory education lasts until age 18 or completion of an upper secondary qualification. '
  || 'Education is free from pre-primary to upper secondary; early childhood education and care carries income-related fees. '
  || 'Finnish and Swedish are the main languages of instruction, with Sámi used in the Sámi homeland. '
  || 'Non-state schools are few (about 3% of basic-level enrolments) and are publicly funded. '
  || 'The school year starts in August and ends on the last weekday of week 22 (late May or early June).',
  false,
  6, 18, 12,
  'Pre-primary education is mandatory in the year before basic education (usually the year the child turns 6). '
  || 'Compulsory education proper starts in the year the child turns 7 and ends at 18 or on completing an upper secondary qualification. '
  || 'Finland has compulsory education, not compulsory school attendance: home education is permitted.',
  8, null, 'two_semesters',
  md5('FI/grading/4_10')::uuid, md5('FI/body/okm')::uuid,
  null, null,
  6.38, 2022,
  null, null,
  'needs_verification')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 5. Languages of instruction
-- -----------------------------------------------------------------------------
insert into edu.instruction_languages (country_iso2, language_code, scope, notes) values
  ('FI', 'fi', 'main',                 null),
  ('FI', 'sv', 'main',                 null),
  ('FI', 'se', 'regional',             'Sámi languages are used as a language of instruction in some schools in the Sámi-speaking areas.'),
  ('FI', 'en', 'bilingual_programmes', 'General upper secondary education in English offered from August 2026.')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 6. Education stages  (id = md5('FI/stage/<key>')::uuid)
-- -----------------------------------------------------------------------------
insert into edu.education_stages (
  id, country_iso2, name, local_name, stage_type_code, isced_from, isced_to, orientation_code,
  start_age, end_age, grades_label, duration_years, is_compulsory, is_free_public, sort_order, notes, verification_status)
values
  (md5('FI/stage/ecec')::uuid, 'FI', 'Early childhood education and care', 'Varhaiskasvatus',
     'early_childhood', '0', '0', null, null, 6, null, null, false, false, 1,
     'Optional. Municipal fees depend on family income, family size and hours of attendance.', 'needs_verification'),
  (md5('FI/stage/preprimary')::uuid, 'FI', 'Pre-primary education', 'Esiopetus',
     'early_childhood', '0', '0', null, 6, 7, null, 1, true, true, 2,
     'Mandatory since August 2015 in the year before basic education. About four hours a day.', 'needs_verification'),
  (md5('FI/stage/basic')::uuid, 'FI', 'Basic education', 'Perusopetus',
     'basic_combined', '1', '2', 'general', 7, 16, '1-9', 9, true, true, 3,
     'Single structure covering primary (grades 1-6) and lower secondary (grades 7-9). Textbooks and materials are free.', 'needs_verification'),
  (md5('FI/stage/lukio')::uuid, 'FI', 'General upper secondary education', 'Lukio',
     'upper_secondary', '3', '3', 'general', 16, 19, null, 3, true, true, 4,
     'Typically three years, ending with the matriculation examination. Compulsory until 18 since August 2021.', 'needs_verification'),
  (md5('FI/stage/vocational')::uuid, 'FI', 'Vocational upper secondary education', 'Ammatillinen koulutus',
     'upper_secondary', '3', '3', 'vocational', 16, null, null, 3, true, true, 5,
     'Leads to a vocational upper secondary qualification. Compulsory until 18 since August 2021.', 'needs_verification'),
  (md5('FI/stage/uas')::uuid, 'FI', 'Universities of applied sciences', 'Ammattikorkeakoulu',
     'tertiary_bachelor', '6', '7', null, null, null, null, null, false, null, 6,
     'Free for EU/EEA students; non-EU/EEA students pay fees for most English-taught programmes (since 2017).', 'needs_verification'),
  (md5('FI/stage/university')::uuid, 'FI', 'Universities', 'Yliopisto',
     'tertiary_bachelor', '6', '8', null, null, null, null, null, false, null, 7,
     'Bachelor''s, master''s and doctoral degrees. Doctoral programmes are free for all; non-EU/EEA fees apply to most English-taught bachelor''s and master''s programmes.', 'needs_verification')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 7. Curricula
-- -----------------------------------------------------------------------------
insert into edu.curricula (code, name, provider, curriculum_type, parent_code, country_iso2, url, sort_order) values
  ('fi_national', 'Finnish national core curriculum', 'Finnish National Agency for Education', 'national', 'national', 'FI', 'https://www.oph.fi/en', 1)
on conflict do nothing;

insert into edu.country_curricula (country_iso2, curriculum_code, school_count, school_count_as_of, notes) values
  ('FI', 'fi_national', null, null, 'Set nationally; municipalities and schools draw up local curricula from it.'),
  ('FI', 'ib',          null, null, 'IB programmes are offered by both municipal upper secondary schools and international schools.'),
  ('FI', 'ib_pyp',      null, null, null),
  ('FI', 'ib_myp',      null, null, null),
  ('FI', 'ib_dp',       null, null, null)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 8. School types found in Finland  (id = md5('FI/cst/<key>')::uuid)
-- -----------------------------------------------------------------------------
insert into edu.country_school_types (
  id, country_iso2, school_type_code, local_name, description,
  management_type_code, funding_type_code, fee_policy_code, governing_body_id,
  isced_from, isced_to, number_of_schools, number_of_schools_year, legal_status_notes, sort_order, verification_status)
values
  (md5('FI/cst/municipal')::uuid, 'FI', 'public', 'Kunnallinen koulu (municipal school)',
     'Most schools are maintained by municipalities or joint municipal authorities.',
     'government', 'public', 'free', md5('FI/body/oph')::uuid, '0', '3', null, null, null, 1, 'needs_verification'),
  (md5('FI/cst/private')::uuid, 'FI', 'public_autonomous', 'Yksityiskoulu (private school)',
     'Privately run schools operating under a government licence and funded on the same per-pupil basis as municipal schools. About 3% of basic-level enrolments.',
     'government_aided', 'public', 'free', null, '1', '3', null, null,
     'Need a government licence; may not charge tuition fees for basic education or operate for profit. Moderate fees are allowed only in specific cases (e.g. education abroad or in another language).',
     2, 'needs_verification'),
  (md5('FI/cst/steiner')::uuid, 'FI', 'alternative', 'Steinerkoulu (Steiner school)',
     'Steiner/Waldorf schools and kindergartens are private institutions, partly co-financed by the state when they meet national requirements.',
     'private', 'mixed', null, null, '0', '3', null, null, null, 3, 'needs_verification'),
  (md5('FI/cst/international')::uuid, 'FI', 'international', 'International schools and IB programmes',
     'Includes fee-paying international schools (e.g. International School of Helsinki: IB PYP, MYP, DP) and IB Diploma lines in municipal upper secondary schools.',
     null, null, 'varies', null, '0', '3', null, null, null, 4, 'needs_verification'),
  (md5('FI/cst/vocational')::uuid, 'FI', 'vocational', 'Ammatillinen oppilaitos (vocational institution)',
     'Provides vocational upper secondary qualifications.',
     null, 'public', 'free', null, '3', '3', null, null, null, 5, 'needs_verification'),
  (md5('FI/cst/home')::uuid, 'FI', 'homeschool', 'Kotiopetus (home education)',
     'Permitted because Finland requires education, not school attendance. Rare in practice.',
     null, null, null, null, '1', '2', null, null,
     'No permit needed: guardians notify the municipality of residence, which monitors progress through an assigned teacher against curriculum goals.',
     6, 'needs_verification'),
  (md5('FI/cst/daycare')::uuid, 'FI', 'early_childhood', 'Päiväkoti (day-care centre)',
     'Early childhood education and care. Municipal fees depend on family income, family size and weekly hours.',
     null, null, 'varies', null, '0', '0', null, null, null, 7, 'needs_verification'),
  (md5('FI/cst/university')::uuid, 'FI', 'higher_ed_university', 'Yliopisto (university)',
     'Research universities awarding bachelor''s, master''s and doctoral degrees.',
     null, 'public', 'varies', md5('FI/body/okm')::uuid, '6', '8', 13, 2021,
     'Tuition free for EU/EEA students; non-EU/EEA students pay fees for most English-taught programmes since 2017.',
     8, 'needs_verification'),
  (md5('FI/cst/uas')::uuid, 'FI', 'higher_ed_college', 'Ammattikorkeakoulu (university of applied sciences)',
     'Professionally oriented higher education institutions awarding bachelor''s and master''s degrees.',
     null, 'public', 'varies', md5('FI/body/okm')::uuid, '6', '7', 22, 2021,
     'Tuition free for EU/EEA students; non-EU/EEA students pay fees for most English-taught programmes since 2017.',
     9, 'needs_verification')
on conflict do nothing;

insert into edu.country_school_type_curricula (country_school_type_id, curriculum_code) values
  (md5('FI/cst/municipal')::uuid,     'fi_national'),
  (md5('FI/cst/municipal')::uuid,     'ib_dp'),
  (md5('FI/cst/private')::uuid,       'fi_national'),
  (md5('FI/cst/international')::uuid, 'ib_pyp'),
  (md5('FI/cst/international')::uuid, 'ib_myp'),
  (md5('FI/cst/international')::uuid, 'ib_dp')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 9. Qualifications  (id = md5('FI/qual/<key>')::uuid)
-- -----------------------------------------------------------------------------
insert into edu.qualifications (id, name, local_name, country_iso2, isced_code, orientation_code, awarding_body_id, curriculum_code, verification_status) values
  (md5('FI/qual/basic_cert')::uuid, 'Basic education certificate', 'Perusopetuksen päättötodistus',
     'FI', '2', 'general', null, 'fi_national', 'needs_verification'),
  (md5('FI/qual/matric')::uuid, 'Matriculation examination certificate', 'Ylioppilastutkintotodistus',
     'FI', '3', 'general', md5('FI/body/ytl')::uuid, 'fi_national', 'needs_verification'),
  (md5('FI/qual/voc')::uuid, 'Vocational upper secondary qualification', 'Ammatillinen perustutkinto',
     'FI', '3', 'vocational', null, null, 'needs_verification'),
  (md5('INT/qual/ib_dp')::uuid, 'IB Diploma', null,
     null, '3', 'general', md5('INT/body/ibo')::uuid, 'ib_dp', 'needs_verification')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 10. Citations: which source backs which row / field
--     entity keys like 'FI/stage/basic' are converted to their md5 uuid.
-- -----------------------------------------------------------------------------
insert into core.record_sources (id, entity_table, entity_id, field_name, source_id)
select md5(concat_ws('|', t, e, f, s))::uuid,
       t,
       case when e like 'FI/%' or e like 'INT/%' then md5(e)::uuid::text else e end,
       f,
       md5('FI/src/' || s)::uuid
from (values
  -- country profile
  ('edu.country_profiles', 'FI', 'compulsory_end_age',        'eury_compulsory18'),
  ('edu.country_profiles', 'FI', 'compulsory_start_age',      'eury_ecec'),
  ('edu.country_profiles', 'FI', 'compulsory_start_age',      'okm_preprimary'),
  ('edu.country_profiles', 'FI', 'compulsory_years',          'eury_compulsory18'),
  ('edu.country_profiles', 'FI', 'compulsory_notes',          'eury_structure'),
  ('edu.country_profiles', 'FI', 'academic_year_start_month', 'eury_school_time'),
  ('edu.country_profiles', 'FI', 'term_structure_code',       'hollola_calendar'),
  ('edu.country_profiles', 'FI', 'grading_system_id',         'eury_assess_basic'),
  ('edu.country_profiles', 'FI', 'ministry_id',               'web_okm'),
  ('edu.country_profiles', 'FI', 'public_spending_pct_gdp',   'wb_spending'),
  ('edu.country_profiles', 'FI', 'overview',                  'gem_peer_nsa'),
  ('edu.country_profiles', 'FI', 'overview',                  'hollola_calendar'),
  ('edu.country_profiles', 'FI', 'overview',                  'eury_funding'),
  ('edu.country_profiles', 'FI', 'instruction_languages',     'norden_basic'),
  ('edu.country_profiles', 'FI', 'instruction_languages',     'eury_english_2026'),
  -- stages
  ('edu.education_stages', 'FI/stage/ecec',       null, 'eury_funding'),
  ('edu.education_stages', 'FI/stage/preprimary', null, 'eury_ecec'),
  ('edu.education_stages', 'FI/stage/preprimary', null, 'okm_preprimary'),
  ('edu.education_stages', 'FI/stage/basic',      null, 'eury_structure'),
  ('edu.education_stages', 'FI/stage/basic',      null, 'eury_assess_basic'),
  ('edu.education_stages', 'FI/stage/lukio',      null, 'eury_structure'),
  ('edu.education_stages', 'FI/stage/lukio',      null, 'eury_compulsory18'),
  ('edu.education_stages', 'FI/stage/vocational', null, 'eury_structure'),
  ('edu.education_stages', 'FI/stage/vocational', null, 'eury_compulsory18'),
  ('edu.education_stages', 'FI/stage/uas',        null, 'sif_2021'),
  ('edu.education_stages', 'FI/stage/uas',        null, 'eury_tuition'),
  ('edu.education_stages', 'FI/stage/university', null, 'sif_2021'),
  ('edu.education_stages', 'FI/stage/university', null, 'eury_tuition'),
  -- school types
  ('edu.country_school_types', 'FI/cst/municipal',     null, 'eury_funding'),
  ('edu.country_school_types', 'FI/cst/private',       null, 'eury_funding'),
  ('edu.country_school_types', 'FI/cst/private',       null, 'gem_peer_nsa'),
  ('edu.country_school_types', 'FI/cst/steiner',       null, 'iaswece_fi'),
  ('edu.country_school_types', 'FI/cst/international', null, 'ibo_ish'),
  ('edu.country_school_types', 'FI/cst/vocational',    null, 'eury_structure'),
  ('edu.country_school_types', 'FI/cst/home',          null, 'eury_structure'),
  ('edu.country_school_types', 'FI/cst/home',          null, 'eur_agency_fi'),
  ('edu.country_school_types', 'FI/cst/daycare',       null, 'eury_funding'),
  ('edu.country_school_types', 'FI/cst/university',    'number_of_schools', 'sif_2021'),
  ('edu.country_school_types', 'FI/cst/university',    'legal_status_notes', 'eury_tuition'),
  ('edu.country_school_types', 'FI/cst/uas',           'number_of_schools', 'sif_2021'),
  ('edu.country_school_types', 'FI/cst/uas',           'legal_status_notes', 'eury_tuition'),
  -- curricula
  ('edu.country_curricula', 'FI:fi_national', null, 'web_oph'),
  ('edu.country_curricula', 'FI:ib',          null, 'ibo_ish'),
  ('edu.country_curricula', 'FI:ib_pyp',      null, 'ibo_ish'),
  ('edu.country_curricula', 'FI:ib_myp',      null, 'ibo_ish'),
  ('edu.country_curricula', 'FI:ib_dp',       null, 'ibo_ish'),
  -- bodies
  ('edu.education_bodies', 'FI/body/okm',   null, 'web_okm'),
  ('edu.education_bodies', 'FI/body/oph',   null, 'web_oph'),
  ('edu.education_bodies', 'FI/body/ytl',   null, 'web_ytl'),
  ('edu.education_bodies', 'FI/body/karvi', null, 'web_karvi'),
  ('edu.education_bodies', 'INT/body/ibo',  null, 'web_ibo'),
  -- grading systems
  ('edu.grading_systems', 'FI/grading/4_10',    null, 'eury_assess_basic'),
  ('edu.grading_systems', 'FI/grading/4_10',    null, 'eury_assess_upsec'),
  ('edu.grading_systems', 'FI/grading/matric',  null, 'eury_assess_upsec'),
  ('edu.grading_systems', 'FI/grading/voc_1_5', null, 'norden_grading'),
  ('edu.grading_systems', 'FI/grading/he_0_5',  null, 'norden_grading'),
  -- qualifications
  ('edu.qualifications', 'FI/qual/basic_cert', null, 'eury_assess_basic'),
  ('edu.qualifications', 'FI/qual/matric',     null, 'eury_assess_upsec'),
  ('edu.qualifications', 'FI/qual/matric',     null, 'web_ytl'),
  ('edu.qualifications', 'FI/qual/voc',        null, 'eury_structure'),
  ('edu.qualifications', 'INT/qual/ib_dp',     null, 'web_ibo')
) v(t, e, f, s)
on conflict do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Known gaps (left NULL on purpose, fill when a source is found):
--   * academic_year_end_month: ends last weekday of ISO week 22, so May or June
--   * private_enrollment_pct: GEM PEER gives ~3% of basic enrolments but no year
--   * literacy_rate_pct: World Bank/UIS publish no value for Finland
--   * number of IB schools per programme (country_curricula.school_count)
--   * special schools (state special schools / Valteri): no source found yet
-- -----------------------------------------------------------------------------
