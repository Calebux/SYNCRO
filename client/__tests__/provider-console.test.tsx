import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderConsole } from '@/components/provider/ProviderConsole';
import {
  PROVIDER_SESSION_KEY,
  RATE_CARD_NON_RETROACTIVE_NOTICE,
  type ProviderConsoleClient,
  type ProviderConsoleSnapshot,
} from '@/lib/provider-console';

vi.mock('@syncro/ui', async () => {
  const React = await import('react');
  return {
    Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
    AlertTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    AlertDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
    Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
    CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
    CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
      <label {...props}>{children}</label>
    ),
    formatSettlementAmount: (amount: number) => `${amount.toFixed(6)} USDC`,
  };
});

function snapshot(overrides: Partial<ProviderConsoleSnapshot> = {}): ProviderConsoleSnapshot {
  return {
    provider: {
      providerId: 'provider-1',
      identity: 'acme',
      payoutAddress: 'GADDRESS',
      upstreamBaseUrl: 'https://provider.example',
      agreementTerms: 'tos:v1',
      mode: 'staging',
      payoutVerified: true,
      payoutChallenge: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    routes: [
      {
        routeId: 'route-1',
        providerId: 'provider-1',
        pathPattern: '/echo/*',
        method: 'POST',
        unit: 'request',
        price: 2,
        quantityExtractor: 'constant:1',
        scopeKey: 'POST:/echo/*',
        createdAt: '2026-01-01T00:00:00.000Z',
        applicableVersion: {
          versionId: 'ver-2',
          providerId: 'provider-1',
          routeId: 'route-1',
          sequence: 2,
          label: 'v2',
          price: 2,
          unit: 'request',
          quantityExtractor: 'constant:1',
          pathPattern: '/echo/*',
          method: 'POST',
          effectiveFrom: '2026-06-01T00:00:00.000Z',
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      },
    ],
    rateCards: [
      {
        versionId: 'ver-1',
        providerId: 'provider-1',
        routeId: 'route-1',
        sequence: 1,
        label: 'v1',
        price: 1,
        unit: 'request',
        quantityExtractor: 'constant:1',
        pathPattern: '/echo/*',
        method: 'POST',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        versionId: 'ver-2',
        providerId: 'provider-1',
        routeId: 'route-1',
        sequence: 2,
        label: 'v2',
        price: 2,
        unit: 'request',
        quantityExtractor: 'constant:1',
        pathPattern: '/echo/*',
        method: 'POST',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    settlements: [
      {
        settlementId: 'set-1',
        providerId: 'provider-1',
        routeId: 'route-1',
        receiptId: 'receipt-1',
        method: 'POST',
        pathPattern: '/echo/*',
        unit: 'request',
        quantity: 1,
        price: 1,
        amount: 1,
        rateCardVersion: 'v1',
        rateCardEffectiveFrom: '2026-01-01T00:00:00.000Z',
        status: 'unsettled',
        meteredAt: '2026-02-01T00:00:00.000Z',
        channelId: 'channel-1',
      },
    ],
    revenue: { settled: 4, unsettled: 5, inDispute: 6 },
    ...overrides,
  };
}

function client(overrides: Partial<ProviderConsoleClient> = {}): ProviderConsoleClient {
  return {
    registerProvider: vi.fn(),
    updatePayoutAddress: vi.fn(),
    createPayoutChallenge: vi.fn(),
    verifyPayout: vi.fn(),
    registerRoute: vi.fn(),
    reviseRoute: vi.fn(),
    loadConsole: vi.fn(),
    ...overrides,
  };
}

describe('ProviderConsole', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('registers a provider from the form', async () => {
    const api = client({
      registerProvider: vi.fn().mockResolvedValue({ providerId: 'provider-new' }),
      loadConsole: vi.fn().mockResolvedValue(snapshot()),
    });

    render(<ProviderConsole client={api} />);

    fireEvent.change(await screen.findByLabelText('Identity'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Payout address'), { target: { value: 'GADDRESS' } });
    fireEvent.change(screen.getByLabelText('Upstream base URL'), { target: { value: 'https://provider.example' } });
    fireEvent.change(screen.getByLabelText('Agreement terms'), { target: { value: 'tos:v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register provider' }));

    await waitFor(() => {
      expect(api.registerProvider).toHaveBeenCalledWith({
        identity: 'acme',
        payoutAddress: 'GADDRESS',
        upstreamBaseUrl: 'https://provider.example',
        agreementTerms: 'tos:v1',
        mode: 'staging',
      });
    });
  });

  it('shows the payout verification step before routes can be priced', async () => {
    sessionStorage.setItem(PROVIDER_SESSION_KEY, 'provider-1');
    const api = client({
      loadConsole: vi.fn().mockResolvedValue(
        snapshot({
          provider: { ...snapshot().provider, payoutVerified: false },
          routes: [],
          rateCards: [],
          settlements: [],
          revenue: { settled: 0, unsettled: 0, inDispute: 0 },
        }),
      ),
      createPayoutChallenge: vi.fn().mockResolvedValue({ challenge: 'syncro-payout:challenge' }),
      verifyPayout: vi.fn().mockResolvedValue({ ...snapshot().provider, payoutVerified: true }),
    });

    render(<ProviderConsole client={api} />);

    expect(await screen.findByTestId('payout-verification')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add route' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Start verification' }));
    expect(await screen.findByTestId('payout-challenge')).toHaveTextContent('syncro-payout:challenge');

    fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'c2ln' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit signature' }));

    await waitFor(() => {
      expect(api.verifyPayout).toHaveBeenCalledWith('provider-1', 'c2ln');
    });
  });

  it('previews the cost of a call from the price and quantity extractor', async () => {
    sessionStorage.setItem(PROVIDER_SESSION_KEY, 'provider-1');
    const api = client({ loadConsole: vi.fn().mockResolvedValue(snapshot({ routes: [], rateCards: [] })) });

    render(<ProviderConsole client={api} />);
    await screen.findByLabelText('Price (USDC per unit)');

    fireEvent.change(screen.getByLabelText('Price (USDC per unit)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Quantity extractor'), { target: { value: 'constant:3' } });

    expect(screen.getByTestId('call-cost-preview')).toHaveTextContent('This call costs 6.000000 USDC');
    expect(screen.getByTestId('call-cost-preview')).toHaveTextContent('does not change calls already metered');
  });

  it('shows which rate-card version applies from when, and that changes are not retroactive', async () => {
    sessionStorage.setItem(PROVIDER_SESSION_KEY, 'provider-1');
    const api = client({ loadConsole: vi.fn().mockResolvedValue(snapshot()) });

    render(<ProviderConsole client={api} />);

    expect(await screen.findByText(RATE_CARD_NON_RETROACTIVE_NOTICE)).toBeInTheDocument();
    expect(screen.getByTestId('rate-card-v1')).toHaveTextContent(
      'v1 applies from 2026-01-01T00:00:00.000Z until 2026-06-01T00:00:00.000Z',
    );
    expect(screen.getByTestId('rate-card-v1')).toHaveTextContent('Later versions do not replace it.');
    expect(screen.getByTestId('rate-card-v2')).toHaveTextContent('v2 applies from 2026-06-01T00:00:00.000Z');
    expect(screen.getByTestId('settlement-row')).toHaveTextContent('v1 applies from 2026-01-01T00:00:00.000Z');
  });

  it('renders settled, unsettled, and in-dispute revenue as separate figures', async () => {
    sessionStorage.setItem(PROVIDER_SESSION_KEY, 'provider-1');
    const api = client({ loadConsole: vi.fn().mockResolvedValue(snapshot()) });

    render(<ProviderConsole client={api} />);

    expect(await screen.findByTestId('revenue-settled')).toHaveTextContent('Settled');
    expect(screen.getByTestId('revenue-settled')).toHaveTextContent('4.000000 USDC');
    expect(screen.getByTestId('revenue-unsettled')).toHaveTextContent('Unsettled');
    expect(screen.getByTestId('revenue-unsettled')).toHaveTextContent('5.000000 USDC');
    expect(screen.getByTestId('revenue-in-dispute')).toHaveTextContent('In dispute');
    expect(screen.getByTestId('revenue-in-dispute')).toHaveTextContent('6.000000 USDC');
    expect(screen.queryByText(/total revenue/i)).toBeNull();
    expect(screen.queryByText('15.000000 USDC')).toBeNull();
  });
});
