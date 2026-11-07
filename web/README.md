# School Systems Directory: web app

This is a Next.js 16 app (App Router, TypeScript, Tailwind) with a Supabase backend. The database schema lives in `../supabase/`.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the project URL, the anon key and the service_role key. You'll find them under Supabase → Project Settings → API Keys.
3. Apply the migrations from the repo root: `supabase db push`
4. Create an admin:
   - Go to Supabase → **Authentication → Users → Add user** and enter an email and password, with "Auto confirm" ticked.
   - Then in the **SQL Editor**:
     ```sql
     insert into core.admin_users (user_id, email)
     select id, email from auth.users where email = 'you@example.com';
     ```
5. `npm run dev`, then open http://localhost:3000/admin and sign in.

## Data sync

On `/admin`, choose the sources you want, then:
- **Preview changes** shows what would be inserted, updated or flagged, and writes nothing.
- **Sync data** fetches the data and writes it to Supabase. Each run is logged in `core.sync_runs`.

Sources, data-file formats and how to add a new source: [data/README.md](data/README.md).

The same sync from the command line (maintainers only; uses `.env.local`):

```bash
npm run sync                     # preview all sources
npm run sync -- world_bank       # preview one source
npm run sync -- --apply          # write
```

## Code map

```
src/
  proxy.ts                   refreshes the Supabase session cookie
  lib/env.ts                 environment variables
  lib/auth.ts                getAdminCheck / requireAdmin
  lib/supabase/server.ts     client as the signed-in user (RLS applies)
  lib/supabase/admin.ts      service_role client (server only, bypasses RLS)
  lib/sync/
    runner.ts                runSync: lock, run sources, log to core.sync_runs
    registry.ts              list of sources shown on /admin
    upsert.ts                syncRows: diff-based insert/update, dry-run aware
    citations.ts             core.sources / core.record_sources helpers
    profile-facts.ts         statistics writer with conflict rules
    http.ts, csv.ts, ids.ts  fetch with retry, CSV parser, stable ids
    sources/                 country-files, local-csv, world-bank, unesco-uis
  app/admin/                 admin page, Sync panel, server actions
  app/login/                 email + password sign-in
data/
  countries/*.json           researched country data
  stats/*.csv                any other local statistics
```

## Security notes

- The `service_role` key is only read in `src/lib/supabase/admin.ts`. That file imports `server-only`, so the build fails if it ever ends up in browser code.
- Every Server Action calls `requireAdmin()` itself. Hiding the button isn't a security boundary.
- `core.admin_users` and `core.sync_runs` aren't publicly readable. RLS lets an admin read only their own admin row and the sync history.
