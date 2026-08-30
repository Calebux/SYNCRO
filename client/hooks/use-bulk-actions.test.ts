import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBulkActions } from './use-bulk-actions'

// Mock dependencies
vi.mock('@/lib/supabase/subscriptions', () => ({
  bulkDeleteSubscriptions: vi.fn(),
  updateSubscription: vi.fn(),
}))

vi.mock('@/lib/csv-utils', () => ({
  generateSafeCSV: vi.fn(),
  downloadCSV: vi.fn(),
}))

import { bulkDeleteSubscriptions, updateSubscription } from '@/lib/supabase/subscriptions'
import { generateSafeCSV, downloadCSV } from '@/lib/csv-utils'

describe('useBulkActions', () => {
  const mockSubscriptions = [
    {
      id: 1,
      name: 'Netflix',
      category: 'Entertainment',
      price: 15.99,
      icon: '🎬',
      renewsIn: 5,
      status: 'active',
      color: '#000000',
      renewalUrl: 'https://netflix.com',
      tags: [],
      dateAdded: '2024-01-01',
      emailAccountId: null,
      isTrial: false,
      source: 'manual',
      manuallyEdited: false,
      editedFields: [],
      pricingType: 'fixed',
      billingCycle: 'monthly',
    },
    {
      id: 2,
      name: 'Spotify',
      category: 'Music',
      price: 9.99,
      icon: '🎵',
      renewsIn: 30,
      status: 'active',
      color: '#000000',
      renewalUrl: 'https://spotify.com',
      tags: [],
      dateAdded: '2024-01-02',
      emailAccountId: null,
      isTrial: false,
      source: 'manual',
      manuallyEdited: false,
      editedFields: [],
      pricingType: 'fixed',
      billingCycle: 'monthly',
    },
  ]

  const mockProps = {
    subscriptions: mockSubscriptions,
    selectedSubscriptions: new Set([1]),
    updateSubscriptions: vi.fn(),
    addToHistory: vi.fn(),
    setSelectedSubscriptions: vi.fn(),
    setBulkActionLoading: vi.fn(),
    onToast: vi.fn(),
    onShowDialog: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleBulkExport', () => {
    it('exports selected subscriptions with correct renewal date formatting', () => {
      const { result } = renderHook(() => useBulkActions(mockProps))

      act(() => {
        result.current.handleBulkExport()
      })

      expect(generateSafeCSV).toHaveBeenCalledWith(
        ["Name", "Category", "Price", "Billing Cycle", "Status", "Renewal Date", "Email"],
        [
          ["Netflix", "Entertainment", "15.99", "monthly", "active", "5 days", "N/A"]
        ]
      )

      expect(downloadCSV).toHaveBeenCalledWith(expect.any(String), "subscriptions-export")
      expect(mockProps.onToast).toHaveBeenCalledWith({
        title: "Export successful",
        description: "1 subscription(s) exported to CSV",
        variant: "success",
      })
    })

    it('handles subscriptions with null renewsIn', () => {
      const propsWithNullRenewal = {
        ...mockProps,
        selectedSubscriptions: new Set([2]),
      }

      const { result } = renderHook(() => useBulkActions(propsWithNullRenewal))

      act(() => {
        result.current.handleBulkExport()
      })

      expect(generateSafeCSV).toHaveBeenCalledWith(
        ["Name", "Category", "Price", "Billing Cycle", "Status", "Renewal Date", "Email"],
        [
          ["Spotify", "Music", "9.99", "monthly", "active", "N/A", "N/A"]
        ]
      )
    })

    it('shows error when no subscriptions selected', () => {
      const propsNoSelection = {
        ...mockProps,
        selectedSubscriptions: new Set(),
      }

      const { result } = renderHook(() => useBulkActions(propsNoSelection))

      act(() => {
        result.current.handleBulkExport()
      })

      expect(mockProps.onToast).toHaveBeenCalledWith({
        title: "No subscriptions selected",
        description: "Please select at least one subscription to export",
        variant: "error",
      })

      expect(generateSafeCSV).not.toHaveBeenCalled()
    })
  })

  describe('handleBulkCancel', () => {
    it('cancels subscriptions and calculates activeUntil correctly', async () => {
      const mockUpdateSubscription = vi.mocked(updateSubscription)
      const { result } = renderHook(() => useBulkActions(mockProps))

      mockProps.onShowDialog.mockImplementation(({ onConfirm }) => {
        onConfirm()
      })

      await act(async () => {
        result.current.handleBulkCancel()
      })

      expect(mockUpdateSubscription).toHaveBeenCalledWith(1, {
        status: "cancelled",
        cancelled_at: expect.any(String),
        active_until: expect.any(String),
      })

      expect(mockProps.updateSubscriptions).toHaveBeenCalled()
      expect(mockProps.addToHistory).toHaveBeenCalled()
      expect(mockProps.setSelectedSubscriptions).toHaveBeenCalledWith(new Set())
      expect(mockProps.onToast).toHaveBeenCalledWith({
        title: "Subscriptions cancelled",
        description: "1 subscription(s) have been cancelled",
        variant: "success",
      })
    })

    it('handles subscriptions with null renewsIn in cancellation', async () => {
      const propsWithNullRenewal = {
        ...mockProps,
        selectedSubscriptions: new Set([2]),
      }

      const mockUpdateSubscription = vi.mocked(updateSubscription)
      const { result } = renderHook(() => useBulkActions(propsWithNullRenewal))

      mockProps.onShowDialog.mockImplementation(({ onConfirm }) => {
        onConfirm()
      })

      await act(async () => {
        result.current.handleBulkCancel()
      })

      // Should use renewsIn value (30 days for Spotify)
      const expectedActiveUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

      expect(mockUpdateSubscription).toHaveBeenCalledWith(2, {
        status: "cancelled",
        cancelled_at: expect.any(String),
        active_until: expectedActiveUntil,
      })
    })
  })
})