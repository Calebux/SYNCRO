'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  DirectoryError,
  buildExampleCall,
  createDirectoryClient,
  describePriceRange,
  describeUptime,
  playgroundHref,
  type DirectoryClient,
  type DirectoryProvider,
} from '@/lib/provider-directory';

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string; requestId?: string }
  | { status: 'ready'; provider: DirectoryProvider };

const buttonClass =
  'inline-flex items-center rounded-md border border-[#1a1a1a] px-3 py-2 text-sm font-medium text-[#1a1a1a] hover:bg-[#F9F6F2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a1a1a]';

export function ProviderDetail({
  providerId,
  client,
}: {
  providerId: string;
  /** Injectable for tests; defaults to the public directory API. */
  client?: DirectoryClient;
}) {
  const api = useMemo(() => client ?? createDirectoryClient(), [client]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: 'loading' });
      try {
        const provider = await api.get(providerId, signal);
        setState({ status: 'ready', provider });
      } catch (err) {
        if (signal?.aborted) return;
        if (err instanceof DirectoryError && err.status === 404) {
          setState({ status: 'not-found' });
          return;
        }
        const error = err instanceof DirectoryError ? err : null;
        setState({
          status: 'error',
          message: error?.message ?? 'Something went wrong.',
          requestId: error?.requestId,
        });
      }
    },
    [api, providerId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <nav aria-label="Breadcrumb">
        <Link href="/directory" className="text-sm underline underline-offset-2">
          Back to provider directory
        </Link>
      </nav>

      {state.status === 'loading' ? (
        <p role="status" className="text-sm text-[#4a4a4a]">
          Loading provider…
        </p>
      ) : null}

      {state.status === 'not-found' ? (
        <div className="space-y-2 rounded-lg border border-[#E4DDD4] bg-white p-6">
          <h1 className="text-xl font-semibold">Provider not found</h1>
          <p className="text-sm text-[#4a4a4a]">
            This provider is not listed in the directory. It may never have opted in, or it may have been removed.
          </p>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div role="alert" className="space-y-3 rounded-lg border border-[#E4DDD4] bg-white p-6">
          <p className="text-sm font-medium">Couldn’t load this provider</p>
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

      {state.status === 'ready' ? <ProviderDetailBody provider={state.provider} /> : null}
    </main>
  );
}

function ProviderDetailBody({ provider }: { provider: DirectoryProvider }) {
  const { manifest } = provider;
  const routeSelectId = useId();
  const [routeIndex, setRouteIndex] = useState(0);
  const route = manifest.routes[routeIndex];
  const example = useMemo(() => (route ? buildExampleCall(route) : ''), [route]);
  const manifestJson = useMemo(() => JSON.stringify(manifest, null, 2), [manifest]);

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{provider.name}</h1>
        <p className="text-sm text-[#4a4a4a]">{provider.description}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 pt-2 text-sm">
          <div className="flex gap-1">
            <dt className="font-medium">Category:</dt>
            <dd>{provider.category}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">Price:</dt>
            <dd>{describePriceRange(provider)}</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="uptime-heading" className="rounded-lg border border-[#E4DDD4] bg-white p-4">
        <h2 id="uptime-heading" className="text-base font-semibold">
          Uptime
        </h2>
        <p data-testid="uptime" className="mt-1 text-sm">
          {describeUptime(provider.uptime)}
        </p>
        {provider.uptime.checkedAt ? (
          <p className="mt-1 text-xs text-[#4a4a4a]">
            Last checked <time dateTime={provider.uptime.checkedAt}>{provider.uptime.checkedAt}</time>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="manifest-heading" className="space-y-3 rounded-lg border border-[#E4DDD4] bg-white p-4">
        <h2 id="manifest-heading" className="text-base font-semibold">
          Manifest
        </h2>
        <p className="text-sm text-[#4a4a4a]">
          Version <span data-testid="manifest-version">{manifest.version}</span>. Calls are metered per unit and
          paid through the SYNCRO gateway.
        </p>

        {manifest.routes.length === 0 ? (
          <p className="text-sm">This provider has not published any priced routes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Priced routes for {provider.name}</caption>
              <thead>
                <tr className="border-b border-[#E4DDD4]">
                  <th scope="col" className="py-2 pr-4 font-medium">Method</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Path</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Unit</th>
                  <th scope="col" className="py-2 font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {manifest.routes.map((r) => (
                  <tr key={`${r.method} ${r.pathPattern}`} className="border-b border-[#E4DDD4] last:border-0">
                    <td className="py-2 pr-4">{r.method.toUpperCase()}</td>
                    <td className="py-2 pr-4"><code>{r.pathPattern}</code></td>
                    <td className="py-2 pr-4">{r.unit}</td>
                    <td className="py-2">{r.price} {r.asset} per {r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details>
          <summary className="cursor-pointer text-sm font-medium">Raw manifest (JSON)</summary>
          <pre
            tabIndex={0}
            aria-label="Raw manifest JSON"
            className="mt-2 max-h-80 overflow-auto rounded-md bg-[#F9F6F2] p-3 text-xs"
          >
            <code>{manifestJson}</code>
          </pre>
        </details>
      </section>

      {route ? (
        <section aria-labelledby="example-heading" className="space-y-3 rounded-lg border border-[#E4DDD4] bg-white p-4">
          <h2 id="example-heading" className="text-base font-semibold">
            Example call
          </h2>

          {manifest.routes.length > 1 ? (
            <div>
              <label htmlFor={routeSelectId} className="mb-1 block text-sm font-medium">
                Route
              </label>
              <select
                id={routeSelectId}
                value={routeIndex}
                onChange={(event) => setRouteIndex(Number(event.target.value))}
                className="w-full rounded-md border border-[#E4DDD4] bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a1a1a]"
              >
                {manifest.routes.map((r, index) => (
                  <option key={`${r.method} ${r.pathPattern}`} value={index}>
                    {r.method.toUpperCase()} {r.pathPattern}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <pre
            tabIndex={0}
            aria-label="Example call"
            className="overflow-auto rounded-md bg-[#F9F6F2] p-3 text-xs"
          >
            <code data-testid="example-call">{example}</code>
          </pre>

          <div className="flex flex-wrap items-center gap-3">
            <CopyButton text={example} />
            <Link href={playgroundHref(provider, route)} className={buttonClass}>
              Try in playground
            </Link>
          </div>
        </section>
      ) : null}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const announce = (value: string) => {
    setMessage(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), 4000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      announce('Example call copied to clipboard.');
    } catch {
      announce('Copy failed. Select the example and copy it manually.');
    }
  };

  return (
    <>
      <button type="button" className={buttonClass} onClick={() => void copy()}>
        Copy example call
      </button>
      <span role="status" className="text-sm text-[#4a4a4a]">
        {message}
      </span>
    </>
  );
}
