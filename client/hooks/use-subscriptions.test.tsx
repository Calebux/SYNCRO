import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSubscriptions } from './use-subscriptions';

const mockApiGet = vi.fn();
const mockCreateSubscription = vi.fn();
const mockUpdateSubscription = vi.fn();
const mockDeleteSubscription = vi.fn();
const mockRetryWithBackoff = vi.fn();
const mockGetErrorMessage = vi.fn();
const mockValidateSubscriptionData = vi.fn();
const mockCheckDuplicate = vi.fn();

vi.mock('../lib/api', () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}));

vi.mock('@/lib/supabase/subscriptions', () => ({
  createSubscription: (...args: unknown[]) => mockCreateSubscription(...args),
  updateSubscription: (...args: unknown[]) => mockUpdateSubscription(...args),
  deleteSubscription: (...args: unknown[]) => mockDeleteSubscription(...args),
  bulkDeleteSubscriptions: vi.fn(),
}));

vi.mock('@/lib/network-utils', () => ({
  retryWithBackoff: (...args: unknown[]) => mockRetryWithBackoff(...args),
  getErrorMessage: (...args: unknown[]) => mockGetErrorMessage(...args),
}));

vi.mock('@/lib/validation', () => ({
  validateSubscriptionData: (...args: unknown[]) =>
    mockValidateSubscriptionData(...args),
}));

vi.mock('@/lib/subscription-utils', () => ({
  checkDuplicate: (...args: unknown[]) => mockCheckDuplicate(...args),
}));

const baseSubscription = {
  id: 1,
  name: 'Netflix',
  category: 'Entertainment',
  price: 15.99,
  icon: 'N',
  renewsIn: 7,
  status: 'active',
  color: '#000000',
  renewalUrl: null,
  tags: [],
  dateAdded: '2026-01-01T00:00:00.000Z',
  emailAccountId: 10,
  lastUsedAt: undefined,
  hasApiKey: false,
  isTrial: false,
  trialEndsAt: undefined,
  priceAfterTrial: undefined,
  source: 'manual',
  manuallyEdited: false,
  editedFields: [],
  pricingType: 'fixed',
  billingCycle: 'monthly',
};

function renderUseSubscriptions(overrides: Partial<Parameters<typeof useSubscriptions>[0]> = {}) {
  const onToast = vi.fn();
  const onUpgradePlan = vi.fn();
  const onDeleteWithUndo = vi.fn();

  const props = {
    initialSubscriptions: [baseSubscription],
    maxSubscriptions: 5,
    emailAccounts: [{ id: 10, email: 'primary@example.com', isPrimary: true }],
    onToast,
    onUpgradePlan,
    onShowDialog: vi.fn(),
    onDeleteWithUndo,
    ...overrides,
  };

  const hook = renderHook((currentProps) => useSubscriptions(currentProps), {
    initialProps: props,
  });

  return { ...hook, props, onToast, onUpgradePlan, onDeleteWithUndo };
}

