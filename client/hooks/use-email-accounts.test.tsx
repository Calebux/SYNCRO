import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useEmailAccounts } from './use-email-accounts';

const initialAccounts = [
  { id: 1, email: 'primary@example.com', isPrimary: true },
  { id: 2, email: 'secondary@example.com', isPrimary: false },
];

const subscriptions = [
  { id: 1, name: 'Netflix', emailAccountId: 2, status: 'active' },
  { id: 2, name: 'Figma', emailAccountId: 1, status: 'active' },
] as any[];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderUseEmailAccounts() {
  const updateSubscriptions = vi.fn();
  const addToHistory = vi.fn();
  const onToast = vi.fn();

  const hook = renderHook(
    () =>
      useEmailAccounts({
        initialAccounts,
        subscriptions,
        updateSubscriptions,
        addToHistory,
        onToast,
      }),
    { wrapper: createWrapper() }
  );

  return { ...hook, updateSubscriptions, addToHistory, onToast };
}

describe('useEmailAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T00:00:00.000Z'));
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('adds an email account and increments the Gmail integration count', async () => {
    const { result, onToast } = renderUseEmailAccounts();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.handleAddEmailAccount({
        email: 'new@example.com',
        isPrimary: false,
      });
    });

    await waitFor(() => {
      expect(result.current.emailAccounts).toEqual([
        ...initialAccounts,
        expect.objectContaining({ id: 3, email: 'new@example.com' }),
      ]);
    });

    expect(result.current.integrations.find((item) => item.name === 'Gmail')?.accounts).toBe(3);
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Email account added',
        variant: 'success',
      })
    );
  });

  it('prevents deleting the last remaining primary email', async () => {
    const updateSubscriptions = vi.fn();
    const addToHistory = vi.fn();

    const { result } = renderHook(
      () =>
        useEmailAccounts({
          initialAccounts: [{ id: 1, email: 'only@example.com', isPrimary: true }],
          subscriptions: [],
          updateSubscriptions,
          addToHistory,
          onToast: vi.fn(),
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.handleRemoveEmailAccount(1);
    });

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith(
        'Cannot delete your last email account. You need at least one email to track subscriptions.'
      );
    });

    expect(result.current.emailAccounts).toHaveLength(1);
    expect(updateSubscriptions).not.toHaveBeenCalled();
  });

  it('removes a non-primary email and marks affected subscriptions as source removed', async () => {
    const { result, updateSubscriptions, addToHistory } = renderUseEmailAccounts();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.handleRemoveEmailAccount(2);
    });

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        'This email has 1 subscription(s). These will be marked as "source removed" but kept for your records. Continue?'
      );
    });

    await waitFor(() => {
      const updatedSubscriptions = updateSubscriptions.mock.calls[0][0];
      expect(updatedSubscriptions[0]).toMatchObject({
        id: 1,
        status: 'source_removed',
      });
    });

    const updatedSubscriptions = updateSubscriptions.mock.calls[0][0];
    expect(updatedSubscriptions[0].statusNote).toContain(
      'Email secondary@example.com was disconnected on '
    );
    expect(updatedSubscriptions[1]).toMatchObject({ id: 2, status: 'active' });
    expect(addToHistory).toHaveBeenCalled();

    await waitFor(() => {
      expect(result.current.emailAccounts).toEqual([
        expect.objectContaining({ id: 1, email: 'primary@example.com' }),
      ]);
    });

    expect(result.current.integrations.find((item) => item.name === 'Gmail')?.accounts).toBe(1);
  });

  it('sets a new primary email after confirmation', async () => {
    const { result } = renderUseEmailAccounts();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.handleSetPrimaryEmail(2);
    });

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        'Set secondary@example.com as your primary email? This will be used for new subscriptions and notifications.'
      );
    });

    await waitFor(() => {
      expect(result.current.emailAccounts).toEqual([
        expect.objectContaining({ id: 1, isPrimary: false }),
        expect.objectContaining({ id: 2, isPrimary: true }),
      ]);
    });
  });

  it('rescans an email account and toggles integration status', async () => {
    const { result } = renderUseEmailAccounts();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.handleRescanEmail(1);
    });

    await waitFor(() => {
      expect(result.current.emailAccounts[0].lastScanned).toEqual(
        new Date('2026-04-27T00:00:00.000Z')
      );
    });

    act(() => {
      result.current.handleToggleIntegration(1);
    });

    expect(result.current.integrations.find((item) => item.id === 1)?.status).toBe(
      'disconnected'
    );
  });
});
