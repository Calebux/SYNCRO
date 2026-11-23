'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  EMPTY_DIRECTORY_FILTERS,
  DirectoryError,
  createDirectoryClient,
  describePriceRange,
  describeUptime,
  filterOptions,
  filterProviders,
  hasActiveDirectoryFilters,
  isPriceRangeInvalid,
  onlyOptedIn,
  playgroundHref,
  providerHref,
  type DirectoryClient,
  type DirectoryFilters,
  type DirectoryProvider,
} from '@/lib/provider-directory';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; requestId?: string }
  | { status: 'ready'; providers: DirectoryProvider[] };

const fieldClass =
  'w-full rounded-md border border-[#E4DDD4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a1a1a]';
const buttonClass =
  'inline-flex items-center rounded-md border border-[#1a1a1a] px-3 py-2 text-sm font-medium text-[#1a1a1a] hover:bg-[#F9F6F2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a1a1a]';

export function ProviderDirectory({
  client,
}: {
  /** Injectable for tests; defaults to the public directory API. */
  client?: DirectoryClient;
}) {
  const api = useMemo(() => client ?? createDirectoryClient(), [client]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_DIRECTORY_FILTERS);
  const ids = {
    query: useId(),
    category: useId(),
    asset: useId(),
    unit: useId(),
    minPrice: useId(),
    maxPrice: useId(),
    priceError: useId(),
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: 'loading' });
      try {
        // Enforced here as well as in the client: whatever the API returns, a
        // provider that has not opted in is never held in page state, so it
        // cannot appear in the list, the filter options, or the result count.
        const providers = onlyOptedIn(await api.list(signal));
        setState({ status: 'ready', providers });
      } catch (err) {
        if (signal?.aborted) return;
        const error = err instanceof DirectoryError ? err : null;
        setState({
          status: 'error',
          message: error?.message ?? 'Something went wrong.',
          requestId: error?.requestId,
        });
      }
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const providers = state.status === 'ready' ? state.providers : [];
  const options = useMemo(() => filterOptions(providers), [providers]);
  const results = useMemo(() => filterProviders(providers, filters), [providers, filters]);
  const priceInvalid = isPriceRangeInvalid(filters);

  const set = (key: keyof DirectoryFilters) => (value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Provider directory</h1>
        <p className="mt-1 text-sm text-[#4a4a4a]">
          Paid APIs from providers who have opted in to be listed. Open one to see its manifest,
          uptime, and an example call.
        </p>
      </header>

      <form
        role="search"
        aria-label="Filter providers"
        className="grid gap-4 rounded-lg border border-[#E4DDD4] bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor={ids.query} className="mb-1 block text-sm font-medium">
            Search
          </label>
          <input
            id={ids.query}
            type="search"
            className={fieldClass}
            value={filters.query}
            onChange={(event) => set('query')(event.target.value)}
            placeholder="Name or description"
          />
        </div>

        <SelectField
          id={ids.category}
          label="Category"
          value={filters.category}
          options={options.categories}
          onChange={set('category')}
        />
        <SelectField
          id={ids.asset}
          label="Asset"
          value={filters.asset}
          options={options.assets}
          onChange={set('asset')}
        />
        <SelectField
          id={ids.unit}
          label="Unit"
          value={filters.unit}
          options={options.units}
          onChange={set('unit')}
        />

        <div>
          <label htmlFor={ids.minPrice} className="mb-1 block text-sm font-medium">
            Minimum price
          </label>
          <input
            id={ids.minPrice}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className={fieldClass}
            value={filters.minPrice}
            onChange={(event) => set('minPrice')(event.target.value)}
            aria-invalid={priceInvalid || undefined}
            aria-describedby={priceInvalid ? ids.priceError : undefined}
          />
        </div>
        <div>
          <label htmlFor={ids.maxPrice} className="mb-1 block text-sm font-medium">
            Maximum price
          </label>
          <input
            id={ids.maxPrice}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className={fieldClass}
            value={filters.maxPrice}
            onChange={(event) => set('maxPrice')(event.target.value)}
            aria-invalid={priceInvalid || undefined}
            aria-describedby={priceInvalid ? ids.priceError : undefined}
          />
        </div>

        <div className="flex items-end">
          <button
            type="button"
            className={buttonClass}
            onClick={() => setFilters(EMPTY_DIRECTORY_FILTERS)}
            disabled={!hasActiveDirectoryFilters(filters)}
          >
            Clear filters
          </button>
        </div>

        {priceInvalid ? (
          <p id={ids.priceError} role="alert" className="text-sm text-[#9b1c1c] sm:col-span-2 lg:col-span-3">
            Error: the minimum price is higher than the maximum price.
          </p>
        ) : null}
      </form>

      <section aria-labelledby="directory-results-heading">
        <h2 id="directory-results-heading" className="sr-only">
          Providers
        </h2>

        {state.status === 'loading' ? (
          <p role="status" className="text-sm text-[#4a4a4a]">
            Loading providers…
          </p>
        ) : null}

        {state.status === 'error' ? (
          <div role="alert" className="space-y-3 rounded-lg border border-[#E4DDD4] bg-white p-6">
            <p className="text-sm font-medium">Couldn’t load the directory</p>
            <p className="text-sm text-[#4a4a4a]">{state.message}</p>
            {state.requestId ? (
              <p className="text-xs text-[#4a4a4a]">
                Request ID: <code>{state.requestId}</code>
              </p>
            ) : null}
            <button type="button" className={buttonClass} onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : null}

        {state.status === 'ready' ? (
          <>
            <p role="status" className="mb-3 text-sm text-[#4a4a4a]">
              {results.length} of {providers.length} {providers.length === 1 ? 'provider' : 'providers'} shown
            </p>

            {providers.length === 0 ? (
              <p className="rounded-lg border border-[#E4DDD4] bg-white p-6 text-sm">
                No providers are listed yet. Providers appear here once they opt in.
              </p>
            ) : results.length === 0 ? (
              <p className="rounded-lg border border-[#E4DDD4] bg-white p-6 text-sm">
                No providers match these filters. Clear a filter to see more.
              </p>
            ) : (
              <ul className="space-y-3">
                {results.map((provider) => (
                  <ProviderCard key={provider.providerId} provider={provider} />
                ))}
              </ul>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select id={id} className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function ProviderCard({ provider }: { provider: DirectoryProvider }) {
  return (
    <li
      data-testid="provider-card"
      className="flex flex-col gap-3 rounded-lg border border-[#E4DDD4] bg-white p-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold">
          <Link
            href={providerHref(provider.providerId)}
            className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a1a1a]"
          >
            {provider.name}
          </Link>
        </h3>
        <p className="text-sm text-[#4a4a4a]">{provider.description}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-1">
            <dt className="font-medium">Category:</dt>
            <dd>{provider.category}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">Price:</dt>
            <dd>{describePriceRange(provider)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">Uptime:</dt>
            <dd>{describeUptime(provider.uptime)}</dd>
          </div>
        </dl>
      </div>
      <Link href={playgroundHref(provider)} className={buttonClass} aria-label={`Try in playground: ${provider.name}`}>
        Try in playground
      </Link>
    </li>
  );
}
