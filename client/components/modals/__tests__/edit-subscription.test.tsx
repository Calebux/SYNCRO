import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, it, expect, vi, beforeEach } from 'vitest'
import EditSubscriptionModal from '../edit-subscription-modal'
import { mockSubscription } from '@/lib/test-utils'

describe('EditSubscriptionModal', () => {
  const defaultSubscription = mockSubscription({
    id: '1',
    name: 'Netflix',
    price: 15.99,
    billingCycle: 'monthly',
    renewsIn: 30,
    category: 'Streaming',
    tags: ['entertainment', 'video'],
    renewalUrl: 'https://netflix.com/billing',
    notes: 'Family plan',
    source: 'manual',
  })

  const defaultProps = {
    subscription: defaultSubscription,
    onSave: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    test('displays modal title', () => {
      render(<EditSubscriptionModal {...defaultProps} />)

      expect(screen.getByText('Edit Subscription')).toBeInTheDocument()
    })

    test('pre-populates form fields with existing data', () => {
      render(<EditSubscriptionModal {...defaultProps} />)

      expect(screen.getByDisplayValue('Netflix')).toBeInTheDocument()
      expect(screen.getByDisplayValue('15.99')).toBeInTheDocument()
      // Check select value, not display text
      const billingCycleSelect = screen.getByLabelText(/Billing Cycle/i) as HTMLSelectElement
      expect(billingCycleSelect.value).toBe('monthly')
      expect(screen.getByDisplayValue('30')).toBeInTheDocument()
      const categorySelect = screen.getByLabelText(/Category/i) as HTMLSelectElement
      expect(categorySelect.value).toBe('Streaming')
      expect(screen.getByDisplayValue('entertainment, video')).toBeInTheDocument()
      expect(screen.getByDisplayValue('https://netflix.com/billing')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Family plan')).toBeInTheDocument()
    })

    test('displays all form fields', () => {
      render(<EditSubscriptionModal {...defaultProps} />)

      expect(screen.getByLabelText(/Subscription Name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Price/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Billing Cycle/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Days Until Renewal/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Category/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Tags/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Notes/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Renewal\/Management URL/i)).toBeInTheDocument()
    })

    test('displays action buttons', () => {
      render(<EditSubscriptionModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument()
    })

    test('hides renewal days field for lifetime subscriptions', () => {
      const lifetimeSub = mockSubscription({ ...defaultSubscription, billingCycle: 'lifetime' })
      render(<EditSubscriptionModal {...defaultProps} subscription={lifetimeSub} />)

      expect(screen.queryByLabelText(/Days Until Renewal/i)).not.toBeInTheDocument()
    })

    test('displays warning for auto-detected subscriptions', () => {
      const autoSub = mockSubscription({ ...defaultSubscription, source: 'auto_detected' })
      render(<EditSubscriptionModal {...defaultProps} subscription={autoSub} />)

      expect(screen.getByText(/This subscription was auto-detected/i)).toBeInTheDocument()
      expect(screen.getByText(/Manual edits will prevent automatic updates/i)).toBeInTheDocument()
    })
  })

  describe('Form Editing', () => {
    test('allows editing subscription name', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      await user.clear(nameInput)
      await user.type(nameInput, 'Netflix Premium')

      expect(nameInput).toHaveValue('Netflix Premium')
    })

    test('allows editing price', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const priceInput = screen.getByLabelText(/Price/i)
      await user.clear(priceInput)
      await user.type(priceInput, '19.99')

      expect(priceInput).toHaveValue(19.99)
    })

    test('allows changing billing cycle', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const billingCycleSelect = screen.getByLabelText(/Billing Cycle/i)
      await user.selectOptions(billingCycleSelect, 'annual')

      expect(billingCycleSelect).toHaveValue('annual')
    })

    test('allows editing renewal days', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const renewalInput = screen.getByLabelText(/Days Until Renewal/i)
      await user.clear(renewalInput)
      await user.type(renewalInput, '15')

      expect(renewalInput).toHaveValue(15)
    })

    test('allows changing category', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const categorySelect = screen.getByLabelText(/Category/i)
      await user.selectOptions(categorySelect, 'Productivity')

      expect(categorySelect).toHaveValue('Productivity')
    })

    test('allows editing tags', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const tagsInput = screen.getByLabelText(/Tags/i)
      await user.clear(tagsInput)
      await user.type(tagsInput, 'streaming, movies, tv')

      expect(tagsInput).toHaveValue('streaming, movies, tv')
    })

    test('allows editing notes', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const notesInput = screen.getByLabelText(/Notes/i)
      await user.clear(notesInput)
      await user.type(notesInput, 'Updated notes')

      expect(notesInput).toHaveValue('Updated notes')
    })

    test('allows editing renewal URL', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const urlInput = screen.getByLabelText(/Renewal\/Management URL/i)
      await user.clear(urlInput)
      await user.type(urlInput, 'https://example.com/billing')

      expect(urlInput).toHaveValue('https://example.com/billing')
    })
  })

  describe('Form Validation', () => {
    test('shows error when name is empty', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      await user.clear(nameInput)

      const saveButton = screen.getByRole('button', { name: /Save Changes/i })
      await user.click(saveButton)

      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(defaultProps.onSave).not.toHaveBeenCalled()
    })

    test('shows error when price is invalid', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const priceInput = screen.getByLabelText(/Price/i)
      await user.clear(priceInput)
      await user.type(priceInput, '-5')

      const saveButton = screen.getByRole('button', { name: /Save Changes/i })
      await user.click(saveButton)

      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(defaultProps.onSave).not.toHaveBeenCalled()
    })

    test('shows error when renewal days is invalid', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const renewalInput = screen.getByLabelText(/Days Until Renewal/i)
      await user.clear(renewalInput)
      await user.type(renewalInput, '-10')

      const saveButton = screen.getByRole('button', { name: /Save Changes/i })
      await user.click(saveButton)

      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(defaultProps.onSave).not.toHaveBeenCalled()
    })

    test('marks required fields with aria-required', () => {
      render(<EditSubscriptionModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      expect(nameInput).toHaveAttribute('aria-required', 'true')
      expect(priceInput).toHaveAttribute('aria-required', 'true')
    })

    test('sets aria-invalid on fields with errors', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      await user.clear(nameInput)

      const saveButton = screen.getByRole('button', { name: /Save Changes/i })
      await user.click(saveButton)

      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('Form Submission', () => {
    test('calls onSave with updated data when form is valid', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      await user.clear(nameInput)
      await user.type(nameInput, 'Netflix Premium')

      const priceInput = screen.getByLabelText(/Price/i)
      await user.clear(priceInput)
      await user.type(priceInput, '19.99')

      const saveButton = screen.getByRole('button', { name: /Save Changes/i })
      await user.click(saveButton)

      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Netflix Premium',
          price: 19.99,
          billingCycle: 'monthly',
          category: 'Streaming',
        })
      )
    })

    test('converts tags string to array on submission', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const tagsInput = screen.getByLabelText(/Tags/i)
      await user.clear(tagsInput)
      await user.type(tagsInput, 'tag1, tag2, tag3')

      const saveButton = screen.getByRole('button', { name: /Save Changes/i })
      await user.click(saveButton)

      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['tag1', 'tag2', 'tag3'],
        })
      )
    })

    test('handles empty tags correctly', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const tagsInput = screen.getByLabelText(/Tags/i)
      await user.clear(tagsInput)

      const saveButton = screen.getByRole('button', { name: /Save Changes/i })
      await user.click(saveButton)

      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: [],
        })
      )
    })

    test('trims whitespace from tags', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const tagsInput = screen.getByLabelText(/Tags/i)
      await user.clear(tagsInput)
      await user.type(tagsInput, '  tag1  ,  tag2  ,  tag3  ')

      const saveButton = screen.getByRole('button', { name: /Save Changes/i })
      await user.click(saveButton)

      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['tag1', 'tag2', 'tag3'],
        })
      )
    })
  })

  describe('Modal Interactions', () => {
    test('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const closeButton = screen.getByLabelText(/Close edit subscription dialog/i)
      await user.click(closeButton)

      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    test('calls onClose when cancel button is clicked', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    test('has proper dialog role and labels', () => {
      render(<EditSubscriptionModal {...defaultProps} />)

      const dialog = screen.getByRole('dialog', { name: /Edit Subscription/i })
      expect(dialog).toBeInTheDocument()
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    test('form fields have proper labels', () => {
      render(<EditSubscriptionModal {...defaultProps} />)

      expect(screen.getByLabelText(/Subscription Name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Price/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Billing Cycle/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Category/i)).toBeInTheDocument()
    })

    test('error messages are associated with inputs via aria-describedby', async () => {
      const user = userEvent.setup()
      render(<EditSubscriptionModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      await user.clear(nameInput)

      const saveButton = screen.getByRole('button', { name: /Save Changes/i })
      await user.click(saveButton)

      const errorId = nameInput.getAttribute('aria-describedby')
      expect(errorId).toBeTruthy()
      expect(document.getElementById(errorId!)).toBeInTheDocument()
    })

    test('warning note has proper role', () => {
      const autoSub = mockSubscription({ ...defaultSubscription, source: 'auto_detected' })
      render(<EditSubscriptionModal {...defaultProps} subscription={autoSub} />)

      const warning = screen.getByRole('note')
      expect(warning).toBeInTheDocument()
    })
  })

  describe('Dark Mode', () => {
    test('applies dark mode styles when darkMode prop is true', () => {
      const { container } = render(<EditSubscriptionModal {...defaultProps} darkMode={true} />)

      const dialog = container.querySelector('.bg-\\[\\#2D3748\\]')
      expect(dialog).toBeInTheDocument()
    })

    test('applies light mode styles when darkMode prop is false', () => {
      const { container } = render(<EditSubscriptionModal {...defaultProps} darkMode={false} />)

      const dialog = container.querySelector('.bg-white')
      expect(dialog).toBeInTheDocument()
    })
  })
})


