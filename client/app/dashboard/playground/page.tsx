'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { DashboardNav } from '@/components/dashboard/dashboard-nav';
import api from '@/lib/api';
import { generateKeypair, signMessage, type LocalKeypair } from '@/lib/agent-keys';
import {
  DEMO_PROVIDER,
  loadPlaygroundProviders,
  runPlaygroundCall,
  selectPlaygroundProvider,
  type PlaygroundProvider,
  type PlaygroundRun,
} from '@/lib/playground-call';

function apiOrigin(): string {
  return new URL(api.defaults.baseURL || '/', window.location.origin).origin;
}

export default function PlaygroundPage() {
  const [budget, setBudget] = useState('20');
  const [prompt, setPrompt] = useState('hello');
  const [providers, setProviders] = useState<PlaygroundProvider[]>([DEMO_PROVIDER]);
  const [providerId, setProviderId] = useState<string>(DEMO_PROVIDER.id);
  const [catalogNote, setCatalogNote] = useState('');
  const [signer, setSigner] = useState<LocalKeypair | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState<PlaygroundRun>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [nextSigner, catalog] = await Promise.all([
        generateKeypair(),
        loadPlaygroundProviders(apiOrigin()),
      ]);
      if (cancelled) return;
      setSigner(nextSigner);
      setProviders(catalog.providers);
      setProviderId(catalog.providers[0]?.id ?? DEMO_PROVIDER.id);
      setCatalogNote(catalog.note);
    })();
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!signer) return;
    setBusy(true);
    setError('');
    setRun(undefined);
    try {
      const provider = selectPlaygroundProvider(providers, providerId);
      setRun(await runPlaygroundCall({
        apiOrigin: apiOrigin(),
        budget,
        provider,
        prompt,
        signer: {
          publicKey: signer.publicKey,
          sign: (message) => signMessage(signer.secretKey, message),
        },
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not run the paid call.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <DashboardNav current="playground" />
    <h1 className="text-3xl font-semibold">Paid-call playground</h1>
    <p className="text-sm text-gray-600">
      A testnet agent signs the payment and calls the gateway. No code is required.
    </p>
    <form onSubmit={submit} className="grid gap-4 rounded-xl border p-5">
      <label>Testnet provider route
        <select
          className="block w-full border p-2"
          value={providerId}
          disabled={busy}
          onChange={(event) => { setProviderId(event.target.value); setRun(undefined); setError(''); }}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.label} ({provider.route})</option>
          ))}
        </select>
      </label>
      {catalogNote && <p>{catalogNote}</p>}
      <label>Prompt
        <input
          className="block w-full border p-2"
          value={prompt}
          disabled={busy}
          onChange={(event) => { setPrompt(event.target.value); setRun(undefined); setError(''); }}
        />
      </label>
      <label>Maximum cost in settlement asset units
        <input
          className="block w-full border p-2"
          inputMode="decimal"
          value={budget}
          disabled={busy}
          onChange={(event) => { setBudget(event.target.value); setRun(undefined); setError(''); }}
        />
      </label>
      <button disabled={busy || !signer} className="rounded bg-gray-950 p-2 text-white">
        {busy ? 'Running paid call…' : 'Run testnet paid call'}
      </button>
    </form>
    {error && <p role="alert">{error}</p>}
    {run?.unavailable && <p role="alert">{run.unavailable}</p>}
    {run && <section aria-label="Paid call" className="space-y-4">
      <ol aria-label="Paid call timeline" className="space-y-3">
        {run.steps.map((step, index) => (
          <li key={step.id} className="rounded border p-3">
            <p className="font-medium">{index + 1}. {step.title}</p>
            <p className="text-sm">{step.status === 'complete' ? 'Complete' : 'Failed'}. {step.detail}</p>
          </li>
        ))}
      </ol>
      <section aria-label="Payment challenge">
        <h2 className="text-xl font-semibold">402 challenge</h2>
        <p>Quoted cost: {run.amount} {run.asset}</p>
        <pre className="overflow-x-auto rounded border p-3">{JSON.stringify(run.challenge, null, 2)}</pre>
      </section>
      <section aria-label="Signed state">
        <h2 className="text-xl font-semibold">Signed state</h2>
        <p>Payer {run.payerAddress}</p>
        <pre className="overflow-x-auto rounded border p-3">{JSON.stringify(run.signed.proof, null, 2)}</pre>
      </section>
      <section aria-label="Gateway response">
        <h2 className="text-xl font-semibold">Response</h2>
        <p>HTTP {run.responseStatus}</p>
        <pre className="overflow-x-auto rounded border p-3">{JSON.stringify(run.responseBody, null, 2)}</pre>
      </section>
      <section aria-label="Verified receipt">
        <h2 className="text-xl font-semibold">Receipt</h2>
        <p>{run.verification.ok ? 'Receipt verified.' : run.verification.failures.join(' ')}</p>
        {run.receipt && <pre className="overflow-x-auto rounded border p-3">{JSON.stringify(run.receipt, null, 2)}</pre>}
      </section>
      <section aria-label="SDK snippet">
        <h2 className="text-xl font-semibold">SDK snippet</h2>
        <pre className="overflow-x-auto rounded border p-3"><code>{run.sdkSnippet}</code></pre>
      </section>
    </section>}
  </main>;
}
