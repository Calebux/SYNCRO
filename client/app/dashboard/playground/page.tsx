'use client';

import { useState, type FormEvent } from 'react';
import api from '@/lib/api';
import { getPlaygroundQuote } from '@/lib/playground-quote';

export default function PlaygroundPage() {
  const [budget, setBudget] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof getPlaygroundQuote>>>();

  async function preview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setQuote(undefined);
    try {
      const origin = new URL(api.defaults.baseURL || '/', window.location.origin).origin;
      setQuote(await getPlaygroundQuote(origin, budget));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the quote.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <h1 className="text-3xl font-semibold">Paid-call playground</h1>
    <form onSubmit={preview} className="grid gap-4 rounded-xl border p-5">
      <label>Testnet provider route
        <select className="block w-full border p-2"><option>mock/echo</option></select>
      </label>
      <label>Maximum cost in settlement asset units
        <input className="block w-full border p-2" inputMode="decimal" value={budget}
          disabled={busy} onChange={event => { setBudget(event.target.value); setQuote(undefined); setError(''); }} />
      </label>
      <button disabled={busy} className="rounded bg-gray-950 p-2 text-white">
        {busy ? 'Fetching quote…' : 'Preview testnet challenge'}
      </button>
    </form>
    {error && <p role="alert">{error}</p>}
    {quote && <section aria-label="Payment challenge">
      <h2 className="text-xl font-semibold">402 challenge</h2>
      <p>Quoted cost: {quote.amount} {quote.asset}</p>
      <pre className="overflow-x-auto rounded border p-3">{JSON.stringify(quote.challenge, null, 2)}</pre>
    </section>}
  </main>;
}
