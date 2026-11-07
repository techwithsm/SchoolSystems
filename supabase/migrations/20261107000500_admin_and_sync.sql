-- =============================================================================
-- Migration 5: Admin users + data-sync run log
-- -----------------------------------------------------------------------------
--   core.admin_users  who may use the admin area (e.g. the "Sync data" button)
--   core.sync_runs    one row per sync: who ran it, status, per-source summary
--
-- Writes to both tables happen server-side with the service_role key only.
-- NOTE: unlike the reference tables, these are NOT publicly readable.
-- =============================================================================

create table core.admin_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

create table core.sync_runs (
  id            uuid primary key default gen_random_uuid(),
  source_keys   text[] not null,
  status        text not null default 'running'
                  check (status in ('running', 'succeeded', 'partial', 'failed')),
  triggered_by  uuid references auth.users (id) on delete set null,
  dry_run       boolean not null default false,   -- preview run: nothing was written
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  summary       jsonb,          -- per-source counts, conflicts, warnings
  error         text
);
create index sync_runs_started_idx on core.sync_runs (started_at desc);

-- At most one sync may run at a time (the runner fails fast on this index).
create unique index sync_runs_one_running_idx on core.sync_runs ((true)) where status = 'running';

-- ---------------------------------------------------------------------------
-- RLS
-- Migration 4 set default privileges (anon/authenticated get SELECT on new
-- tables), so RLS policies are what keep these tables private.
-- ---------------------------------------------------------------------------
alter table core.admin_users enable row level security;
alter table core.sync_runs  enable row level security;

-- A signed-in user can see only their own admin row (used for the admin check).
create policy "Admins can read own row" on core.admin_users
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Admins can read the sync history.
create policy "Admins can read sync runs" on core.sync_runs
  for select to authenticated
  using (exists (select 1 from core.admin_users a where a.user_id = (select auth.uid())));

-- Anonymous visitors get nothing from either table.
revoke all on core.admin_users from anon;
revoke all on core.sync_runs  from anon;
