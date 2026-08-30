import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, it, expect, vi, beforeEach } from 'vitest'

// Mock subscription form component
// This represents the common form logic used in both add and edit modals
interface SubscriptionFormProps {
  initialData?: {
    name?: string
    price?: string
    billingCycle?: string
    category?: string
    tags?: string
    renewalUrl?: string
    notes?: string
  }
  onSubmit: (data: any) => void
  onCancel: () => void
  submitLabel?: string
  darkMode?: boolean
  loading?: boolean
}

function SubscriptionForm({
  initialData = {},
  onSubmit,
  onCancel,
  submitLabel = 'Submit',
  darkMode,
  loading,
}: SubscriptionFormProps) {
  const [formData, setFormData] = React.useState({
    name: initialData.name || '',
    price: initialData.price || '',
    billingCycle: initialData.billingCycle || 'monthly',
    category: initialData.category || 'AI Tools',
    tags: initialData.tags || '',
    renewalUrl: initialData.renewalUrl || '',
    notes: initialData.notes || '',
  })

  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Subscription name is required'
    }

    if (!formData.price || parseFloat(formData.price) <= 0) {
      newErrors.price = 'Price must be greater than 0'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSubmit({
      ...formData,
      price: parseFloat(formData.price),
      tags: formData.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    })
  }

  const inputClass = darkMode
    ? 'bg-[#1E2A35] border-[#374151] text-white'
    : 'bg-white border-gray-300 text-gray-900'

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label htmlFor="sub-name" className="block text-sm font-medium mb-2">
            Subscription Name *
          </label>
          <input
            id="sub-name"
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            aria-required="true"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'name-error' : undefined}
            className={`w-full px-4 py-2 border rounded-lg ${inputClass} ${
              errors.name ? 'border-red-500' : ''
            }`}
          />
          {errors.name && (
            <p id="name-error" role="alert" className="text-red-500 text-xs mt-1">
              {errors.name}
            </p>
          )}
        </div>

        {/* Price */}
        <div>
          <label htmlFor="sub-price" className="block text-sm font-medium mb-2">
            Price ($) *
          </label>
          <input
            id="sub-price"
            type="number"
            step="0.01"
            min="0"
            value={formData.price}
            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
            aria-required="true"
            aria-invalid={!!errors.price}
            aria-describedby={errors.price ? 'price-error' : undefined}
            className={`w-full px-4 py-2 border rounded-lg ${inputClass} ${
              errors.price ? 'border-red-500' : ''
            }`}
          />
          {errors.price && (
            <p id="price-error" role="alert" className="text-red-500 text-xs mt-1">
              {errors.price}
            </p>
          )}
        </div>

        {/* Billing Cycle */}
        <div>
          <label htmlFor="sub-billing-cycle" className="block text-sm font-medium mb-2">
            Billing Cycle
          </label>
          <select
            id="sub-billing-cycle"
            value={formData.billingCycle}
            onChange={(e) =>
              setFormData({ ...formData, billingCycle: e.target.value })
            }
            className={`w-full px-4 py-2 border rounded-lg ${inputClass}`}
          >
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="quarterly">Quarterly</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </div>

        {/* Category */}
        <div>
          <label htmlFor="sub-category" className="block text-sm font-medium mb-2">
            Category
          </label>
          <select
            id="sub-category"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            className={`w-full px-4 py-2 border rounded-lg ${inputClass}`}
          >
            <option value="AI Tools">AI Tools</option>
            <option value="Streaming">Streaming</option>
            <option value="Productivity">Productivity</option>
            <option value="Design">Design</option>
            <option value="Development">Development</option>
            <option value="Finance">Finance</option>
            <option value="Health">Health</option>
            <option value="Gaming">Gaming</option>
          </select>
        </div>

        {/* Tags */}
        <div>
          <label htmlFor="sub-tags" className="block text-sm font-medium mb-2">
            Tags (comma separated)
          </label>
          <input
            id="sub-tags"
            type="text"
            value={formData.tags}
            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            placeholder="ai, productivity, work"
            className={`w-full px-4 py-2 border rounded-lg ${inputClass}`}
          />
        </div>

        {/* Renewal URL */}
        <div>
          <label htmlFor="sub-renewal-url" className="block text-sm font-medium mb-2">
            Renewal URL (optional)
          </label>
          <input
            id="sub-renewal-url"
            type="url"
            value={formData.renewalUrl}
            onChange={(e) =>
              setFormData({ ...formData, renewalUrl: e.target.value })
            }
            placeholder="https://..."
            className={`w-full px-4 py-2 border rounded-lg ${inputClass}`}
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="sub-notes" className="block text-sm font-medium mb-2">
            Notes (optional)
          </label>
          <textarea
            id="sub-notes"
            rows={3}
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Additional notes..."
            className={`w-full px-4 py-2 border rounded-lg ${inputClass}`}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-6">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="flex-1 px-4 py-3 border rounded-lg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg disabled:opacity-50"
        >
          {loading ? 'Submitting...' : submitLabel}
        </button>
      </div>
    </form>
  )
}

// Import React for useState
import React from 'react'

