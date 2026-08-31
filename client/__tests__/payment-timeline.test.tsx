/**
 * Tests for #610 — Payment timeline component
 *
 * Covers:
 * - Loading skeleton
 * - Empty state (no events)
 * - Event ordering (most recent first)
 * - On-chain event rendering (blockchain badge, explorer link)
 * - Manual payment state rendering (status badge, notes)
 * - Error state with retry
 * - Pagination controls
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentTimeline } from '@/components/ui/payment-timeline';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/api/renewal-history', () => ({
  renewalHistoryApi: {
    getHistory: vi.fn(),
  },
}));

vi.mock('@/components/providers/user-settings-provider', () => ({
  useUserSettings: () => ({ settings: { currency: 'USD' } }),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: any) => <div data-testid="skeleton" className={className} />,
}));

vi.mock('@/lib/currency-utils', () => ({
  formatCurrency: (amount: number, _currency: string) => `$${amount.toFixed(2)}`,
}));

import { renewalHistoryApi } from '@/lib/api/renewal-history';
const mockGetHistory = renewalHistoryApi.getHistory as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const emptyResponse = {
  subscriptionId: 'sub-1',
  history: [],
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const singlePageResponse = {
  subscriptionId: 'sub-1',
  history: [
    {
      id: 'evt-1',
      date: '2025-03-01T10:00:00Z',
      type: 'renewed',
      status: 'success',
      amount: 15.99,
      currency: 'USD',
      paymentMethod: 'stellar',
    },
    {
      id: 'evt-2',
      date: '2025-02-01T10:00:00Z',
      type: 'failed',
      status: 'failed',
      notes: 'Insufficient balance',
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const onChainResponse = {
  subscriptionId: 'sub-1',
  history: [
    {
      id: 'evt-3',
      date: '2025-04-01T10:00:00Z',
      type: 'renewed',
      status: 'success',
      amount: 9.99,
      currency: 'USD',
      transactionHash: 'abc123txhash',
      blockchainVerified: true,
      explorerUrl: 'https://stellar.expert/explorer/public/tx/abc123txhash',
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const multiPageResponse = {
  subscriptionId: 'sub-1',
  history: [{ id: 'evt-4', date: '2025-05-01T10:00:00Z', type: 'renewed' }],
  total: 25,
  page: 1,
  limit: 20,
  totalPages: 2,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentTimeline — loading state', () => {
  it('renders loading skeletons while fetching', () => {
    mockGetHistory.mockReturnValue(new Promise(() => {}));

    render(<PaymentTimeline subscriptionId="sub-1" />);

    const container = screen.getByLabelText(/loading payment history/i);
    expect(container).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});

describe('PaymentTimeline — empty state', () => {
  it('renders empty state when no events exist', async () => {
    mockGetHistory.mockResolvedValue(emptyResponse);

    render(<PaymentTimeline subscriptionId="sub-1" />);

    expect(await screen.findByText(/no payment history yet/i)).toBeInTheDocument();
  });
});

describe('PaymentTimeline — event rendering', () => {
  beforeEach(() => {
    mockGetHistory.mockResolvedValue(singlePageResponse);
  });

  it('renders all events', async () => {
    render(<PaymentTimeline subscriptionId="sub-1" />);

    expect(await screen.findByText('Renewed')).toBeInTheDocument();
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
  });

  it('renders status badges', async () => {
    render(<PaymentTimeline subscriptionId="sub-1" />);

    await screen.findByText('Renewed');
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('renders amount and payment method', async () => {
    render(<PaymentTimeline subscriptionId="sub-1" />);

    await screen.findByText('Renewed');
    expect(screen.getByText(/\$15\.99/)).toBeInTheDocument();
    expect(screen.getByText(/stellar/i)).toBeInTheDocument();
  });

  it('renders notes for failed events', async () => {
    render(<PaymentTimeline subscriptionId="sub-1" />);

    expect(await screen.findByText(/insufficient balance/i)).toBeInTheDocument();
  });

  it('events are ordered most-recent first (API ordering)', async () => {
    render(<PaymentTimeline subscriptionId="sub-1" />);

    await screen.findByText('Renewed');
    const items = screen.getAllByRole('listitem');
    // First item should be the March event (more recent)
    expect(items[0]).toHaveTextContent('Renewed');
    expect(items[1]).toHaveTextContent('Payment failed');
  });
});

describe('PaymentTimeline — on-chain events', () => {
  it('renders blockchain badge for on-chain events', async () => {
    mockGetHistory.mockResolvedValue(onChainResponse);

    render(<PaymentTimeline subscriptionId="sub-1" />);

    await screen.findByText('Renewed');
    // BlockchainBadge renders "On-chain Confirmed" for blockchainVerified=true
    expect(screen.getByText(/on-chain confirmed/i)).toBeInTheDocument();
  });

  it('renders explorer link for on-chain events', async () => {
    mockGetHistory.mockResolvedValue(onChainResponse);

    render(<PaymentTimeline subscriptionId="sub-1" />);

    const link = await screen.findByRole('link', { name: /view on stellar explorer/i });
    expect(link).toHaveAttribute('href', 'https://stellar.expert/explorer/public/tx/abc123txhash');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('PaymentTimeline — error state', () => {
  it('renders error message when fetch fails', async () => {
    mockGetHistory.mockRejectedValue(new Error('Failed to load history (403)'));

    render(<PaymentTimeline subscriptionId="sub-1" />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/failed to load history/i)).toBeInTheDocument();
  });

  it('retry button re-fetches data', async () => {
    mockGetHistory
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(singlePageResponse);

    render(<PaymentTimeline subscriptionId="sub-1" />);
    const user = userEvent.setup();

    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('Renewed')).toBeInTheDocument();
    });
  });
});

describe('PaymentTimeline — pagination', () => {
  it('shows pagination controls when totalPages > 1', async () => {
    mockGetHistory.mockResolvedValue(multiPageResponse);

    render(<PaymentTimeline subscriptionId="sub-1" />);

    await screen.findByText(/page 1 of 2/i);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });

  it('does not show pagination when only one page', async () => {
    mockGetHistory.mockResolvedValue(singlePageResponse);

    render(<PaymentTimeline subscriptionId="sub-1" />);

    await screen.findByText('Renewed');
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument();
  });

  it('navigates to next page on Next click', async () => {
    const page2Response = { ...multiPageResponse, page: 2, totalPages: 2 };
    mockGetHistory
      .mockResolvedValueOnce(multiPageResponse)
      .mockResolvedValueOnce(page2Response);

    render(<PaymentTimeline subscriptionId="sub-1" />);
    const user = userEvent.setup();

    await screen.findByText(/page 1 of 2/i);
    await user.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument();
    });
    expect(mockGetHistory).toHaveBeenCalledWith('sub-1', { page: 2, limit: 20 });
  });
});
