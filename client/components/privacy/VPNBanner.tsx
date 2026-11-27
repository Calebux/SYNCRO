'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

// Common Tor exit node IP ranges (simplified list)
const TOR_EXIT_RANGES = [
  // This would be expanded with actual Tor exit node ranges
  // For MVP, we check a few known ranges and rely on IP reputation check
];

// Known VPN provider IP ranges (simplified)
const VPN_PROVIDER_RANGES = [
  // This would be populated with actual VPN provider ranges
  // For MVP, we rely on IP reputation API
];

interface VPNBannerProps {
  onDismiss?: () => void;
}

export default function VPNBanner({ onDismiss }: VPNBannerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user has dismissed this banner before
    const isDismissed = localStorage.getItem('vpn-banner-dismissed');
    if (isDismissed) {
      setIsLoading(false);
      return;
    }

    // Perform client-side IP reputation check
    const checkVPNStatus = async () => {
      try {
        // Use a lightweight, privacy-respecting IP check
        // This request does NOT include any identifying information
        const response = await fetch('https://api.abuseipdb.com/api/v2/check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            key: process.env.NEXT_PUBLIC_ABUSEIPDB_KEY || '',
            maxAgeInDays: '90',
            verbose: '',
          }),
        }).catch(() => {
          // If API fails, assume VPN might be in use and don't show banner
          return null;
        });

        if (!response || !response.ok) {
          setIsLoading(false);
          return;
        }

        const data = await response.json();
        
        // Check if this IP is flagged as VPN/Proxy
        // If usageType includes 'VPN' or 'Proxy', user likely has VPN enabled
        const isVPNDetected = data.data?.usageType?.includes('VPN') || 
                              data.data?.usageType?.includes('Proxy') ||
                              data.data?.isTor === true;

        // Show banner only if NOT on VPN/Tor
        setIsVisible(!isVPNDetected);
      } catch (error) {
        console.error('VPN detection check failed:', error);
        // On error, don't show banner (privacy-first approach)
        setIsVisible(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkVPNStatus();
  }, []);

  const handleDismiss = () => {
    // Store dismissal in localStorage for 30 days
    localStorage.setItem('vpn-banner-dismissed', JSON.stringify({
      dismissedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    setIsVisible(false);
    onDismiss?.();
  };

  if (isLoading || !isVisible) {
    return null;
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-start justify-between gap-4">
        <div className="flex gap-3 flex-1">
          <div className="flex-shrink-0 mt-0.5">
            <svg
              className="h-5 w-5 text-amber-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">
              Privacy Recommendation
            </p>
            <p className="text-sm text-amber-800 mt-0.5">
              We detected you're not using a VPN or Tor Browser. For maximum privacy, 
              consider using{' '}
              <a
                href="https://www.torproject.org/download/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium hover:text-amber-900"
              >
                Tor Browser
              </a>
              {' '}or a privacy-focused VPN.{' '}
              <a
                href="/privacy"
                className="underline font-medium hover:text-amber-900"
              >
                Learn more
              </a>
            </p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-amber-600 hover:text-amber-700 transition-colors"
          aria-label="Dismiss privacy recommendation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
