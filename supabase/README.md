# School Systems Directory: Supabase database

Schema for the School Systems Directory. It has two Postgres schemas:

| Schema | Purpose | Reused by future apps? |
|---|---|---|
| `core` | Continents, regions, countries, subdivisions, languages, currencies, sources/citations | **Yes**: universities, healthcare, visas… |
| `edu`  | Education lookups, country education systems, individual schools | No (school directory only) |

## Files

```
supabase/
  migrations/
    20261107000100_core_schema.sql            shared geography + citation tables
    20261107000200_edu_lookups.sql            ISCED, school types, curricula, bodies…
    20261107000300_edu_systems_and_schools.sql country profiles, stages, schools, view
    20261107000400_security.sql               RLS (public read-only) + grants
  seed.sql                                    lookup values + 20 pilot countries
  README.md
```

Tested on PostgreSQL 16. New Supabase projects run 15 or later, which is required for
`unique nulls not distinct` and `security_invoker` views.

## Setup

### Option A: Supabase dashboard (quickest)
1. Create a project at supabase.com (free plan).
2. Open **SQL Editor**, then paste and run each file in `migrations/` **in order**, then `seed.sql`.
3. Expose the new schemas to the API: in the project's **Data API / API settings**,
   add `core` and `edu` to **Exposed schemas** (they're not exposed by default).

### Option B: Supabase CLI (recommended once you're coding)
```bash
npm install -g supabase          # or: npx supabase …
supabase login
supabase link --project-ref <your-project-ref>
supabase db push                 # applies migrations/ in order
psql "<connection string>" -f supabase/seed.sql
```
For a local copy (needs Docker): `supabase start` then `supabase db reset` (runs migrations + seed).
Also add `core` and `edu` to `[api] schemas` in `supabase/config.toml`.

## Querying from Next.js

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!   // anon key only, never service_role
);

// Browse/compare cards
const { data } = await supabase.schema('edu').from('v_country_overview').select('*');

// Countries offering the IB Diploma
const { data: ib } = await supabase.schema('edu')
  .from('country_curricula').select('country_iso2').eq('curriculum_code', 'ib_dp');
```

## Table map

```
core.continents ─< core.regions ─< core.countries ─< core.subdivisions
                                        │
core.sources ─< core.record_sources     │   (citations for any edu row)
                                        │
edu.country_profiles (1:1) ─────────────┤   ages, calendar, key stats
edu.instruction_languages ──────────────┤
edu.education_stages ───────────────────┤   → isced_levels, stage_types
edu.country_school_types ───────────────┤   → school_types, management/funding/fee…
   └─< edu.country_school_type_curricula    → curricula
edu.country_curricula ──────────────────┤
edu.education_bodies ───────────────────┤   ministries, exam boards, accreditors
edu.schools ────────────────────────────┘   → all classification lookups
   ├─< school_curricula / school_languages
   └─< school_special_needs / school_accreditations
```

## Data rules

- **NULL means unknown.** Never fill a value you can't source.
- Every fact-bearing table has `verification_status` (`draft` → `needs_verification` → `verified`) and `last_verified`.
- Statistics have a matching `*_year` column; always fill both.
- Cite with a `core.sources` row plus a `core.record_sources` link (template at the bottom of `seed.sql`).
- A country appears in the app only when `core.countries.is_active = true`.
- Store **codes** (`boarding`), not labels, in data tables.

## Security

- RLS is on for every table: anyone can **read**, nobody can **write** through the API.
- Load and edit data with the dashboard or scripts using the **service_role** key, server-side only.
- Every new table needs RLS. This query lists any table that's missing it:

```sql
select schemaname, tablename from pg_tables
where schemaname in ('core','edu') and not rowsecurity;
```

## Adding a country (checklist)
1. Add its region to `core.regions` if missing, and the country to `core.countries`.
2. Add `edu.country_profiles`, `instruction_languages`, `education_stages`, `country_school_types`, `country_curricula`, each with sources.
3. Review, set `verification_status`, then `is_active = true`.
