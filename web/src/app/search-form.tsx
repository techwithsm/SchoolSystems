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

const fieldClass =
  'mt-1 w-full rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm text-sky-950 shadow-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-cyan-200 disabled:cursor-not-allowed disabled:bg-sky-50 disabled:text-sky-400';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-sky-700';

/**
 * Filter sidebar. A plain GET form (works without JavaScript); with JavaScript,
 * dropdowns apply immediately and next/form navigates without a full reload.
 * Submitting clears the selected institution (sel is not a form field).
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
    <Form action="/" className="space-y-4 rounded-2xl border border-cyan-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sky-950">Filters</h2>
        <Link href="/" className="text-xs font-medium text-teal-700 hover:underline">
          Clear all
        </Link>
      </div>

      <label className="block">
        <span className={labelClass}>Name</span>
        <input
          name="q"
          type="search"
          defaultValue={filters.q}
          placeholder="School, college or university"
          maxLength={100}
          className={fieldClass}
        />
      </label>

      <label className="block">
        <span className={labelClass}>Country</span>
        <select name="country" defaultValue={filters.country} onChange={changeCountry} className={fieldClass}>
          <option value="">All countries</option>
          {countries.map((o) => (
            <option key={o.value} value={o.value}>
              {withCount(o)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelClass}>State / province</span>
        <select
          name="state"
          defaultValue={filters.state}
          onChange={submit}
          disabled={!filters.country || states.length === 0}
          className={fieldClass}
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
        <span className={labelClass}>City or district</span>
        <input name="place" type="search" defaultValue={filters.place} placeholder="e.g. Pune, Toronto" maxLength={100} className={fieldClass} />
      </label>

      <fieldset>
        <legend className={labelClass}>Type</legend>
        <div className="mt-1 space-y-1">
          <TypeRadio value="" label="All types" checked={!filters.type} />
          {types.map((o) => (
            <TypeRadio key={o.value} value={o.value} label={withCount(o)} checked={filters.type === o.value} />
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className={labelClass}>Management</span>
        <select name="management" defaultValue={filters.management} onChange={submit} className={fieldClass}>
          <option value="">Any</option>
          {management.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="w-full rounded-lg bg-gradient-to-r from-cyan-500 to-teal-500 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:from-cyan-600 hover:to-teal-600"
      >
        Search
      </button>
    </Form>
  );
}

function TypeRadio({ value, label, checked }: { value: string; label: string; checked: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-sky-900 hover:bg-cyan-50 has-[:checked]:bg-cyan-50 has-[:checked]:font-medium has-[:checked]:text-teal-800">
      <input
        type="radio"
        name="type"
        value={value}
        defaultChecked={checked}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="accent-teal-600"
      />
      {label}
    </label>
  );
}
