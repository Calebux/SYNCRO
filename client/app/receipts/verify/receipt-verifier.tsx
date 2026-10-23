'use client';

import { useState } from 'react';
import { verifyReceiptInBrowser, type BrowserReceiptKey } from '@syncro/sdk/v3/receipt-browser';
import api from '@/lib/api';

type CheckState = 'passed' | 'failed' | 'not-checked';

interface VerificationChecks {
  structure: CheckState;
  trustedSigner: CheckState;
  signature: CheckState;
  summary: string;
}

function unwrapReceipt(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const data = value as { data?: unknown; receipt?: unknown };
  return data.data ?? data.receipt ?? value;
}

export function ReceiptVerifier() {
  const [input, setInput] = useState('');
  const [checks, setChecks] = useState<VerificationChecks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function verify() {
    setLoading(true);
    setError(null);
    setChecks(null);
    try {
      const trimmed = input.trim();
      if (!trimmed) throw new Error('Paste receipt JSON or a receipt URL to continue.');

      let receiptValue: unknown;
      let sourceUrl: URL | null = null;
      const apiOrigin = new URL(api.defaults.baseURL || window.location.origin, window.location.origin).origin;
      try {
        receiptValue = JSON.parse(trimmed);
      } catch {
        sourceUrl = new URL(trimmed, apiOrigin);
        if (sourceUrl.protocol !== 'https:' && sourceUrl.protocol !== 'http:') {
          throw new Error('Receipt URLs must use HTTP or HTTPS.');
        }
        if (sourceUrl.username || sourceUrl.password) {
          throw new Error('Receipt URLs cannot contain credentials.');
        }
        if (sourceUrl.origin !== apiOrigin) {
          throw new Error('Receipt URLs must be hosted by the configured SYNCRO API.');
        }
        const response = await fetch(sourceUrl, { credentials: 'omit', redirect: 'error' });
        if (!response.ok) throw new Error(`Unable to load receipt (${response.status}).`);
        receiptValue = await response.json();
      }

      const receipt = unwrapReceipt(receiptValue);
      const keysUrl = new URL('/api/v3/receipt-keys', apiOrigin);
      const keysResponse = await fetch(keysUrl, { credentials: 'omit', redirect: 'error' });
      if (!keysResponse.ok) throw new Error(`Unable to load trusted signing keys (${keysResponse.status}).`);
      const keysBody = await keysResponse.json() as { keys?: BrowserReceiptKey[] };
      if (!Array.isArray(keysBody.keys)) throw new Error('Signing-key response was malformed.');

      const result = await verifyReceiptInBrowser(receipt, keysBody.keys);
      const structure: CheckState = result.reason === 'malformed_receipt' ? 'failed' : 'passed';
      const trustedSigner: CheckState = result.reason === 'malformed_receipt'
        ? 'not-checked'
        : result.reason === 'unknown_key' ? 'failed' : 'passed';
      const signature: CheckState = result.reason === 'bad_signature'
        ? 'failed'
        : result.reason === 'unknown_key' || result.reason === 'malformed_receipt'
          ? 'not-checked'
          : 'passed';
      setChecks({
        structure,
        trustedSigner,
        signature,
        summary: result.ok
          ? 'Receipt verified successfully.'
          : result.reason === 'unknown_key'
            ? 'Receipt signer is not in the trusted key set.'
            : result.reason === 'malformed_receipt'
              ? 'The provided data is not a supported SYNCRO receipt.'
              : 'Receipt signature is invalid; the receipt may have been altered.',
      });
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Receipt verification failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f7f4] px-4 py-10 text-[#17211b]">
      <section className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">SYNCRO receipts</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Receipt verifier</h1>
        <p className="mt-3 text-sm text-gray-600">
          No sign-in is required. Receipt signatures are checked locally; a receipt URL and public signing keys are fetched to complete verification.
        </p>

        <label htmlFor="receipt-input" className="mt-6 block text-sm font-medium text-gray-900">
          Receipt JSON or URL
        </label>
        <textarea
          id="receipt-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={9}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="mt-2 w-full rounded-lg border border-gray-300 p-3 font-mono text-sm shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          placeholder='{"receiptId":"…","signature":"…"}'
        />
        <button
          type="button"
          onClick={() => void verify()}
          disabled={loading}
          className="mt-4 rounded-lg bg-gray-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Verifying…' : 'Verify receipt'}
        </button>

        <div aria-live="polite" aria-atomic="true" aria-busy={loading} className="mt-6">
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
          {checks && (
            <section aria-label="Verification results" className="rounded-lg border border-gray-200 p-4">
              <h2 className={`text-lg font-semibold ${checks.summary.startsWith('Receipt verified') ? 'text-emerald-800' : 'text-red-800'}`}>
                {checks.summary}
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                <VerificationCheck label="Receipt format" state={checks.structure} />
                <VerificationCheck label="Trusted signer" state={checks.trustedSigner} />
                <VerificationCheck label="Digital signature" state={checks.signature} />
              </ul>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

function VerificationCheck({ label, state }: { label: string; state: CheckState }) {
  const text = state === 'passed' ? 'Passed' : state === 'failed' ? 'Failed' : 'Not checked';
  const style = state === 'passed' ? 'text-emerald-800' : state === 'failed' ? 'text-red-800' : 'text-gray-600';
  return <li className="flex justify-between gap-4"><span>{label}</span><span className={`font-medium ${style}`}>{text}</span></li>;
}
