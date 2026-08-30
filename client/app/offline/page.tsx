'use client';

import { useEffect, useState } from 'react';
import {
  loadOfflineSubscriptions,
  getOfflineCacheTimestamp,
  type OfflineSubscription,
} from '@/lib/offline-cache';

// ─── Service worker verification ─────────────────────────────────────────────

function useServiceWorkerStatus() {
  const [registered, setRegistered] = useState<boolean | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setRegistered(false);
      return;
    }
    navigator.serviceWorker.getRegistration('/sw.js').then((reg) => {
      setRegistered(!!reg);
    });
  }, []);

  return registered;
}

// ─── Retry / resync ───────────────────────────────────────────────────────────

function handleRetry() {
  window.location.reload();
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<string, string> = {
  active: 'text-green-400',
  cancelled: 'text-red-400',
  paused: 'text-yellow-400',
  expired: 'text-gray-400',
  trial: 'text-blue-400',
};

function formatRenewal(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflinePage() {
  const [subs, setSubs] = useState<OfflineSubscription[]>([]);
  const [cacheTs, setCacheTs] = useState<string | null>(null);
  const swRegistered = useServiceWorkerStatus();

  useEffect(() => {
    setSubs(loadOfflineSubscriptions());
    setCacheTs(getOfflineCacheTimestamp());
  }, []);

  const cacheAge = cacheTs
    ? new Date(cacheTs).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {/* Icon + heading */}
        <div className="mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">You&apos;re Offline</h1>
          <p className="text-gray-400 text-sm">
            {subs.length > 0
              ? 'Showing your last cached subscriptions.'
              : 'No cached data available. Connect to the internet to load your subscriptions.'}
          </p>
        </div>

        {/* Service worker status */}
        {swRegistered === false && (
          <div
            role="alert"
            className="mb-4 text-xs text-yellow-400 bg-yellow-900/30 border border-yellow-700 rounded-lg px-3 py-2"
          >
            Service worker not registered — offline caching may not be available.
          </div>
        )}

        {/* Cached subscriptions */}
        {subs.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4 mb-4 text-left">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">Cached Subscriptions</h2>
              {cacheAge && (
                <span className="text-xs text-gray-500" aria-label={`Cache last updated ${cacheAge}`}>
                  Updated {cacheAge}
                </span>
              )}
            </div>

            <ul className="space-y-2" aria-label="Cached subscriptions">
              {subs.map((sub) => (
                <li
                  key={sub.id}
                  className="flex items-center justify-between p-3 bg-gray-700 rounded"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{sub.name}</p>
                    <p className="text-xs text-gray-400">
                      Renews: {formatRenewal(sub.next_renewal)}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-medium capitalize flex-shrink-0 ml-3 ${STATUS_CLASSES[sub.status] ?? 'text-gray-400'}`}
                    aria-label={`Status: ${sub.status}`}
                  >
                    {sub.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Retry / resync */}
        <button
          onClick={handleRetry}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900"
        >
          Retry Connection
        </button>

        <p className="mt-3 text-xs text-gray-500">
          Read-only view — changes will sync when you&apos;re back online.
        </p>
      </div>
    </div>
  );
}
