-- =============================================================================
-- Migration 4: Security - Row Level Security (RLS) and API grants
-- -----------------------------------------------------------------------------
-- Model for the MVP:
--   * Anyone (anon key, logged in or not) can READ everything.
--   * Nobody can WRITE through the public API. Data is loaded with the
--     service_role key (scripts / Supabase dashboard), which bypasses RLS.
--   * Later, an 'editor' role can get write policies for admin mode.
--
-- NEVER put the service_role key in front-end code.
-- =============================================================================

-- Let the API roles see the schemas.
grant usage on schema core to anon, authenticated, service_role;
grant usage on schema edu  to anon, authenticated, service_role;

-- Read-only for public roles; full access for service_role.
grant select on all tables in schema core to anon, authenticated;
grant select on all tables in schema edu  to anon, authenticated;
grant all    on all tables in schema core to service_role;
grant all    on all tables in schema edu  to service_role;

-- Tables created in future migrations get the same defaults.
alter default privileges in schema core grant select on tables to anon, authenticated;
alter default privileges in schema edu  grant select on tables to anon, authenticated;
alter default privileges in schema core grant all    on tables to service_role;
alter default privileges in schema edu  grant all    on tables to service_role;

-- Enable RLS and add a public-read policy on EVERY base table in both schemas.
-- Done in a loop so new tables in this migration set can't be forgotten.
do $$
declare
  t record;
begin
  for t in
    select schemaname, tablename
    from pg_tables
    where schemaname in ('core', 'edu')
  loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
    execute format(
      'create policy "Public read access" on %I.%I for select to anon, authenticated using (true)',
      t.schemaname, t.tablename);
  end loop;
end;
$$;

-- REMINDER for future migrations: every new table needs
--   alter table ... enable row level security;
--   create policy "Public read access" ... for select ... using (true);
-- The check query in README.md lists any table that is missing RLS.
