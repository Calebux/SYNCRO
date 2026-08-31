import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, it, expect, vi, beforeEach } from 'vitest'
import NotificationsPanel from '../notifications-panel'
import { mockNotification } from '@/lib/test-utils'

describe('NotificationsPanel', () => {
  const defaultProps = {
    notifications: [
      mockNotification({
        id: '1',
        title: 'Trial Ending Soon',
        description: 'Your Netflix trial ends in 3 days',
        type: 'trial',
        read: false,
      }),
      mockNotification({
        id: '2',
        title: 'Price Increase',
        description: 'Spotify increased to $12.99/month',
        type: 'price_change',
        read: true,
      }),
    ],
    onMarkRead: vi.fn(),
    onClose: vi.fn(),
    onAddSubscription: vi.fn(),
    onResolveAction: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    test('displays panel title', () => {
      render(<NotificationsPanel {...defaultProps} />)

      expect(screen.getByText('Notifications')).toBeInTheDocument()
    })

    test('displays all notifications', () => {
      render(<NotificationsPanel {...defaultProps} />)

      expect(screen.getByText('Trial Ending Soon')).toBeInTheDocument()
      expect(screen.getByText('Your Netflix trial ends in 3 days')).toBeInTheDocument()
      expect(screen.getByText('Price Increase')).toBeInTheDocument()
      expect(screen.getByText('Spotify increased to $12.99/month')).toBeInTheDocument()
    })

    test('displays unread count in screen reader text', () => {
      render(<NotificationsPanel {...defaultProps} />)

      const title = screen.getByRole('heading', { name: /Notifications/i })
      expect(within(title).getByText(/1 unread/i)).toBeInTheDocument()
    })

    test('displays empty state when no notifications', () => {
      render(<NotificationsPanel {...defaultProps} notifications={[]} />)

      expect(screen.getByText('No notifications')).toBeInTheDocument()
      expect(screen.getByText(/You're all caught up/i)).toBeInTheDocument()
    })

    test('displays notification icons based on type', () => {
      const notifications = [
        mockNotification({ id: '1', type: 'duplicate', title: 'Duplicate', description: 'Test' }),
        mockNotification({ id: '2', type: 'unused', title: 'Unused', description: 'Test' }),
        mockNotification({ id: '3', type: 'trial', title: 'Trial', description: 'Test' }),
        mockNotification({ id: '4', type: 'price_change', title: 'Price', description: 'Test' }),
        mockNotification({ id: '5', type: 'renewal', title: 'Renewal', description: 'Test' }),
        mockNotification({ id: '6', type: 'budget', title: 'Budget', description: 'Test' }),
        mockNotification({ id: '7', type: 'consolidation', title: 'Consolidation', description: 'Test' }),
        mockNotification({ id: '8', type: 'alert', title: 'Alert', description: 'Test' }),
      ]

      render(<NotificationsPanel {...defaultProps} notifications={notifications} />)

      // Verify all notification types are rendered
      expect(screen.getByText('Duplicate')).toBeInTheDocument()
      expect(screen.getByText('Unused')).toBeInTheDocument()
      expect(screen.getByText('Trial')).toBeInTheDocument()
      expect(screen.getByText('Price')).toBeInTheDocument()
      expect(screen.getByText('Renewal')).toBeInTheDocument()
      expect(screen.getByText('Budget')).toBeInTheDocument()
      expect(screen.getByText('Consolidation')).toBeInTheDocument()
      expect(screen.getByText('Alert')).toBeInTheDocument()
    })

    test('highlights unread notifications', () => {
      render(<NotificationsPanel {...defaultProps} />)

      const unreadNotification = screen.getByLabelText(/Trial Ending Soon, unread/i)
      expect(unreadNotification).toHaveClass('bg-blue-50')
    })

    test('shows read notifications with different styling', () => {
      render(<NotificationsPanel {...defaultProps} />)

      const readNotification = screen.getByLabelText(/Price Increase$/i)
      expect(readNotification).toHaveClass('bg-gray-50')
    })
  })

  describe('User Interactions', () => {
    test('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<NotificationsPanel {...defaultProps} />)

      const closeButton = screen.getByLabelText(/Close notifications panel/i)
      await user.click(closeButton)

      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    test('calls onMarkRead when unread indicator is clicked', async () => {
      const user = userEvent.setup()
      render(<NotificationsPanel {...defaultProps} />)

      const markReadButton = screen.getByLabelText(/Mark "Trial Ending Soon" as read/i)
      await user.click(markReadButton)

      expect(defaultProps.onMarkRead).toHaveBeenCalledWith('1')
    })

    test('calls onMarkRead for all notifications when "Mark all as read" is clicked', async () => {
      const user = userEvent.setup()
      render(<NotificationsPanel {...defaultProps} />)

      const markAllButton = screen.getByRole('button', { name: /Mark all as read/i })
      await user.click(markAllButton)

      expect(defaultProps.onMarkRead).toHaveBeenCalledTimes(2)
      expect(defaultProps.onMarkRead).toHaveBeenCalledWith('1')
      expect(defaultProps.onMarkRead).toHaveBeenCalledWith('2')
    })

    test('calls onAddSubscription when "Add to Dashboard" is clicked for alert notification', async () => {
      const user = userEvent.setup()
      const detectedSubscription = { name: 'Hulu', price: 7.99 }
      const alertNotification = mockNotification({
        id: '3',
        type: 'alert',
        title: 'New Subscription Detected',
        description: 'We found Hulu',
        detectedSubscription,
      })

      render(
        <NotificationsPanel
          {...defaultProps}
          notifications={[alertNotification]}
        />
      )

      const addButton = screen.getByRole('button', { name: /Add to Dashboard/i })
      await user.click(addButton)

      expect(defaultProps.onAddSubscription).toHaveBeenCalledWith(detectedSubscription)
      expect(defaultProps.onMarkRead).toHaveBeenCalledWith('3')
    })

    test('calls onResolveAction for duplicate notification', async () => {
      const user = userEvent.setup()
      const duplicateInfo = { subscriptionIds: [1, 2] }
      const duplicateNotification = mockNotification({
        id: '4',
        type: 'duplicate',
        title: 'Duplicate Found',
        description: 'You have duplicate subscriptions',
        duplicateInfo,
      })

      render(
        <NotificationsPanel
          {...defaultProps}
          notifications={[duplicateNotification]}
        />
      )

      const resolveButton = screen.getByRole('button', { name: /Resolve Duplicate/i })
      await user.click(resolveButton)

      expect(defaultProps.onResolveAction).toHaveBeenCalledWith('resolve_duplicate', duplicateInfo)
      expect(defaultProps.onMarkRead).toHaveBeenCalledWith('4')
    })

    test('calls onResolveAction for unused notification', async () => {
      const user = userEvent.setup()
      const unusedNotification = mockNotification({
        id: '5',
        type: 'unused',
        title: 'Unused Subscription',
        description: 'You haven\'t used this in 60 days',
        subscriptionid: '123',
      })

      render(
        <NotificationsPanel
          {...defaultProps}
          notifications={[unusedNotification]}
        />
      )

      const cancelButton = screen.getByRole('button', { name: /Cancel Subscription/i })
      await user.click(cancelButton)

      expect(defaultProps.onResolveAction).toHaveBeenCalledWith('cancel_unused', 123)
      expect(defaultProps.onMarkRead).toHaveBeenCalledWith('5')
    })

    test('calls onResolveAction for trial notification', async () => {
      const user = userEvent.setup()
      const trialNotification = mockNotification({
        id: '6',
        type: 'trial',
        title: 'Trial Ending',
        description: 'Cancel before you get charged',
        subscriptionid: '456',
      })

      render(
        <NotificationsPanel
          {...defaultProps}
          notifications={[trialNotification]}
        />
      )

      const cancelButton = screen.getByRole('button', { name: /Cancel Before Charge/i })
      await user.click(cancelButton)

      expect(defaultProps.onResolveAction).toHaveBeenCalledWith('cancel_trial', 456)
      expect(defaultProps.onMarkRead).toHaveBeenCalledWith('6')
    })

    test('calls onResolveAction for consolidation notification', async () => {
      const user = userEvent.setup()
      const consolidationNotification = mockNotification({
        id: '7',
        type: 'consolidation',
        title: 'Consolidation Opportunity',
        description: 'Save money by bundling',
        suggestionid: '789',
      })

      render(
        <NotificationsPanel
          {...defaultProps}
          notifications={[consolidationNotification]}
        />
      )

      const viewButton = screen.getByRole('button', { name: /View Details/i })
      await user.click(viewButton)

      expect(defaultProps.onResolveAction).toHaveBeenCalledWith('view_consolidation', 789)
      expect(defaultProps.onMarkRead).toHaveBeenCalledWith('7')
    })
  })

  describe('Accessibility', () => {
    test('has proper dialog role and labels', () => {
      render(<NotificationsPanel {...defaultProps} />)

      const dialog = screen.getByRole('dialog', { name: /Notifications/i })
      expect(dialog).toBeInTheDocument()
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    test('has aria-live region for unread count', () => {
      render(<NotificationsPanel {...defaultProps} />)

      // The aria-live region is a div with sr-only class
      const liveRegion = screen.getByText(/1 unread notification/i).closest('[aria-live]')
      expect(liveRegion).toHaveAttribute('aria-live', 'polite')
    })

    test('notification list has proper role and label', () => {
      render(<NotificationsPanel {...defaultProps} />)

      const list = screen.getByRole('list', { name: /Notifications/i })
      expect(list).toBeInTheDocument()
    })

    test('each notification has listitem role', () => {
      render(<NotificationsPanel {...defaultProps} />)

      const listitems = screen.getAllByRole('listitem')
      expect(listitems).toHaveLength(2)
    })

    test('close button has descriptive aria-label', () => {
      render(<NotificationsPanel {...defaultProps} />)

      expect(screen.getByLabelText(/Close notifications panel/i)).toBeInTheDocument()
    })

    test('focuses close button on mount', () => {
      render(<NotificationsPanel {...defaultProps} />)

      const closeButton = screen.getByLabelText(/Close notifications panel/i)
      expect(closeButton).toHaveFocus()
    })
  })

  describe('Dark Mode', () => {
    test('applies dark mode styles when darkMode prop is true', () => {
      const { container } = render(<NotificationsPanel {...defaultProps} darkMode={true} />)

      const panel = container.querySelector('.bg-\\[\\#2D3748\\]')
      expect(panel).toBeInTheDocument()
    })

    test('applies light mode styles when darkMode prop is false', () => {
      const { container } = render(<NotificationsPanel {...defaultProps} darkMode={false} />)

      const panel = container.querySelector('.bg-white')
      expect(panel).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    test('displays empty state with proper dialog attributes', () => {
      render(<NotificationsPanel {...defaultProps} notifications={[]} />)

      const dialog = screen.getByRole('dialog', { name: /Notifications panel, no notifications/i })
      expect(dialog).toBeInTheDocument()
    })

    test('empty state has close button', () => {
      render(<NotificationsPanel {...defaultProps} notifications={[]} />)

      const closeButton = screen.getByLabelText(/Close notifications panel/i)
      expect(closeButton).toBeInTheDocument()
    })
  })
})


