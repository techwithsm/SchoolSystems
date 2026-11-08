# Local data for the "Sync data" button

The admin page (`/admin`) runs these sources in order:

| Source | Reads | Writes |
|---|---|---|
| Country data files | `countries/<ISO2>.json` | Every `edu` table for that country, plus sources and citations |
| Local CSV statistics | `stats/*.csv` | Statistic fields of `edu.country_profiles`, plus sources and citations |
| World Bank indicators | World Bank API | Spending % of GDP, literacy rate, private primary enrolment %, each with its year |
| UNESCO UIS | UIS Data API | Compulsory education duration and entrance age |
| India: colleges & universities (Wikidata) | Wikidata SPARQL (items with an AISHE code, CC0) | `edu.schools`: about 24,000 Indian institutions, using the same ids as the AISHE file |
| United States: colleges & universities (IPEDS) | NCES IPEDS directory file (HD, downloaded automatically, public domain) | `edu.schools`: about 4,000 active degree-granting institutions with address, phone, website and location; `core.subdivisions`: US states and territories |
| Canada: colleges & universities (Wikidata) | Wikidata SPARQL (CC0) | `edu.schools`: Canadian universities, colleges, CEGEPs; `core.subdivisions`: provinces and territories |
| Mexico: colleges & universities (SEP) | SEP Catálogo de centros de trabajo, 32 state CSVs on datos.gob.mx (CC BY 4.0) | `edu.schools`: active universities, technological institutes and teacher-training colleges, with address and location; `core.subdivisions`: states. Contact-person columns are never read |
| Nigeria / Egypt: colleges & universities (Wikidata) | Wikidata SPARQL (CC0) | `edu.schools`: Nigerian universities, polytechnics, colleges of education; Egyptian universities and institutes. Adds Egypt to `core.countries` (inactive) and the states/governorates to `core.subdivisions` |
| India: more colleges & universities (Wikidata, no AISHE code) | Wikidata SPARQL (CC0) | `edu.schools`: ~2,900 Indian institutions in Wikidata that have no AISHE code yet (keyed by Wikidata id); names already listed in the same state are skipped |
| Mexico: more colleges & universities (Wikidata) | Wikidata SPARQL (CC0) | `edu.schools`: Mexican universities and institutes not already in the SEP register (name match within the state, or country-wide when Wikidata has no state) |
| India: colleges & universities (AISHE) | `india/aishe/*.xlsx` or `*.csv` | `edu.schools`: every Indian college, university and standalone institution (see [india/aishe/README.md](india/aishe/README.md)) |

Rules every source follows:
- **Rows that are new or changed** go back to `verification_status = 'needs_verification'`. Rows that haven't changed keep their status.
- **API and CSV sources never overwrite a value backed by a different source.** They report it as a *conflict* for you to review instead.
- **Nothing is deleted.** The only exception: a citation the country file no longer makes is removed.
- **Re-running is safe.** Ids are stable (`md5(key)::uuid`).

Wikidata sources skip faculties and departments that are part of another university, and skip names already listed from another source. There is no US Wikidata gap-filler: IPEDS already lists every accredited degree-granting institution, and the extra Wikidata items were mostly university departments, branch centres and unaccredited schools.

## `countries/<ISO2>.json`

See `countries/FI.json` for a complete example. The validation schema is `src/lib/sync/sources/country-file-schema.ts`.

- `sources` is a map of short key to source details. Entities cite sources with `"sources": ["key"]`, which covers the whole row, or `"field_sources": {"column": ["key"]}`, which covers one column.
- `key` values on bodies, grading systems, stages, school types and qualifications build stable ids:
  - A key without `/` is local to the country. `okm` in `FI.json` becomes `FI/body/okm`.
  - A key with `/` is shared across countries, e.g. `INT/body/ibo`.
- Leave a value `null` when you can't source it. Never guess.
- Only the profile columns you include are written. Leave out the statistics the APIs maintain.

## `stats/*.csv`

Use this for any other figures you have locally: one fact per row.

```csv
country_iso2,field,value,year,source_key,source_title,source_url,source_publisher,source_type,accessed_on,note
DE,private_enrollment_pct,9.1,2023,destatis_2024,Private schools 2023/24,https://www.destatis.de/...,Destatis,statistics_office,2026-11-07,
```

- `field` must be one of: `compulsory_start_age`, `compulsory_end_age`, `compulsory_years`, `academic_year_start_month`, `academic_year_end_month`, `private_enrollment_pct`, `public_spending_pct_gdp`, `literacy_rate_pct`.
- The three `*_pct` fields need a `year`.
- `source_type` is a `core.source_types` code: `ministry`, `unesco`, `eurydice`, `oecd`, `world_bank`, `curriculum_body`, `statistics_office`, `school_website` or `other`.

## Adding a new kind of source

1. Implement `SyncSource` (see `src/lib/sync/types.ts`) in `src/lib/sync/sources/`.
2. Reuse the helpers:
   - `fetchJson` for HTTP with retries.
   - `syncRows` for diff-based upserts.
   - `applyProfileFacts` for profile statistics, with conflict handling.
   - `upsertSources` and `upsertCitations` for citations.
3. Add it to `SYNC_SOURCES` in `src/lib/sync/registry.ts`. It then appears as a checkbox on `/admin`.
