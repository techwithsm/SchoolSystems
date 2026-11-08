import Link from 'next/link';
import type { InstitutionDetail } from '@/lib/directory';

const LOCALITY: Record<string, string> = { urban: 'Urban', suburban: 'Suburban', rural: 'Rural', remote: 'Remote' };

interface Props {
  d: InstitutionDetail;
  /** Builds the link that selects another institution (panel) or opens its page. */
  hrefFor: (id: string) => string;
  /** Panel only: link that closes the panel. */
  closeHref?: string;
}

/** Full information about one institution: used in the side panel and on /institutions/[id]. */
export function InstitutionDetailView({ d, hrefFor, closeHref }: Props) {
  const address = [d.address_line, d.city, d.district, d.subdivision_name, d.postal_code, d.country_name]
    .filter(Boolean)
    .join(', ');
  const mapsUrl =
    d.latitude !== null && d.longitude !== null
      ? `https://www.openstreetmap.org/?mlat=${d.latitude}&mlon=${d.longitude}#map=15/${d.latitude}/${d.longitude}`
      : null;

  return (
    <article className="overflow-hidden rounded-2xl border border-cyan-100 bg-white shadow-sm">
      <header className="relative bg-gradient-to-br from-sky-100 via-cyan-50 to-teal-100 px-5 pb-5 pt-4">
        {closeHref && (
          <Link
            href={closeHref}
            scroll={false}
            aria-label="Close details"
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-lg text-sky-800 hover:bg-white/70"
          >
            ×
          </Link>
        )}
        <span className="inline-block rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-semibold text-white">
          {d.school_type_label}
        </span>
        <h2 className="mt-2 pr-8 text-2xl font-semibold leading-tight text-sky-950">{d.name}</h2>
        {d.local_name && <p className="mt-1 text-sky-800">{d.local_name}</p>}
        {(d.city || d.subdivision_name) && (
          <p className="mt-1 text-sm text-sky-700">
            {[d.city, d.subdivision_name, d.country_name].filter(Boolean).join(', ')}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {d.website && (
            <a href={d.website} target="_blank" rel="noopener noreferrer nofollow" className={actionClass}>
              🌐 Website
            </a>
          )}
          {d.phone && (
            <a href={`tel:${d.phone.replace(/[^+0-9]/g, '')}`} className={actionClass}>
              📞 Call
            </a>
          )}
          {d.email && (
            <a href={`mailto:${d.email}`} className={actionClass}>
              ✉️ Email
            </a>
          )}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={actionClass}>
              📍 Map
            </a>
          )}
        </div>
      </header>

      <div className="space-y-6 px-5 py-5">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
          <Row label="Address">{address || null}</Row>
          <Row label="Category">{d.local_type}</Row>
          <Row label="Management">{d.management_label}</Row>
          <Row label="Established">{d.year_established}</Row>
          <Row label="Area">{d.locality_type_code ? LOCALITY[d.locality_type_code] : null}</Row>
          <Row label="Students">
            {d.enrollment !== null
              ? `${d.enrollment.toLocaleString('en')}${d.enrollment_year ? ` (${d.enrollment_year})` : ''}`
              : null}
          </Row>
          <Row label="Affiliated to">
            {d.affiliated_to_id && d.affiliated_to_name ? (
              <Link href={hrefFor(d.affiliated_to_id)} scroll={false} className={linkClass}>
                {d.affiliated_to_name}
              </Link>
            ) : null}
          </Row>
          <Row label="Phone">{d.phone}</Row>
          <Row label="Email">{d.email}</Row>
          <Row label="Website">
            {d.website ? (
              <a href={d.website} target="_blank" rel="noopener noreferrer nofollow" className={`${linkClass} break-all`}>
                {d.website.replace(/^https?:\/\//, '')}
              </a>
            ) : null}
          </Row>
          <Row label="Official ID">{d.external_id ? `${d.external_id_scheme ?? ''} ${d.external_id}`.trim() : null}</Row>
        </dl>

        {d.affiliatedCount > 0 && (
          <section>
            <h3 className="mb-2 font-semibold text-sky-950">
              Affiliated colleges{' '}
              <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-800">
                {d.affiliatedCount.toLocaleString('en')}
              </span>
            </h3>
            <ul className="max-h-72 divide-y divide-cyan-50 overflow-auto rounded-lg border border-cyan-100 panel-scroll">
              {d.affiliatedColleges.map((c) => (
                <li key={c.id}>
                  <Link href={hrefFor(c.id)} scroll={false} className="block px-3 py-2 text-sm hover:bg-cyan-50">
                    <span className="text-sky-900">{c.name}</span>
                    {c.district && <span className="text-sky-600"> · {c.district}</span>}
                  </Link>
                </li>
              ))}
            </ul>
            {d.affiliatedCount > d.affiliatedColleges.length && (
              <p className="mt-1 text-xs text-sky-600">Showing the first {d.affiliatedColleges.length}.</p>
            )}
          </section>
        )}

        <footer className="space-y-1 rounded-lg bg-sky-50 p-3 text-xs text-sky-700">
          {d.source && (
            <p>
              Source:{' '}
              {d.source.url ? (
                <a href={d.source.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {d.source.title}
                </a>
              ) : (
                d.source.title
              )}
              {d.source.publisher && `, ${d.source.publisher}`} (accessed {d.source.accessed_on}).
            </p>
          )}
          {d.verification_status !== 'verified' && <p>Imported from official or open data; not yet reviewed by our team.</p>}
          <p>Fields not shown are not available in the source data.</p>
        </footer>
      </div>
    </article>
  );
}

const actionClass =
  'inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-white/80 px-3 py-1 text-sm font-medium text-teal-800 shadow-sm hover:border-teal-400 hover:bg-white';
const linkClass = 'text-teal-700 underline decoration-cyan-300 underline-offset-2 hover:text-teal-900';

/** One label/value line; skipped when the value is unknown. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <>
      <dt className="font-medium text-sky-600">{label}</dt>
      <dd className="text-sky-950">{children}</dd>
    </>
  );
}
