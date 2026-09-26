'use client';

import { useEffect, useState } from 'react';

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflinePage() {
  const swRegistered = useServiceWorkerStatus();

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
            Check your connection and try again.
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

        {/* Retry / resync */}
        <button
          onClick={handleRetry}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900"
        >
          Retry Connection
        </button>
      </div>
    </div>
  );
}
