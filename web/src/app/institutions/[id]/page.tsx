import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { InstitutionDetailView } from '@/components/institution-detail';
import { getInstitution, isUuid } from '@/lib/directory';

/** Stand-alone page for one institution (shareable link, opened in a new tab). */
export default function InstitutionPage({ params }: PageProps<'/institutions/[id]'>) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8">
      <Link href="/" className="text-sm font-medium text-teal-700 hover:underline">
        ← Back to search
      </Link>
      <Suspense fallback={<p className="text-sky-700">Loading…</p>}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: { params: PageProps<'/institutions/[id]'>['params'] }) {
  const { id } = await params;
  await connection();
  if (!isUuid(id)) notFound();
  const d = await getInstitution(id);
  if (!d) notFound();
  return <InstitutionDetailView d={d} hrefFor={(other) => `/institutions/${other}`} />;
}
