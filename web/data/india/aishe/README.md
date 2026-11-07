# India: AISHE higher education directory

Put the official AISHE file(s) here, as `.xlsx` or `.csv`. The **India: colleges & universities (AISHE)** source on `/admin` imports every file in this folder.

## Where to get the file

1. Go to https://aikosh.indiaai.gov.in/home/datasets/details/all_colleges_as_per_aishe_dashboard_3.html (IndiaAI AIKosh, Ministry of Electronics & IT).
2. Sign in, or register for free, and click **Download**. You get a `.zip` file (about 4 MB).
3. Extract the zip and put the `.xlsx` or `.csv` file in this folder.

**Licence:** Government Open Data License - India. The data comes from the Ministry of Education's AISHE dashboard (https://dashboard.aishe.gov.in/hedirectory/).

You can optionally add a **universities** list as well. If the AISHE directory lets you export its University tab, put that file here too. Without it, universities are still created from the "Affiliated University" column of the colleges file.

## What gets imported

| Column in the file | Stored in `edu.schools` |
|---|---|
| AISHE Code | `external_id` (`external_id_scheme = 'AISHE'`) |
| Name of the Institution | `name` |
| State | `subdivision_code` (ISO 3166-2, e.g. `IN-MH`) |
| District | `district` |
| Year of Establishment | `year_established` |
| Location (Rural/Urban) | `locality_type_code` |
| College Type / University Type | `local_type`; `school_type_code` is `higher_ed_college` or `higher_ed_university` |
| Management | `management_type_code` (values that can't be mapped are left empty and reported) |
| Affiliated University Name | `affiliated_to_id`, which links the college to its university's row |
| Website, Address, City, Pincode, Phone, Email | the matching columns, **only if the file has them** |

Columns are matched by name. Title rows above the table and extra columns are fine. Phone, email and subjects aren't in the AISHE directory, so they stay empty.
