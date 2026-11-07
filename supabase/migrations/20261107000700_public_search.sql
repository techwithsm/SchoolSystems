-- =============================================================================
-- Migration 7: Public institution search (schools, colleges, universities)
-- -----------------------------------------------------------------------------
--   * edu.v_institutions        one row per institution with display labels
--   * edu.v_institution_facets  counts per country / state / type for filters
--   * trigram index so "name contains ..." searches stay fast at scale
--
-- Both views only include countries with core.countries.is_active = true
-- (same rule as edu.v_country_overview), and run with the caller's
-- permissions (security_invoker), so RLS public-read applies.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create index if not exists schools_name_trgm_idx
  on edu.schools using gin (name extensions.gin_trgm_ops);

create view edu.v_institutions with (security_invoker = true) as
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
  s.website,
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
left join edu.schools a           on a.id = s.affiliated_to_id;

create view edu.v_institution_facets with (security_invoker = true) as
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
group by s.country_iso2, c.name, s.subdivision_code, sd.name, s.school_type_code, st.label, st.sort_order;

grant select on edu.v_institutions, edu.v_institution_facets to anon, authenticated;
