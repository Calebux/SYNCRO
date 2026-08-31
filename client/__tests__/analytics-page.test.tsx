/**
 * Tests for #608 — Analytics empty states
 *
 * Covers:
 * - Loading skeleton (aria-busy)
 * - Empty state (no subscriptions) with CTA link
 * - Error state with actionable copy and retry
 * - Network vs server error copy distinction
 * - Successful data render
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnalyticsRoute from '@/app/dashboard/analytics/page';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('@/lib/api/analytics', () => ({
  analyticsApi: {
    getSummary: vi.fn(),
  },
}));

vi.mock('@/components/pages/analytics', () => ({
  default: () => <div data-testid="analytics-page">Analytics Content</div>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: any) => <div data-testid="skeleton" className={className} />,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { analyticsApi } from '@/lib/api/analytics';
const mockGetSummary = analyticsApi.getSummary as ReturnType<typeof vi.fn>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const emptySummary = {
  total_monthly_spend: 0,
  active_subscriptions: 0,
  upcoming_renewals_count: 0,
  monthly_trend: [],
  category_breakdown: [],
  top_subscriptions: [],
  budget_status: { overall_limit: null, current_spend: 0, percentage: 0 },
};

const activeSummary = { ...emptySummary, active_subscriptions: 3 };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AnalyticsRoute — loading state', () => {
  it('renders loading skeletons with aria-busy', async () => {
    // Never resolves during this test
    mockGetSummary.mockReturnValue(new Promise(() => {}));

    render(<AnalyticsRoute />);

    const container = screen.getByLabelText(/loading analytics/i);
    expect(container).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});

describe('AnalyticsRoute — empty state', () => {
  beforeEach(() => {
    mockGetSummary.mockResolvedValue(emptySummary);
  });

  it('renders empty state heading', async () => {
    render(<AnalyticsRoute />);
    expect(await screen.findByRole('heading', { name: /no analytics yet/i })).toBeInTheDocument();
  });

  it('renders CTA link to add subscription', async () => {
    render(<AnalyticsRoute />);
    const link = await screen.findByRole('link', { name: /add your first subscription/i });
    expect(link).toHaveAttribute('href', '/dashboard?action=add');
  });

  it('empty state section has accessible label', async () => {
    render(<AnalyticsRoute />);
    await screen.findByRole('heading', { name: /no analytics yet/i });
    expect(screen.getByRole('region', { name: /no analytics yet/i })).toBeInTheDocument();
  });
});

describe('AnalyticsRoute — error state', () => {
  it('renders generic error copy for server errors', async () => {
    mockGetSummary.mockRejectedValue(new Error('500 Internal Server Error'));

    render(<AnalyticsRoute />);

    expect(await screen.findByText(/failed to load analytics data/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders network-specific error copy for TypeError network errors', async () => {
    const networkErr = new TypeError('network request failed');
    mockGetSummary.mockRejectedValue(networkErr);

    render(<AnalyticsRoute />);

    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
  });

  it('retry button re-fetches data', async () => {
    mockGetSummary
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(activeSummary);

    render(<AnalyticsRoute />);
    const user = userEvent.setup();

    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });
  });
});

describe('AnalyticsRoute — data state', () => {
  it('renders analytics content when data is available', async () => {
    mockGetSummary.mockResolvedValue(activeSummary);

    render(<AnalyticsRoute />);

    expect(await screen.findByTestId('analytics-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /spending analytics/i })).toBeInTheDocument();
  });
});
