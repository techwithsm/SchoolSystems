'use client';

import Form from 'next/form';
import Link from 'next/link';
import type { ChangeEvent } from 'react';
import type { Filters, Option } from '@/lib/directory';

interface Props {
  filters: Filters;
  countries: Option[];
  states: Option[];
  types: Option[];
  management: Option[];
}

const fmt = new Intl.NumberFormat('en');
const withCount = (o: Option) => (o.count !== undefined ? `${o.label} (${fmt.format(o.count)})` : o.label);

const inputClass =
  'mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 disabled:opacity-50';

/**
 * Search filters. A plain GET form (works without JavaScript); with JavaScript,
 * dropdowns apply immediately and next/form navigates without a full reload.
 */
export function SearchForm({ filters, countries, states, types, management }: Props) {
  const submit = (e: ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();

  // A new country invalidates the chosen state.
  const changeCountry = (e: ChangeEvent<HTMLSelectElement>) => {
    const state = e.currentTarget.form?.elements.namedItem('state');
    if (state instanceof HTMLSelectElement) state.value = '';
    submit(e);
  };

  return (
    <Form action="/" className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2 lg:grid-cols-3 dark:border-zinc-800">
      <label className="block sm:col-span-2 lg:col-span-3">
        <span className="text-sm font-medium">Name of school, college or university</span>
        <input
          name="q"
          type="search"
          defaultValue={filters.q}
          placeholder="e.g. Fergusson College"
          maxLength={100}
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Country</span>
        <select name="country" defaultValue={filters.country} onChange={changeCountry} className={inputClass}>
          <option value="">All countries</option>
          {countries.map((o) => (
            <option key={o.value} value={o.value}>
              {withCount(o)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">State / province</span>
        <select
          name="state"
          defaultValue={filters.state}
          onChange={submit}
          disabled={!filters.country || states.length === 0}
          className={inputClass}
        >
          <option value="">{filters.country ? 'All states' : 'Choose a country first'}</option>
          {states.map((o) => (
            <option key={o.value} value={o.value}>
              {withCount(o)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">City or district</span>
        <input name="place" type="search" defaultValue={filters.place} placeholder="e.g. Pune" maxLength={100} className={inputClass} />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Type</span>
        <select name="type" defaultValue={filters.type} onChange={submit} className={inputClass}>
          <option value="">All types</option>
          {types.map((o) => (
            <option key={o.value} value={o.value}>
              {withCount(o)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">Management</span>
        <select name="management" defaultValue={filters.management} onChange={submit} className={inputClass}>
          <option value="">Any</option>
          {management.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-end gap-3">
        <button type="submit" className="rounded-md bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700">
          Search
        </button>
        <Link href="/" className="py-2 text-sm text-zinc-600 underline dark:text-zinc-400">
          Clear filters
        </Link>
      </div>
    </Form>
  );
}
