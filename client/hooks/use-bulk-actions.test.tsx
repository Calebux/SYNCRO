import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBulkActions } from './use-bulk-actions';

const mockBulkDeleteSubscriptions = vi.fn();
const mockUpdateSubscription = vi.fn();
const mockGenerateSafeCSV = vi.fn();
const mockDownloadCSV = vi.fn();

vi.mock('@/lib/supabase/subscriptions', () => ({
  bulkDeleteSubscriptions: (...args: unknown[]) =>
    mockBulkDeleteSubscriptions(...args),
  updateSubscription: (...args: unknown[]) => mockUpdateSubscription(...args),
}));

vi.mock('@/lib/csv-utils', () => ({
  generateSafeCSV: (...args: unknown[]) => mockGenerateSafeCSV(...args),
  downloadCSV: (...args: unknown[]) => mockDownloadCSV(...args),
}));

const subscriptions = [
  { id: 1, name: 'Netflix', category: 'Streaming', price: 10, status: 'active', renewsIn: 3 },
  { id: 2, name: 'Figma', category: 'Work', price: 20, status: 'active', renewsIn: 10 },
] as any[];

function renderUseBulkActions(selectedSubscriptions = new Set<number>([1, 2])) {
  const updateSubscriptions = vi.fn();
  const addToHistory = vi.fn();
  const setSelectedSubscriptions = vi.fn();
  const setBulkActionLoading = vi.fn();
  const onToast = vi.fn();
  const onShowDialog = vi.fn();

  const hook = renderHook(() =>
    useBulkActions({
      subscriptions,
      selectedSubscriptions,
      updateSubscriptions,
      addToHistory,
      setSelectedSubscriptions,
      setBulkActionLoading,
      onToast,
      onShowDialog,
    })
  );

  return {
    ...hook,
    updateSubscriptions,
    addToHistory,
    setSelectedSubscriptions,
    setBulkActionLoading,
    onToast,
    onShowDialog,
  };
}

describe('useBulkActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockBulkDeleteSubscriptions.mockResolvedValue(undefined);
    mockUpdateSubscription.mockResolvedValue(undefined);
    mockGenerateSafeCSV.mockReturnValue('csv-content');
  });

  it('shows an error toast when delete is attempted with no selection', () => {
    const { result, onToast, onShowDialog } = renderUseBulkActions(new Set());

    act(() => {
      result.current.handleBulkDelete();
    });

    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'No subscriptions selected',
        variant: 'error',
      })
    );
    expect(onShowDialog).not.toHaveBeenCalled();
  });

  it('confirms and deletes selected subscriptions', async () => {
    const {
      result,
      onShowDialog,
      updateSubscriptions,
      addToHistory,
      setSelectedSubscriptions,
      setBulkActionLoading,
      onToast,
    } = renderUseBulkActions();

    act(() => {
      result.current.handleBulkDelete();
    });

    const dialog = onShowDialog.mock.calls[0][0];
    expect(dialog.title).toBe('Delete selected subscriptions?');

    await act(async () => {
      await dialog.onConfirm();
    });

    expect(mockBulkDeleteSubscriptions).toHaveBeenCalledWith([1, 2]);
    expect(updateSubscriptions).toHaveBeenCalledWith([]);
    expect(addToHistory).toHaveBeenCalledWith([]);
    expect(setSelectedSubscriptions).toHaveBeenCalledWith(new Set());
    expect(setBulkActionLoading).toHaveBeenNthCalledWith(1, true);
    expect(setBulkActionLoading).toHaveBeenLastCalledWith(false);
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'All subscriptions deleted',
        variant: 'success',
      })
    );
  });

  it('exports selected subscriptions as CSV', () => {
    const { result, onToast } = renderUseBulkActions(new Set([2]));

    act(() => {
      result.current.handleBulkExport();
    });

    expect(mockGenerateSafeCSV).toHaveBeenCalledWith(
      ['Name', 'Category', 'Price', 'Billing Cycle', 'Status', 'Renewal Date', 'Email'],
      [['Figma', 'Work', 20, 'monthly', 'active', '10 days', 'N/A']]
    );
    expect(mockDownloadCSV).toHaveBeenCalledWith('csv-content', 'subscriptions-export');
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Export successful',
        variant: 'success',
      })
    );
  });

  it('cancels selected subscriptions and stamps deterministic dates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T00:00:00.000Z'));

    const {
      result,
      onShowDialog,
      updateSubscriptions,
      addToHistory,
      setSelectedSubscriptions,
      setBulkActionLoading,
      onToast,
    } = renderUseBulkActions(new Set([1]));

    act(() => {
      result.current.handleBulkCancel();
    });

    const dialog = onShowDialog.mock.calls[0][0];

    await act(async () => {
      await dialog.onConfirm();
    });

    expect(mockUpdateSubscription).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'cancelled',
        cancelled_at: '2026-04-27T00:00:00.000Z',
        active_until: '2026-04-30T00:00:00.000Z',
      })
    );
    expect(updateSubscriptions).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 1,
        status: 'cancelled',
        cancelledAt: '2026-04-27T00:00:00.000Z',
        activeUntil: '2026-04-30T00:00:00.000Z',
      }),
      expect.objectContaining({ id: 2, status: 'active' }),
    ]);
    expect(addToHistory).toHaveBeenCalled();
    expect(setSelectedSubscriptions).toHaveBeenCalledWith(new Set());
    expect(setBulkActionLoading).toHaveBeenNthCalledWith(1, true);
    expect(setBulkActionLoading).toHaveBeenLastCalledWith(false);
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Subscriptions cancelled',
        variant: 'success',
      })
    );
  });

  it('pauses selected subscriptions for 30 days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T00:00:00.000Z'));

    const { result, onShowDialog, updateSubscriptions } = renderUseBulkActions(
      new Set([1])
    );

    act(() => {
      result.current.handleBulkPause();
    });

    const dialog = onShowDialog.mock.calls[0][0];

    await act(async () => {
      await dialog.onConfirm();
    });

    expect(mockUpdateSubscription).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'paused',
        paused_at: '2026-04-27T00:00:00.000Z',
        resumes_at: '2026-05-27T00:00:00.000Z',
      })
    );
    expect(updateSubscriptions).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 1,
        status: 'paused',
        pausedAt: '2026-04-27T00:00:00.000Z',
        resumesAt: '2026-05-27T00:00:00.000Z',
      }),
      expect.objectContaining({ id: 2, status: 'active' }),
    ]);
  });
});
