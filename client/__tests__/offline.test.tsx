/**
 * Tests for #609 — Offline experience
 *
 * Covers:
 * - offline-cache.ts: save/load/timestamp/clear
 * - OfflinePage: renders cached subscriptions, shows SW warning, retry button
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  saveSubscriptionsOffline,
  loadOfflineSubscriptions,
  getOfflineCacheTimestamp,
  clearOfflineCache,
  type OfflineSubscription,
} from '@/lib/offline-cache';

// ─── offline-cache.ts unit tests ─────────────────────────────────────────────

describe('offline-cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const subs: OfflineSubscription[] = [
    {
      id: 'sub-1',
      name: 'Netflix',
      status: 'active',
      billing_cycle: 'monthly',
      next_renewal: '2025-12-15T00:00:00Z',
      price: 15.99,
      category: 'streaming',
    },
    {
      id: 'sub-2',
      name: 'Spotify',
      status: 'active',
      billing_cycle: 'monthly',
      next_renewal: '2025-12-20T00:00:00Z',
      price: 9.99,
      category: 'music',
    },
  ];

  it('saves and loads subscriptions', () => {
    saveSubscriptionsOffline(subs);
    const loaded = loadOfflineSubscriptions();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe('Netflix');
    expect(loaded[1].name).toBe('Spotify');
  });

  it('returns empty array when nothing is cached', () => {
    expect(loadOfflineSubscriptions()).toEqual([]);
  });

  it('saves a timestamp on write', () => {
    const before = new Date().toISOString();
    saveSubscriptionsOffline(subs);
    const ts = getOfflineCacheTimestamp();
    expect(ts).not.toBeNull();
    expect(new Date(ts!).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('returns null timestamp when nothing is cached', () => {
    expect(getOfflineCacheTimestamp()).toBeNull();
  });

  it('clears cache and timestamp', () => {
    saveSubscriptionsOffline(subs);
    clearOfflineCache();
    expect(loadOfflineSubscriptions()).toEqual([]);
    expect(getOfflineCacheTimestamp()).toBeNull();
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('syncro_offline_subscriptions', 'not-valid-json');
    expect(loadOfflineSubscriptions()).toEqual([]);
  });

  it('overwrites previous cache on subsequent saves', () => {
    saveSubscriptionsOffline(subs);
    saveSubscriptionsOffline([subs[0]]);
    expect(loadOfflineSubscriptions()).toHaveLength(1);
  });
});

// ─── OfflinePage component tests ──────────────────────────────────────────────

// Mock navigator.serviceWorker
const mockGetRegistration = vi.fn();

describe('OfflinePage', () => {
  beforeEach(async () => {
    localStorage.clear();

    // Mock serviceWorker
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: mockGetRegistration },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderOfflinePage() {
    const { default: OfflinePage } = await import('@/app/offline/page');
    return render(<OfflinePage />);
  }

  it('shows "no cached data" message when cache is empty', async () => {
    mockGetRegistration.mockResolvedValue(undefined);

    await renderOfflinePage();

    expect(
      screen.getByText(/no cached data available/i),
    ).toBeInTheDocument();
  });

  it('renders cached subscriptions from localStorage', async () => {
    saveSubscriptionsOffline([
      {
        id: 'sub-1',
        name: 'Netflix',
        status: 'active',
        billing_cycle: 'monthly',
        next_renewal: '2025-12-15T00:00:00Z',
        price: 15.99,
        category: 'streaming',
      },
    ]);
    mockGetRegistration.mockResolvedValue({ active: true });

    await renderOfflinePage();

    expect(await screen.findByText('Netflix')).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it('shows service worker warning when SW is not registered', async () => {
    mockGetRegistration.mockResolvedValue(undefined);

    await renderOfflinePage();

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent(/service worker not registered/i);
  });

  it('does not show SW warning when SW is registered', async () => {
    mockGetRegistration.mockResolvedValue({ active: true });

    await renderOfflinePage();

    // Give time for the async SW check
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/service worker not registered/i)).not.toBeInTheDocument();
  });

  it('shows retry button', async () => {
    mockGetRegistration.mockResolvedValue(undefined);

    await renderOfflinePage();

    expect(screen.getByRole('button', { name: /retry connection/i })).toBeInTheDocument();
  });

  it('shows read-only note', async () => {
    mockGetRegistration.mockResolvedValue(undefined);

    await renderOfflinePage();

    expect(screen.getByText(/read-only view/i)).toBeInTheDocument();
  });

  it('shows cache timestamp when available', async () => {
    saveSubscriptionsOffline([
      {
        id: 'sub-1',
        name: 'Spotify',
        status: 'active',
        billing_cycle: 'monthly',
        next_renewal: null,
        price: 9.99,
        category: 'music',
      },
    ]);
    mockGetRegistration.mockResolvedValue({ active: true });

    await renderOfflinePage();

    // The "Updated …" label should be present
    expect(await screen.findByLabelText(/cache last updated/i)).toBeInTheDocument();
  });
});
