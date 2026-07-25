'use client';

import { useEffect } from 'react';
import { PWAInstallBanner } from '../components/ui/pwa-install-banner';

export function PWAProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[SYNCRO] Service Worker registered:', registration);
          // Register sync endpoint with service worker
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ 
              type: 'REGISTER_SYNC_ENDPOINT',
              endpoint: '/api/sync/offline'
            });
          }
        })
        .catch((error) => {
          console.error('[SYNCRO] Service Worker registration failed:', error);
        });
    }
  }, []);

  return (
    <>
      {children}
      <PWAInstallBanner />
    </>
  );
}