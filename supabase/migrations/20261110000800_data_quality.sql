-- =============================================================================
-- Migration 8: Data quality for institutions (websites and phone numbers)
-- -----------------------------------------------------------------------------
--   * edu.schools: result of the website check, and where the phone came from.
--   * edu.v_institutions: shows a website only after it passed the check.
-- =============================================================================

alter table edu.schools
  -- ok         = page loads (2xx, possibly after redirects)
  -- restricted = site exists but refuses automated checks (401/403/429)
  -- broken     = 404/410/5xx, DNS or TLS failure, timeout
  add column website_status      text check (website_status in ('ok', 'restricted', 'broken')),
  add column website_http_status smallint,
  add column website_checked_at  timestamptz,
  -- the address that actually worked (after redirects, or http:// when https:// fails)
  add column website_checked_url text check (website_checked_url is null or website_checked_url ~* '^https?://'),
  -- 'source' = the dataset we imported; 'website' = a tel: link on the institution's own site
  add column phone_source        text check (phone_source in ('source', 'website'));

-- The website checker picks never-checked rows first, then the oldest checks.
create index schools_website_check_idx on edu.schools (website_checked_at nulls first) where website is not null;

-- A new address invalidates the old check result: it must be checked again
-- before it is shown.
create or replace function edu.reset_website_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.website is distinct from old.website then
    new.website_status := null;
    new.website_http_status := null;
    new.website_checked_at := null;
    new.website_checked_url := null;
  end if;
  return new;
end;
$$;

create trigger schools_reset_website_check
  before update of website on edu.schools
  for each row execute function edu.reset_website_check();

-- Same columns as before; only the website expression changes: a link is
-- published only when the last check found it working.
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
left join edu.schools a           on a.id = s.affiliated_to_id;
