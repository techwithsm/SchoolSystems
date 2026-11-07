import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-16">
      <h1 className="text-3xl font-semibold">School Systems Directory</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Compare how school education is organised around the world. The public site is coming soon.
      </p>
      <Link href="/admin" className="inline-block font-medium text-emerald-700 underline">
        Admin area
      </Link>
    </main>
  );
}
