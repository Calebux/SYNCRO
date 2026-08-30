import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useNotificationActions } from './use-notification-actions'
import type { Subscription } from '@/lib/supabase/subscriptions'
import type { ConfirmationDialog } from './use-confirmation-dialog'
import type { Toast } from './use-toast'

describe('useNotificationActions', () => {
  const mockSubscriptions: Subscription[] = [
    {
      id: 1,
      name: 'Netflix',
      category: 'Entertainment',
      price: 15.99,
      icon: 'netflix',
      renews_in: 5,
      status: 'active',
      color: '#E50914',
      renewal_url: 'https://netflix.com',
      tags: [],
      date_added: '2024-01-01',
      source: 'email',
      manually_edited: false,
      edited_fields: [],
      pricing_type: 'fixed',
      billing_cycle: 'monthly',
      is_trial: false,
    },
    {
      id: 2,
      name: 'Spotify',
      category: 'Entertainment',
      price: 9.99,
      icon: 'spotify',
      renews_in: 10,
      status: 'active',
      color: '#1DB954',
      renewal_url: 'https://spotify.com',
      tags: [],
      date_added: '2024-01-02',
      source: 'email',
      manually_edited: false,
      edited_fields: [],
      pricing_type: 'fixed',
      billing_cycle: 'monthly',
      is_trial: false,
    },
    {
      id: 3,
      name: 'Adobe Creative Cloud',
      category: 'Productivity',
      price: 54.99,
      icon: 'adobe',
      renews_in: 3,
      status: 'active',
      color: '#FF0000',
      renewal_url: 'https://adobe.com',
      tags: [],
      date_added: '2024-01-03',
      source: 'email',
      manually_edited: false,
      edited_fields: [],
      pricing_type: 'fixed',
      billing_cycle: 'monthly',
      is_trial: true,
      trial_ends_at: '2024-05-01',
      price_after_trial: 59.99,
      trial_converts_to_price: 59.99,
    },
  ]

  const mockUpdateSubscriptions = vi.fn()
  const mockAddToHistory = vi.fn()
  const mockOnCancelSubscription = vi.fn()
  const mockOnShowDialog = vi.fn()
  const mockOnToast = vi.fn()
  const mockOnShowInsightsPage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('resolve_duplicate action', () => {
    it('should show dialog with correct information for duplicate resolution', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      const duplicatePayload = {
        subscriptions: [mockSubscriptions[0], mockSubscriptions[1]],
        potentialSavings: 9.99,
      }

      handleResolveNotificationAction('resolve_duplicate', duplicatePayload)

      expect(mockOnShowDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Resolve duplicate subscriptions?',
          description: expect.stringContaining('Netflix'),
          variant: 'warning',
          confirmLabel: 'Resolve',
        })
      )
    })

    it('should remove duplicate subscriptions on confirm', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      const duplicatePayload = {
        subscriptions: [mockSubscriptions[0], mockSubscriptions[1]],
        potentialSavings: 9.99,
      }

      handleResolveNotificationAction('resolve_duplicate', duplicatePayload)

      // Get the dialog that was shown
      const dialogCall = mockOnShowDialog.mock.calls[0][0] as ConfirmationDialog
      dialogCall.onConfirm()

      expect(mockUpdateSubscriptions).toHaveBeenCalledWith(
        expect.arrayContaining([mockSubscriptions[0]])
      )
      expect(mockAddToHistory).toHaveBeenCalled()
      expect(mockOnToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Duplicate resolved',
          variant: 'success',
        })
      )
    })
  })

  describe('cancel_unused action', () => {
    it('should show dialog for unused subscription', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      handleResolveNotificationAction('cancel_unused', 1)

      expect(mockOnShowDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cancel unused subscription?',
          description: expect.stringContaining('Netflix'),
          variant: 'warning',
        })
      )
    })

    it('should cancel subscription on confirm', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      handleResolveNotificationAction('cancel_unused', 1)

      const dialogCall = mockOnShowDialog.mock.calls[0][0] as ConfirmationDialog
      dialogCall.onConfirm()

      expect(mockOnCancelSubscription).toHaveBeenCalledWith(1)
      expect(mockOnToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Subscription cancelled',
          variant: 'success',
        })
      )
    })

    it('should not show dialog if subscription not found', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      handleResolveNotificationAction('cancel_unused', 999)

      expect(mockOnShowDialog).not.toHaveBeenCalled()
    })
  })

  describe('cancel_trial action', () => {
    it('should show dialog for trial subscription', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      handleResolveNotificationAction('cancel_trial', 3)

      expect(mockOnShowDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cancel trial subscription?',
          description: expect.stringContaining('Adobe Creative Cloud'),
          variant: 'warning',
        })
      )
    })

    it('should cancel trial subscription on confirm', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      handleResolveNotificationAction('cancel_trial', 3)

      const dialogCall = mockOnShowDialog.mock.calls[0][0] as ConfirmationDialog
      dialogCall.onConfirm()

      expect(mockOnCancelSubscription).toHaveBeenCalledWith(3)
      expect(mockOnToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Trial cancelled',
          variant: 'success',
        })
      )
    })

    it('should not show dialog if trial subscription not found', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      handleResolveNotificationAction('cancel_trial', 999)

      expect(mockOnShowDialog).not.toHaveBeenCalled()
    })
  })

  describe('view_consolidation action', () => {
    it('should show insights page', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      handleResolveNotificationAction('view_consolidation', undefined)

      expect(mockOnShowInsightsPage).toHaveBeenCalled()
    })
  })

  describe('unknown action', () => {
    it('should log warning for unknown action', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn')

      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      handleResolveNotificationAction('unknown_action' as any, {})

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown notification action')
      )

      consoleWarnSpy.mockRestore()
    })
  })

  describe('type safety', () => {
    it('should accept valid action types', () => {
      const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: mockSubscriptions,
        updateSubscriptions: mockUpdateSubscriptions,
        addToHistory: mockAddToHistory,
        onCancelSubscription: mockOnCancelSubscription,
        onShowDialog: mockOnShowDialog,
        onToast: mockOnToast,
        onShowInsightsPage: mockOnShowInsightsPage,
      })

      // These should not cause TypeScript errors
      expect(() => handleResolveNotificationAction('resolve_duplicate', {
        subscriptions: mockSubscriptions,
        potentialSavings: 10,
      })).not.toThrow()

      expect(() => handleResolveNotificationAction('cancel_unused', 1)).not.toThrow()

      expect(() => handleResolveNotificationAction('cancel_trial', 2)).not.toThrow()

      expect(() => handleResolveNotificationAction('view_consolidation', undefined)).not.toThrow()
    })
  })
})
