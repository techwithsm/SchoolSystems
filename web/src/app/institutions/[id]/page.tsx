import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getInstitution, isUuid } from '@/lib/directory';

export default function InstitutionPage({ params }: PageProps<'/institutions/[id]'>) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <Link href="/" className="text-sm text-emerald-700 underline">
        ← Back to search
      </Link>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}

const LOCALITY: Record<string, string> = { urban: 'Urban', suburban: 'Suburban', rural: 'Rural', remote: 'Remote' };

async function Detail({ params }: { params: PageProps<'/institutions/[id]'>['params'] }) {
  const { id } = await params;
  await connection();
  if (!isUuid(id)) notFound();

  const d = await getInstitution(id);
  if (!d) notFound();

  const address = [d.address_line, d.city, d.district, d.subdivision_name, d.postal_code, d.country_name]
    .filter(Boolean)
    .join(', ');

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {d.school_type_label}
        </span>
        <h1 className="text-3xl font-semibold">{d.name}</h1>
        {d.local_name && <p className="text-zinc-600 dark:text-zinc-400">{d.local_name}</p>}
      </header>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
        <Row label="Address">{address || null}</Row>
        <Row label="Category">{d.local_type}</Row>
        <Row label="Management">{d.management_label}</Row>
        <Row label="Established">{d.year_established}</Row>
        <Row label="Area">{d.locality_type_code ? LOCALITY[d.locality_type_code] : null}</Row>
        <Row label="Students">
          {d.enrollment !== null ? `${d.enrollment.toLocaleString('en')}${d.enrollment_year ? ` (${d.enrollment_year})` : ''}` : null}
        </Row>
        <Row label="Affiliated to">
          {d.affiliated_to_id && d.affiliated_to_name ? (
            <Link href={`/institutions/${d.affiliated_to_id}`} className="underline">
              {d.affiliated_to_name}
            </Link>
          ) : null}
        </Row>
        <Row label="Phone">{d.phone ? <a href={`tel:${d.phone.replace(/[^+0-9]/g, '')}`} className="underline">{d.phone}</a> : null}</Row>
        <Row label="Email">{d.email ? <a href={`mailto:${d.email}`} className="underline">{d.email}</a> : null}</Row>
        <Row label="Website">
          {d.website ? (
            <a href={d.website} target="_blank" rel="noopener noreferrer nofollow" className="underline">
              {d.website.replace(/^https?:\/\//, '')}
            </a>
          ) : null}
        </Row>
        <Row label="Official ID">{d.external_id ? `${d.external_id_scheme ?? ''} ${d.external_id}`.trim() : null}</Row>
      </dl>

      {d.affiliatedCount > 0 && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">
            Affiliated colleges ({d.affiliatedCount.toLocaleString('en')})
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            {d.affiliatedColleges.map((c) => (
              <li key={c.id}>
                <Link href={`/institutions/${c.id}`} className="underline">
                  {c.name}
                </Link>
                {c.district && <span className="text-zinc-500"> · {c.district}</span>}
              </li>
            ))}
          </ul>
          {d.affiliatedCount > d.affiliatedColleges.length && (
            <p className="text-sm text-zinc-500">Showing the first {d.affiliatedColleges.length}.</p>
          )}
        </section>
      )}

      <footer className="space-y-1 border-t border-zinc-200 pt-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        {d.source && (
          <p>
            Source:{' '}
            {d.source.url ? (
              <a href={d.source.url} target="_blank" rel="noopener noreferrer" className="underline">
                {d.source.title}
              </a>
            ) : (
              d.source.title
            )}
            {d.source.publisher && `, ${d.source.publisher}`} (accessed {d.source.accessed_on}).
          </p>
        )}
        {d.verification_status !== 'verified' && (
          <p>This record comes from official data but has not been reviewed by our team yet.</p>
        )}
        <p>Fields not shown are not available in the source data.</p>
      </footer>
    </article>
  );
}

/** One label/value line; skipped when the value is unknown. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <>
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
