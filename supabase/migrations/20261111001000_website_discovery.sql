-- =============================================================================
-- Migration 10: Website content checks and discovery
-- -----------------------------------------------------------------------------
--   * website_status 'mismatch': the page works but is not this institution's
--     (parked domain, error page served with HTTP 200, unrelated site).
--   * website_found_by: where the published address came from:
--       'source'     the dataset's own website value
--       'discovered' found by the checker on the institution's official
--                    academic domain (e.g. acronym + .ac.in) and verified by
--                    the page naming the institution.
--   * The checker now also visits institutions WITHOUT a website (to discover
--     one), so the check index covers every row.
-- =============================================================================

alter table edu.schools drop constraint if exists schools_website_status_check;
alter table edu.schools
  add constraint schools_website_status_check
  check (website_status in ('ok', 'restricted', 'broken', 'mismatch'));

alter table edu.schools
  add column website_found_by text check (website_found_by in ('source', 'discovered'));

drop index if exists edu.schools_website_check_idx;
create index schools_website_check_idx on edu.schools (website_checked_at nulls first, id);

-- Reset also clears how the address was found.
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
    new.website_found_by := null;
  end if;
  return new;
end;
$$;
