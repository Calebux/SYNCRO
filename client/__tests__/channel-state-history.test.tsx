import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelStateHistory, formatChallengeDuration, formatChannelAmount } from '@/components/channels/ChannelStateHistory';
import type { ChannelHistoryResponse } from '@/lib/payment-channel';

vi.mock('@/lib/payment-channel', () => ({
  getChannelHistory: vi.fn(),
}));

vi.mock('@syncro/ui', () => ({
  Skeleton: ({ className }: any) => <div data-testid="skeleton" className={className} />,
}));

import { getChannelHistory } from '@/lib/payment-channel';
const mockGetHistory = vi.mocked(getChannelHistory);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildHistory(overrides: Partial<ChannelHistoryResponse> = {}): ChannelHistoryResponse {
  return {
    channel: {
      id: 'chan-1',
      counterparty: 'SYNCRO Executor',
      balance: '8.00',
      state: 'closing',
      lastUpdated: '2026-09-01T00:00:00.000Z',
    } as any,
    financials: {
      deposited: 50,
      userBalance: 8,
      meteredBalance: 42,
      unsettled: 34,
      committedOnChain: {
        balanceA: 42,
        balanceB: 8,
        sequence: 15,
        transactionHash: 'txsub2',
        timestamp: '2026-09-01T00:00:00.000Z',
      },
    },
    challenge: {
      windowSeconds: 604800,
      windowDays: 7,
      periodActive: true,
      deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      remainingSeconds: 172800,
      source: 'on-chain',
    },
    events: [
      {
        id: 'e1',
        type: 'open',
        title: 'Channel opened',
        timestamp: '2026-08-01T00:00:00.000Z',
        source: 'off-chain',
        amount: 50,
      },
      {
        id: 'e3',
        type: 'state_submitted',
        title: 'State submitted (on-chain)',
        timestamp: '2026-08-15T00:00:00.000Z',
        source: 'on-chain',
        stateNumber: 11,
        sequenceNumber: 11,
        balance: 45,
        confirmed: true,
        transactionHash: 'txsub1111111111111111',
        explorerUrl: 'https://stellar.expert/explorer/testnet/tx/txsub1111111111111111',
      },
      {
        id: 'e4',
        type: 'state_submitted',
        title: 'State submitted',
        timestamp: '2026-08-20T00:00:00.000Z',
        source: 'off-chain',
        nonce: 'n2',
        stateNumber: 2,
        balance: 40,
        confirmed: false,
      },
    ],
    ...overrides,
  };
}

// ─── Component tests ──────────────────────────────────────────────────────────

describe('ChannelStateHistory', () => {
  beforeEach(() => {
    mockGetHistory.mockReset();
    mockGetHistory.mockResolvedValue(buildHistory());
  });

  it('renders the unsettled exposure as a first-class number', async () => {
    render(<ChannelStateHistory channelId="chan-1" />);

    expect(await screen.findByText('Unsettled exposure')).toBeInTheDocument();
    const unsettled = document.querySelector('[aria-labelledby="unsettled-label"]');
    expect(unsettled).toHaveTextContent('$34.00');
    expect(screen.getByText('Total deposited')).toBeInTheDocument();
    expect(screen.getByText('Metered (counterparty)')).toBeInTheDocument();
  });

  it('shows live remaining time during a close', async () => {
    render(<ChannelStateHistory channelId="chan-1" />);

    await screen.findByText('Unsettled exposure');
    // Countdown label + deadline timestamp.
    expect(screen.getByLabelText('Time remaining to finalise')).toBeInTheDocument();
    expect(screen.getByText(/Finalise available/i)).toBeInTheDocument();
  });

  it('renders each timeline event with nonces, confirmation and explorer links', async () => {
    render(<ChannelStateHistory channelId="chan-1" />);

    expect(await screen.findByText('Channel opened')).toBeInTheDocument();
    expect(screen.getByText('State submitted (on-chain)')).toBeInTheDocument();
    expect(screen.getByText('nonce n2')).toBeInTheDocument();
    expect(screen.getByText('unconfirmed')).toBeInTheDocument();

    const explorerLink = screen.getByRole('link', { name: /↗$/ });
    expect(explorerLink).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/testnet/tx/txsub1111111111111111',
    );
    expect(explorerLink).toHaveAttribute('target', '_blank');
  });

  it('refetches when the refreshKey changes', async () => {
    const { rerender } = render(<ChannelStateHistory channelId="chan-1" refreshKey="a" />);
    await screen.findByText('Channel opened');
    expect(mockGetHistory).toHaveBeenCalledTimes(1);

    rerender(<ChannelStateHistory channelId="chan-1" refreshKey="b" />);
    await waitFor(() => expect(mockGetHistory).toHaveBeenCalledTimes(2));
  });

  it('shows an error state with retry', async () => {
    mockGetHistory.mockRejectedValueOnce(new Error('boom'));
    mockGetHistory.mockResolvedValueOnce(buildHistory());

    render(<ChannelStateHistory channelId="chan-1" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('boom');

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Channel opened')).toBeInTheDocument();
  });

  it('keeps the countdown inert when no close is in progress', async () => {
    mockGetHistory.mockResolvedValue(
      buildHistory({
        challenge: {
          windowSeconds: 604800,
          windowDays: 7,
          periodActive: false,
          deadline: null,
          remainingSeconds: null,
          source: 'default',
        },
      }),
    );

    render(<ChannelStateHistory channelId="chan-1" />);

    await screen.findByText('Unsettled exposure');
    expect(screen.queryByLabelText('Time remaining to finalise')).not.toBeInTheDocument();
  });
});

// ─── Formatting helpers ───────────────────────────────────────────────────────

describe('formatChallengeDuration', () => {
  it('formats days, hours, minutes and seconds', () => {
    expect(formatChallengeDuration(7 * 86400 + 2 * 3600 + 3 * 60 + 4)).toBe('7d 2h 3m 4s');
    expect(formatChallengeDuration(2 * 3600 + 5 * 60)).toBe('2h 5m 0s');
    expect(formatChallengeDuration(45)).toBe('45s');
  });
});

describe('formatChannelAmount', () => {
  it('formats amounts and handles missing values', () => {
    expect(formatChannelAmount(34)).toBe('34.00');
    expect(formatChannelAmount(34.5)).toBe('34.50');
    expect(formatChannelAmount(undefined)).toBe('—');
  });
});