describe('SubscriptionForm', () => {
  const defaultProps = {
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    test('displays all form fields', () => {
      render(<SubscriptionForm {...defaultProps} />)

      expect(screen.getByLabelText(/Subscription Name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Price/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Billing Cycle/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Category/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Tags/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Renewal URL/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Notes/i)).toBeInTheDocument()
    })

    test('displays submit and cancel buttons', () => {
      render(<SubscriptionForm {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    })

    test('uses custom submit label when provided', () => {
      render(<SubscriptionForm {...defaultProps} submitLabel="Save Changes" />)

      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument()
    })

    test('pre-populates fields with initial data', () => {
      const initialData = {
        name: 'Netflix',
        price: '15.99',
        billingCycle: 'monthly',
        category: 'Streaming',
        tags: 'entertainment, video',
        renewalUrl: 'https://netflix.com',
        notes: 'Family plan',
      }

      render(<SubscriptionForm {...defaultProps} initialData={initialData} />)

      expect(screen.getByDisplayValue('Netflix')).toBeInTheDocument()
      expect(screen.getByDisplayValue('15.99')).toBeInTheDocument()
      expect(screen.getByDisplayValue('monthly')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Streaming')).toBeInTheDocument()
      expect(screen.getByDisplayValue('entertainment, video')).toBeInTheDocument()
      expect(screen.getByDisplayValue('https://netflix.com')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Family plan')).toBeInTheDocument()
    })
  })

  describe('Field Validation', () => {
    test('shows error when name is empty', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
      expect(defaultProps.onSubmit).not.toHaveBeenCalled()
    })

    test('shows error when price is empty', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      await user.type(nameInput, 'Test Service')

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      expect(screen.getByRole('alert')).toHaveTextContent(/Price must be greater than 0/i)
      expect(defaultProps.onSubmit).not.toHaveBeenCalled()
    })

    test('shows error when price is zero', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      await user.type(nameInput, 'Test Service')
      await user.type(priceInput, '0')

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      expect(screen.getByRole('alert')).toHaveTextContent(/Price must be greater than 0/i)
      expect(defaultProps.onSubmit).not.toHaveBeenCalled()
    })

    test('shows error when price is negative', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      await user.type(nameInput, 'Test Service')
      await user.type(priceInput, '-5')

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      expect(screen.getByRole('alert')).toHaveTextContent(/Price must be greater than 0/i)
      expect(defaultProps.onSubmit).not.toHaveBeenCalled()
    })

    test('marks required fields with aria-required', () => {
      render(<SubscriptionForm {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      expect(nameInput).toHaveAttribute('aria-required', 'true')
      expect(priceInput).toHaveAttribute('aria-required', 'true')
    })

    test('sets aria-invalid on fields with errors', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
      expect(priceInput).toHaveAttribute('aria-invalid', 'true')
    })

    test('associates error messages with inputs via aria-describedby', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const errorId = nameInput.getAttribute('aria-describedby')

      expect(errorId).toBe('name-error')
      expect(document.getElementById(errorId!)).toBeInTheDocument()
    })
  })

  describe('Form Submission', () => {
    test('calls onSubmit with valid data', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      await user.type(nameInput, 'Test Service')
      await user.type(priceInput, '9.99')

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      expect(defaultProps.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Service',
          price: 9.99,
          billingCycle: 'monthly',
          category: 'AI Tools',
        })
      )
    })

    test('converts tags string to array', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)
      const tagsInput = screen.getByLabelText(/Tags/i)

      await user.type(nameInput, 'Test Service')
      await user.type(priceInput, '9.99')
      await user.type(tagsInput, 'tag1, tag2, tag3')

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      expect(defaultProps.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['tag1', 'tag2', 'tag3'],
        })
      )
    })

    test('trims whitespace from tags', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)
      const tagsInput = screen.getByLabelText(/Tags/i)

      await user.type(nameInput, 'Test Service')
      await user.type(priceInput, '9.99')
      await user.type(tagsInput, '  tag1  ,  tag2  ,  tag3  ')

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      expect(defaultProps.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['tag1', 'tag2', 'tag3'],
        })
      )
    })

    test('handles empty tags correctly', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      await user.type(nameInput, 'Test Service')
      await user.type(priceInput, '9.99')

      const submitButton = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitButton)

      expect(defaultProps.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: [],
        })
      )
    })
  })

  describe('Loading State', () => {
    test('displays loading text when loading is true', () => {
      render(<SubscriptionForm {...defaultProps} loading={true} />)

      expect(screen.getByText('Submitting...')).toBeInTheDocument()
    })

    test('disables buttons when loading is true', () => {
      render(<SubscriptionForm {...defaultProps} loading={true} />)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      const submitButton = screen.getByRole('button', { name: /Submitting/i })

      expect(cancelButton).toBeDisabled()
      expect(submitButton).toBeDisabled()
    })

    test('enables buttons when loading is false', () => {
      render(<SubscriptionForm {...defaultProps} loading={false} />)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      const submitButton = screen.getByRole('button', { name: 'Submit' })

      expect(cancelButton).not.toBeDisabled()
      expect(submitButton).not.toBeDisabled()
    })
  })

  describe('Cancel Action', () => {
    test('calls onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup()
      render(<SubscriptionForm {...defaultProps} />)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await user.click(cancelButton)

      expect(defaultProps.onCancel).toHaveBeenCalled()
      expect(defaultProps.onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('Dark Mode', () => {
    test('applies dark mode styles to inputs', () => {
      render(<SubscriptionForm {...defaultProps} darkMode={true} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      expect(nameInput).toHaveClass('bg-[#1E2A35]')
    })

    test('applies light mode styles to inputs', () => {
      render(<SubscriptionForm {...defaultProps} darkMode={false} />)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      expect(nameInput).toHaveClass('bg-white')
    })
  })
})


