-- =============================================================================
-- Migration 9: Title Case labels; hide records without a usable name
-- -----------------------------------------------------------------------------
--   * School-type and management labels shown on the site in Title Case.
--   * Public views skip institutions whose name has fewer than 3 letters
--     (e.g. '01'). Nothing is deleted; such rows stay for manual review.
-- =============================================================================

update edu.school_types set label = v.label
from (values
  ('public',               'Public / State School'),
  ('public_autonomous',    'Publicly Funded, Independently Run'),
  ('private',              'Private / Independent'),
  ('religious',            'Faith-Based'),
  ('international',        'International School'),
  ('boarding',             'Boarding School'),
  ('vocational',           'Vocational / Technical'),
  ('special_needs',        'Special Education'),
  ('alternative',          'Alternative Pedagogy'),
  ('selective',            'Selective / Gifted'),
  ('homeschool',           'Home Education'),
  ('online',               'Online / Virtual School'),
  ('early_childhood',      'Pre-Primary / Kindergarten'),
  ('higher_ed_university', 'University'),
  ('higher_ed_college',    'College / Community College / Polytechnic')
) as v(code, label)
where edu.school_types.code = v.code;

update edu.management_types set label = v.label
from (values
  ('government',       'Government'),
  ('government_aided', 'Government-Aided'),
  ('private',          'Private'),
  ('community',        'Community'),
  ('religious_body',   'Religious Body'),
  ('ngo',              'NGO / Non-Profit')
) as v(code, label)
where edu.management_types.code = v.code;

-- Views: same columns as before, plus the usable-name filter.
create or replace view edu.v_institutions with (security_invoker = true) as
select
  s.id,
  s.name,
  s.local_name,
  s.school_type_code,
  st.label            as school_type_label,
  s.local_type,
  s.management_type_code,
  mt.label            as management_label,
  s.country_iso2,
  c.name              as country_name,
  s.subdivision_code,
  sd.name             as subdivision_name,
  s.district,
  s.city,
  s.address_line,
  s.postal_code,
  s.latitude,
  s.longitude,
  s.phone,
  s.email,
  case when s.website_status in ('ok', 'restricted') then coalesce(s.website_checked_url, s.website) end as website,
  s.year_established,
  s.locality_type_code,
  s.enrollment,
  s.enrollment_year,
  s.external_id,
  s.external_id_scheme,
  s.status_code,
  s.affiliated_to_id,
  a.name              as affiliated_to_name,
  s.source_id,
  s.verification_status,
  s.last_verified
from edu.schools s
join core.countries c       on c.iso2 = s.country_iso2 and c.is_active
join edu.school_types st    on st.code = s.school_type_code
left join edu.management_types mt on mt.code = s.management_type_code
left join core.subdivisions sd    on sd.code = s.subdivision_code
left join edu.schools a           on a.id = s.affiliated_to_id
where s.name ~ '[[:alpha:]].*[[:alpha:]].*[[:alpha:]]';  -- hide names with no usable text (e.g. '01')

create or replace view edu.v_institution_facets with (security_invoker = true) as
select
  s.country_iso2,
  c.name              as country_name,
  s.subdivision_code,
  sd.name             as subdivision_name,
  s.school_type_code,
  st.label            as school_type_label,
  st.sort_order       as school_type_sort,
  count(*)::int       as institutions
from edu.schools s
join core.countries c    on c.iso2 = s.country_iso2 and c.is_active
join edu.school_types st on st.code = s.school_type_code
left join core.subdivisions sd on sd.code = s.subdivision_code
where s.name ~ '[[:alpha:]].*[[:alpha:]].*[[:alpha:]]'   -- hide names with no usable text (e.g. '01')
group by s.country_iso2, c.name, s.subdivision_code, sd.name, s.school_type_code, st.label, st.sort_order;
