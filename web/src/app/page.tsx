import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import {
  buildOptions,
  filtersToHref,
  getFacets,
  getManagementOptions,
  hasAnyFilter,
  PAGE_SIZE,
  parseFilters,
  searchInstitutions,
  type Filters,
  type InstitutionRow,
} from '@/lib/directory';
import { SearchForm } from './search-form';

const fmt = new Intl.NumberFormat('en');

export default function Home({ searchParams }: PageProps<'/'>) {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Find a school, college or university</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Search by name, country, state, city and type. No sign-up needed.
        </p>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Loading search…</p>}>
        <SearchArea searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Reads the URL filters, so it renders per request behind the Suspense boundary. */
async function SearchArea({ searchParams }: { searchParams: PageProps<'/'>['searchParams'] }) {
  const filters = parseFilters(await searchParams);
  await connection();

  let facets, management;
  try {
    [facets, management] = await Promise.all([getFacets(), getManagementOptions()]);
  } catch (err) {
    console.error(err);
    return <Notice>The directory is not available right now. Please try again later.</Notice>;
  }

  const options = buildOptions(facets, filters);
  if (options.total === 0) {
    return <Notice>No institutions have been published yet. Please check back soon.</Notice>;
  }

  const href = filtersToHref(filters);
  return (
    <div className="space-y-6">
      {/* keys change with the URL: the form resets its default values and the
          results show "Searching…" again. Sibling keys must differ. */}
      <SearchForm key={`form:${href}`} filters={filters} management={management} {...options} />
      <Suspense key={`results:${href}`} fallback={<p className="text-zinc-500">Searching…</p>}>
        <Results filters={filters} />
      </Suspense>
    </div>
  );
}

async function Results({ filters }: { filters: Filters }) {
  let result;
  try {
    result = await searchInstitutions(filters);
  } catch (err) {
    console.error(err);
    return <Notice>Search failed. Please try again.</Notice>;
  }
  const { rows, total } = result;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total === 0) {
    return (
      <Notice>
        No results{hasAnyFilter(filters) ? ' for these filters' : ''}. Try a shorter name or fewer filters.
      </Notice>
    );
  }

  const start = (filters.page - 1) * PAGE_SIZE + 1;
  return (
    <section aria-label="Search results" className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {fmt.format(total)} result{total === 1 ? '' : 's'}
        {rows.length > 0 && ` · showing ${fmt.format(start)}–${fmt.format(start + rows.length - 1)}`}
      </p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <ResultCard key={r.id} row={r} />
        ))}
      </ul>
      <Pagination filters={filters} pages={pages} />
    </section>
  );
}

function ResultCard({ row }: { row: InstitutionRow }) {
  const place = [row.city, row.district, row.subdivision_name, row.country_name].filter(Boolean).join(', ');
  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          <Link href={`/institutions/${row.id}`} className="hover:underline">
            {row.name}
          </Link>
        </h2>
        <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {row.school_type_label}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{place}</p>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {row.local_type && <Item label="Category">{row.local_type}</Item>}
        {row.management_label && <Item label="Management">{row.management_label}</Item>}
        {row.year_established && <Item label="Established">{row.year_established}</Item>}
        {row.affiliated_to_id && row.affiliated_to_name && (
          <Item label="Affiliated to">
            <Link href={`/institutions/${row.affiliated_to_id}`} className="underline">
              {row.affiliated_to_name}
            </Link>
          </Item>
        )}
        {row.website && (
          <Item label="Website">
            <a href={row.website} target="_blank" rel="noopener noreferrer nofollow" className="underline">
              {row.website.replace(/^https?:\/\//, '')}
            </a>
          </Item>
        )}
      </dl>
    </li>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt className="text-zinc-500">{label}:</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Pagination({ filters, pages }: { filters: Filters; pages: number }) {
  if (pages <= 1) return null;
  const prev = filters.page > 1 ? filtersToHref(filters, { page: filters.page - 1 }) : null;
  const next = filters.page < pages ? filtersToHref(filters, { page: filters.page + 1 }) : null;
  const linkClass = 'rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900';
  return (
    <nav aria-label="Pages" className="flex items-center justify-between">
      {prev ? (
        <Link href={prev} className={linkClass}>
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        Page {fmt.format(filters.page)} of {fmt.format(pages)}
      </span>
      {next ? (
        <Link href={next} className={linkClass}>
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-zinc-50 p-4 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{children}</p>;
}
