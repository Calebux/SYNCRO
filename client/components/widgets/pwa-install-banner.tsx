import React from 'react';
import { X, Download } from 'lucide-react';
import { Button } from "@syncro/ui";
import { usePWAInstall } from '../../hooks/use-pwa-install';

interface PWAInstallBannerProps {
  onDismiss?: () => void;
}

export function PWAInstallBanner({ onDismiss }: PWAInstallBannerProps) {
  const { installPrompt, installApp } = usePWAInstall();

  if (!installPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm bg-gray-800 border border-gray-700 rounded-lg p-4 shadow-lg z-50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-white font-semibold mb-1">Install SYNCRO</h3>
          <p className="text-gray-300 text-sm mb-3">
            Add SYNCRO to your home screen for the best experience with offline support and notifications.
          </p>
          <Button
            onClick={installApp}
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Download className="w-4 h-4 mr-2" />
            Install App
          </Button>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-white ml-2"
            aria-label="Dismiss"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}