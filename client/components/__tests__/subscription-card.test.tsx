import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, it, expect, vi, beforeEach } from 'vitest'
import { SubscriptionCard } from '../pages/subscriptions'
import { mockSubscription, mockCancellationGuide } from '@/lib/test-utils'

vi.mock('@/components/providers/user-settings-provider', () => ({
  useUserSettings: () => ({
    settings: { currency: 'USD', timezone: 'UTC', locale: 'en-US', privacyModeEnabled: false },
    updateSettings: vi.fn(),
    isLoading: false,
  }),
}))

describe('SubscriptionCard', () => {
  const defaultProps = {
    subscription: mockSubscription({
      id: '1',
      name: 'Netflix',
      price: 15.99,
      category: 'Streaming',
      status: 'active',
      renewsIn: 30,
      icon: '📺',
    }),
    onDelete: vi.fn(),
    selectedSubscriptions: new Set<string>(),
    onToggleSelect: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    test('displays subscription name, price, billing cycle, and status', () => {
      render(<SubscriptionCard {...defaultProps} />)

      expect(screen.getByText('Netflix')).toBeInTheDocument()
      expect(screen.getByText('$15.99')).toBeInTheDocument()
      expect(screen.getByText('/Month')).toBeInTheDocument()
      expect(screen.getByText('Streaming')).toBeInTheDocument()
      expect(screen.getByText(/Renewal in 30 days/i)).toBeInTheDocument()
    })

    test('displays paused status correctly', () => {
      const pausedSub = mockSubscription({ ...defaultProps.subscription, status: 'paused' })
      render(<SubscriptionCard {...defaultProps} subscription={pausedSub} />)

      expect(screen.getAllByText(/Paused/i).length).toBeGreaterThan(0)
    })

    test('displays cancelled status correctly', () => {
      const cancelledSub = mockSubscription({ ...defaultProps.subscription, status: 'cancelled' })
      render(<SubscriptionCard {...defaultProps} subscription={cancelledSub} />)

      expect(screen.getAllByText(/cancelled/i).length).toBeGreaterThan(0)
    })

    test('displays trial status correctly', () => {
      const trialSub = mockSubscription({
        ...defaultProps.subscription,
        isTrial: true,
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        priceAfterTrial: 19.99,
      })
      render(<SubscriptionCard {...defaultProps} subscription={trialSub} />)

      expect(screen.getByText(/Trial ends in/i)).toBeInTheDocument()
      expect(screen.getByText(/\$19\.99\/month after/i)).toBeInTheDocument()
    })

    test('displays duplicate badge when isDuplicate is true', () => {
      render(<SubscriptionCard {...defaultProps} isDuplicate={true} />)

      expect(screen.getByText('Duplicate')).toBeInTheDocument()
    })

    test('displays unused badge when unusedInfo is provided', () => {
      render(<SubscriptionCard {...defaultProps} unusedInfo={{ lastUsed: '2024-01-01' }} />)

      expect(screen.getByText('Potentially Wasted')).toBeInTheDocument()
    })

    test('displays price change indicator', () => {
      const subWithPriceChange = mockSubscription({
        ...defaultProps.subscription,
        latest_price_change: {
          old_price: 12.99,
          new_price: 15.99,
          changed_at: '2024-01-01',
        },
      })
      render(<SubscriptionCard {...defaultProps} subscription={subWithPriceChange} />)

      expect(screen.getByText(/Price Changed/i)).toBeInTheDocument()
    })

    test('displays email when provided', () => {
      const subWithEmail = mockSubscription({
        ...defaultProps.subscription,
        email: 'user@example.com',
      })
      render(<SubscriptionCard {...defaultProps} subscription={subWithEmail} />)

      expect(screen.getByText('user@example.com')).toBeInTheDocument()
    })

    test('displays encrypted lock indicator when subscription is encrypted', () => {
      const encryptedSub = mockSubscription({
        ...defaultProps.subscription,
        is_encrypted: true,
      })
      render(<SubscriptionCard {...defaultProps} subscription={encryptedSub} />)

      expect(screen.getByTitle(/encrypted on-chain data/i)).toBeInTheDocument()
    })

    test('displays plaintext lock indicator when subscription is not encrypted', () => {
      const plaintextSub = mockSubscription({
        ...defaultProps.subscription,
        is_encrypted: false,
      })
      render(<SubscriptionCard {...defaultProps} subscription={plaintextSub} />)

      expect(screen.getByTitle(/plaintext on-chain/i)).toBeInTheDocument()
    })

    test('displays cancellation difficulty badge when guide is provided', () => {
      const guide = mockCancellationGuide({
        difficulty: 'hard',
        steps: [],
      })
      render(<SubscriptionCard {...defaultProps} guide={guide} />)

      expect(screen.getByText(/hard to cancel/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    test('calls onDelete when delete button is clicked', async () => {
      const user = userEvent.setup()
      render(<SubscriptionCard {...defaultProps} />)

      const deleteButton = screen.getByLabelText(/Delete Netflix/i)
      await user.click(deleteButton)

      expect(defaultProps.onDelete).toHaveBeenCalledWith('1')
    })

    test('calls onManage when edit button is clicked', async () => {
      const user = userEvent.setup()
      const onManage = vi.fn()
      render(<SubscriptionCard {...defaultProps} onManage={onManage} />)

      const editButton = screen.getByLabelText(/Edit Netflix/i)
      await user.click(editButton)

      expect(onManage).toHaveBeenCalledWith(defaultProps.subscription)
    })

    test('calls onToggleSelect when checkbox is clicked', async () => {
      const user = userEvent.setup()
      render(<SubscriptionCard {...defaultProps} />)

      const checkbox = screen.getByLabelText(/Select Netflix/i)
      await user.click(checkbox)

      expect(defaultProps.onToggleSelect).toHaveBeenCalledWith('1')
    })

    test('checkbox reflects selected state', () => {
      const selectedSet = new Set(['1'])
      render(<SubscriptionCard {...defaultProps} selectedSubscriptions={selectedSet} />)

      const checkbox = screen.getByLabelText(/Select Netflix/i) as HTMLInputElement
      expect(checkbox.checked).toBe(true)
    })

    test('calls onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<SubscriptionCard {...defaultProps} onCancel={onCancel} />)

      const cancelButton = screen.getByLabelText(/Cancel Netflix/i)
      await user.click(cancelButton)

      expect(onCancel).toHaveBeenCalledWith(defaultProps.subscription)
    })

    test('calls onPause when pause button is clicked', async () => {
      const user = userEvent.setup()
      const onPause = vi.fn()
      render(<SubscriptionCard {...defaultProps} onPause={onPause} />)

      const pauseButton = screen.getByLabelText(/Pause Netflix/i)
      await user.click(pauseButton)

      expect(onPause).toHaveBeenCalledWith(defaultProps.subscription)
    })

    test('calls onResume when resume button is clicked for paused subscription', async () => {
      const user = userEvent.setup()
      const onResume = vi.fn()
      const pausedSub = mockSubscription({ ...defaultProps.subscription, status: 'paused' })
      render(<SubscriptionCard {...defaultProps} subscription={pausedSub} onResume={onResume} />)

      const resumeButton = screen.getByLabelText(/Resume Netflix/i)
      await user.click(resumeButton)

      expect(onResume).toHaveBeenCalledWith(pausedSub)
    })

    test('does not show cancel button for cancelled subscriptions', () => {
      const cancelledSub = mockSubscription({ ...defaultProps.subscription, status: 'cancelled' })
      render(<SubscriptionCard {...defaultProps} subscription={cancelledSub} />)

      expect(screen.queryByLabelText(/Cancel Netflix/i)).not.toBeInTheDocument()
    })

    test('does not show pause button for paused subscriptions', () => {
      const pausedSub = mockSubscription({ ...defaultProps.subscription, status: 'paused' })
      render(<SubscriptionCard {...defaultProps} subscription={pausedSub} />)

      expect(screen.queryByLabelText(/Pause Netflix/i)).not.toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    test('has proper ARIA label with subscription details', () => {
      render(<SubscriptionCard {...defaultProps} />)

      const card = screen.getByLabelText(/Netflix, Streaming, \$15\.99\/month, active/i)
      expect(card).toBeInTheDocument()
    })

    test('action buttons have descriptive aria-labels', () => {
      render(<SubscriptionCard {...defaultProps} />)

      expect(screen.getByLabelText(/Edit Netflix/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Delete Netflix/i)).toBeInTheDocument()
    })

    test('checkbox has descriptive aria-label', () => {
      render(<SubscriptionCard {...defaultProps} />)

      expect(screen.getByLabelText(/Select Netflix/i)).toBeInTheDocument()
    })

    test('action buttons group has proper role and label', () => {
      render(<SubscriptionCard {...defaultProps} />)

      const actionGroup = screen.getByRole('group', { name: /Actions for Netflix/i })
      expect(actionGroup).toBeInTheDocument()
    })
  })

  describe('Dark Mode', () => {
    test('applies dark mode styles when darkMode prop is true', () => {
      const { container } = render(<SubscriptionCard {...defaultProps} darkMode={true} />)

      const card = container.querySelector('.bg-\\[\\#2D3748\\]')
      expect(card).toBeInTheDocument()
    })

    test('applies light mode styles when darkMode prop is false', () => {
      const { container } = render(<SubscriptionCard {...defaultProps} darkMode={false} />)

      const card = container.querySelector('.bg-white')
      expect(card).toBeInTheDocument()
    })
  })

  describe('Visibility Toggle', () => {
    test('displays team visibility badge', () => {
      const teamSub = mockSubscription({ ...defaultProps.subscription, visibility: 'team' })
      render(<SubscriptionCard {...defaultProps} subscription={teamSub} />)

      expect(screen.getByText('Team')).toBeInTheDocument()
    })

    test('displays private visibility badge', () => {
      const privateSub = mockSubscription({ ...defaultProps.subscription, visibility: 'private' })
      render(<SubscriptionCard {...defaultProps} subscription={privateSub} />)

      expect(screen.getByText('Private')).toBeInTheDocument()
    })

    test('calls onManage with toggleVisibility flag when visibility button is clicked', async () => {
      const user = userEvent.setup()
      const onManage = vi.fn()
      render(<SubscriptionCard {...defaultProps} onManage={onManage} />)

      const visibilityButton = screen.getByTitle(/Private/i)
      await user.click(visibilityButton)

      expect(onManage).toHaveBeenCalledWith(
        expect.objectContaining({
          toggleVisibility: true,
        })
      )
    })
  })
})

