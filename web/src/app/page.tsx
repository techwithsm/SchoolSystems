import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import { InstitutionDetailView } from '@/components/institution-detail';
import {
  buildOptions,
  filtersToHref,
  getFacets,
  getInstitution,
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
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-sky-950 sm:text-3xl">
          Find a school, college or university
        </h1>
        <p className="text-sky-700">Filter on the left, pick a result to see its details. No sign-up needed.</p>
      </header>
      <Suspense fallback={<Loading text="Loading search…" />}>
        <SearchArea searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Reads the URL, so it renders per request behind the Suspense boundary. */
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
  if (options.total === 0) return <Notice>No institutions have been published yet. Please check back soon.</Notice>;

  const searchKey = filtersToHref({ ...filters, sel: '' });
  return (
    // Widths: <640px stacked; 640-1023px filters | results (details inline under
    // the chosen result); >=1024px filters | results | details panel.
    <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[250px_minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-5">
      {/* Left: filters */}
      <aside className="panel-scroll sm:sticky sm:top-4 sm:max-h-[calc(100vh-2rem)] sm:self-start sm:overflow-auto">
        <SearchForm key={`form:${searchKey}`} filters={filters} management={management} {...options} />
      </aside>

      {/* Middle: results */}
      <section aria-label="Search results" className="min-w-0">
        <Suspense key={`results:${searchKey}:${filters.page}`} fallback={<Loading text="Searching…" />}>
          <Results filters={filters} />
        </Suspense>
      </section>

      {/* Right (desktop): details of the selected institution */}
      <aside
        aria-label="Details"
        className="panel-scroll hidden lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-auto"
      >
        {filters.sel ? (
          <Suspense key={`panel:${filters.sel}`} fallback={<Loading text="Loading details…" />}>
            <DetailPanel filters={filters} />
          </Suspense>
        ) : (
          <EmptyPanel />
        )}
      </aside>
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
  if (total === 0) {
    return (
      <Notice>
        No results{hasAnyFilter(filters) ? ' for these filters' : ''}. Try a shorter name or fewer filters.
      </Notice>
    );
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (filters.page - 1) * PAGE_SIZE + 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-sky-800">
          <span className="text-lg font-semibold text-sky-950">{fmt.format(total)}</span> result{total === 1 ? '' : 's'}
          {rows.length > 0 && (
            <span className="text-sky-600">
              {' '}
              · {fmt.format(start)}–{fmt.format(start + rows.length - 1)}
            </span>
          )}
        </p>
        <ActiveFilters filters={filters} />
      </div>

      <ul className="space-y-2">
        {rows.map((r) => {
          const selected = r.id === filters.sel;
          return (
            <li key={r.id}>
              <ResultCard row={r} selected={selected} href={filtersToHref(filters, { sel: selected ? '' : r.id })} />
              {/* Phones/tablets: details open right under the chosen result. */}
              {selected && (
                <div className="mt-2 lg:hidden">
                  <Suspense fallback={<Loading text="Loading details…" />}>
                    <DetailPanel filters={filters} />
                  </Suspense>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Pagination filters={filters} pages={pages} />
    </div>
  );
}

function ResultCard({ row, selected, href }: { row: InstitutionRow; selected: boolean; href: string }) {
  const place = [row.city ?? row.district, row.subdivision_name, row.country_name].filter(Boolean).join(', ');
  const meta = [row.local_type, row.management_label, row.year_established ? `Est. ${row.year_established}` : null].filter(Boolean);
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? 'true' : undefined}
      className={`group block rounded-xl border bg-white p-4 shadow-sm transition ${
        selected
          ? 'border-teal-400 bg-gradient-to-r from-cyan-50 to-white ring-2 ring-cyan-200'
          : 'border-cyan-100 hover:border-cyan-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className={`font-semibold leading-snug ${selected ? 'text-teal-800' : 'text-sky-950 group-hover:text-teal-700'}`}>
          {row.name}
        </h2>
        <TypeBadge code={row.school_type_code} label={row.school_type_label} />
      </div>
      {place && <p className="mt-1 text-sm text-sky-700">📍 {place}</p>}
      {meta.length > 0 && <p className="mt-1 line-clamp-1 text-xs text-sky-600">{meta.join(' · ')}</p>}
    </Link>
  );
}

function TypeBadge({ code, label }: { code: string; label: string }) {
  const color =
    code === 'higher_ed_university'
      ? 'bg-teal-100 text-teal-800'
      : code === 'higher_ed_college'
        ? 'bg-cyan-100 text-cyan-800'
        : 'bg-sky-100 text-sky-800';
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>{label}</span>;
}

async function DetailPanel({ filters }: { filters: Filters }) {
  let d;
  try {
    d = await getInstitution(filters.sel);
  } catch (err) {
    console.error(err);
    return <Notice>Could not load the details. Please try again.</Notice>;
  }
  if (!d) return <Notice>This institution could not be found.</Notice>;
  return (
    <InstitutionDetailView
      d={d}
      hrefFor={(id) => filtersToHref(filters, { sel: id })}
      closeHref={filtersToHref(filters, { sel: '' })}
    />
  );
}

function EmptyPanel() {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border-2 border-dashed border-cyan-200 bg-white/60 p-8 text-center">
      <div>
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-sky-100 to-teal-100 text-2xl">
          🏫
        </div>
        <p className="font-medium text-sky-900">Select a result</p>
        <p className="text-sm text-sky-600">Its address, contact details and more will appear here.</p>
      </div>
    </div>
  );
}

function ActiveFilters({ filters }: { filters: Filters }) {
  const chips: { label: string; href: string }[] = [];
  if (filters.q) chips.push({ label: `“${filters.q}”`, href: filtersToHref(filters, { q: '', page: 1, sel: '' }) });
  if (filters.place) chips.push({ label: filters.place, href: filtersToHref(filters, { place: '', page: 1, sel: '' }) });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-xs font-medium text-cyan-900 hover:bg-cyan-200"
          aria-label={`Remove filter ${c.label}`}
        >
          {c.label} ×
        </Link>
      ))}
    </div>
  );
}

function Pagination({ filters, pages }: { filters: Filters; pages: number }) {
  if (pages <= 1) return null;
  const prev = filters.page > 1 ? filtersToHref(filters, { page: filters.page - 1, sel: '' }) : null;
  const next = filters.page < pages ? filtersToHref(filters, { page: filters.page + 1, sel: '' }) : null;
  const linkClass =
    'rounded-lg border border-cyan-200 bg-white px-3 py-1.5 text-sm font-medium text-teal-800 shadow-sm hover:border-teal-400 hover:bg-cyan-50';
  return (
    <nav aria-label="Pages" className="flex items-center justify-between pt-2">
      {prev ? (
        <Link href={prev} className={linkClass}>
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-sky-700">
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

function Loading({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-cyan-100 bg-white p-4 text-sm text-sky-700">
      <span className="h-3 w-3 animate-pulse rounded-full bg-teal-400" />
      {text}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-cyan-100 bg-white p-4 text-sky-800">{children}</p>;
}
