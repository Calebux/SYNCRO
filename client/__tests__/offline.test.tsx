/**
 * Tests for #609 — Offline experience
 *
 * Covers:
 * - OfflinePage: shows SW warning, retry button
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGetRegistration = vi.fn();

describe('OfflinePage', () => {
  beforeEach(() => {
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

  it('renders the offline heading', async () => {
    mockGetRegistration.mockResolvedValue(undefined);

    await renderOfflinePage();

    expect(screen.getByRole('heading', { name: /you're offline/i })).toBeInTheDocument();
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
});