describe('useSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockApiGet.mockResolvedValue({ subscriptions: [] });
    mockRetryWithBackoff.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    mockValidateSubscriptionData.mockReturnValue({ isValid: true, errors: {} });
    mockCheckDuplicate.mockReturnValue(false);
    mockGetErrorMessage.mockReturnValue('Something went wrong');
    mockUpdateSubscription.mockResolvedValue(undefined);
    mockDeleteSubscription.mockResolvedValue(undefined);
    mockCreateSubscription.mockResolvedValue({
      id: 2,
      name: 'Spotify',
      category: 'Music',
      price: 9.99,
      icon: 'S',
      renews_in: 14,
      status: 'active',
      color: '#111111',
      renewal_url: null,
      tags: ['music'],
      date_added: '2026-02-01T00:00:00.000Z',
      email_account_id: 10,
      last_used_at: null,
      has_api_key: false,
      is_trial: false,
      trial_ends_at: null,
      price_after_trial: null,
      source: 'manual',
      manually_edited: false,
      edited_fields: [],
      pricing_type: 'fixed',
      billing_cycle: 'monthly',
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('hydrates subscriptions from the API on mount', async () => {
    mockApiGet.mockResolvedValue({
      subscriptions: [
        {
          id: 99,
          name: 'API Sub',
          category: 'Work',
          price: 12,
          icon: null,
          renews_in: 21,
          status: 'active',
          color: '#123456',
          renewal_url: 'https://example.com',
          tags: ['team'],
          date_added: '2026-03-01T00:00:00.000Z',
          email_account_id: 10,
          last_used_at: '2026-03-03T00:00:00.000Z',
          has_api_key: true,
          is_trial: true,
          trial_ends_at: '2026-03-10T00:00:00.000Z',
          price_after_trial: 19,
          source: 'auto_detected',
          manually_edited: true,
          edited_fields: ['price'],
          pricing_type: 'tiered',
          billing_cycle: 'yearly',
          expired_at: '2026-04-01T00:00:00.000Z',
        },
      ],
    });

    const { result } = renderUseSubscriptions();

    await waitFor(() => {
      expect(result.current.subscriptions).toHaveLength(1);
      expect(result.current.subscriptions[0]).toMatchObject({
        id: 99,
        name: 'API Sub',
        icon: '🔗',
        renewsIn: 21,
        renewalUrl: 'https://example.com',
        emailAccountId: 10,
        hasApiKey: true,
        isTrial: true,
        source: 'auto_detected',
        manuallyEdited: true,
        editedFields: ['price'],
        pricingType: 'tiered',
        billingCycle: 'yearly',
      });
    });
  });

  it('shows a validation error and skips creation when data is invalid', async () => {
    mockValidateSubscriptionData.mockReturnValue({
      isValid: false,
      errors: { name: 'Name is required' },
    });

    const { result, onToast } = renderUseSubscriptions();

    await act(async () => {
      await result.current.handleAddSubscription({ name: '' });
    });

    expect(mockCreateSubscription).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Validation error',
        description: 'Name is required',
        variant: 'error',
      })
    );
  });

  it('routes users to upgrade when they hit the subscription limit', async () => {
    const { result, onUpgradePlan } = renderUseSubscriptions({
      initialSubscriptions: new Array(5).fill(null).map((_, index) => ({
        ...baseSubscription,
        id: index + 1,
        name: `Sub ${index + 1}`,
      })),
      maxSubscriptions: 5,
    });

    await act(async () => {
      await result.current.handleAddSubscription({
        name: 'Overflow',
        category: 'Misc',
        price: 4,
      });
    });

    expect(onUpgradePlan).toHaveBeenCalledTimes(1);
    expect(mockCreateSubscription).not.toHaveBeenCalled();
  });

  it('adds a subscription successfully and exposes an undo action toast', async () => {
    const { result, onToast } = renderUseSubscriptions();

    await act(async () => {
      await result.current.handleAddSubscription({
        name: 'Spotify',
        category: 'Music',
        price: 9.99,
        tags: ['music'],
      });
    });

    expect(mockCreateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Spotify',
        category: 'Music',
        email_account_id: 10,
        tags: ['music'],
      })
    );

    await waitFor(() => {
      expect(result.current.subscriptions).toHaveLength(2);
    });

    const successToast = onToast.mock.calls.find(
      ([toast]) => toast.title === 'Subscription added'
    )?.[0];

    expect(successToast).toBeDefined();
    expect(successToast.action.label).toBe('Undo');

    await act(async () => {
      await successToast.action.onClick();
    });

    await waitFor(() => {
      expect(mockDeleteSubscription).toHaveBeenCalledWith(2);
    });
  });

  it('supports optimistic delete with undo restoration', async () => {
    const { result, onToast, onDeleteWithUndo } = renderUseSubscriptions();

    await act(async () => {
      await result.current.handleDeleteSubscription(1);
    });

    expect(onDeleteWithUndo).toHaveBeenCalledWith(baseSubscription);
    expect(result.current.subscriptions).toEqual([]);

    const deleteToast = onToast.mock.calls.find(
      ([toast]) => toast.title === 'Subscription deleted'
    )?.[0];

    await act(async () => {
      await deleteToast.action.onClick();
    });

    expect(result.current.subscriptions).toHaveLength(1);
    expect(result.current.subscriptions[0].name).toBe('Netflix');
  });

  it('pauses a subscription through the API and updates local state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T00:00:00.000Z'));
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const { result, onToast } = renderUseSubscriptions();
    const resumeDate = new Date('2026-05-01T00:00:00.000Z');

    await act(async () => {
      await result.current.handlePauseSubscription(1, resumeDate);
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/subscriptions/1/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeAt: resumeDate.toISOString(),
        reason: 'User requested pause',
      }),
    });

    expect(result.current.subscriptions[0]).toMatchObject({
      status: 'paused',
      resumesAt: '2026-05-01T00:00:00.000Z',
    });
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Subscription paused', variant: 'success' })
    );
  });
});
