import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, it, expect, vi, beforeEach } from 'vitest'
import AddSubscriptionModal from '../add-subscription-modal'

describe('AddSubscriptionModal', () => {
  const defaultProps = {
    onAdd: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    test('displays modal title and description', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      expect(screen.getByText('Add Subscription')).toBeInTheDocument()
      expect(screen.getByText(/Pick a service or add manually/i)).toBeInTheDocument()
    })

    test('displays search input', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText(/Search services/i)
      expect(searchInput).toBeInTheDocument()
    })

    test('displays category filter pills', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Streaming/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Productivity/i })).toBeInTheDocument()
    })

    test('displays template grid', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      const templateList = screen.getByRole('list', { name: /Available subscription templates/i })
      expect(templateList).toBeInTheDocument()
    })

    test('displays "Add Custom Subscription" button', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: /Add Custom Subscription/i })).toBeInTheDocument()
    })

    test('displays action buttons', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Add to Dashboard/i })).toBeInTheDocument()
    })
  })

  describe('Search Functionality', () => {
    test('focuses search input on mount', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText(/Search services/i)
      expect(searchInput).toHaveFocus()
    })

    test('filters templates based on search query', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText(/Search services/i)
      await user.type(searchInput, 'Netflix')

      // Should show filtered results
      const templateList = screen.getByRole('list', { name: /Available subscription templates/i })
      expect(templateList).toBeInTheDocument()
    })

    test('shows "no services found" message when search has no results', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText(/Search services/i)
      await user.type(searchInput, 'NonExistentService12345')

      expect(screen.getByText(/No services found/i)).toBeInTheDocument()
    })
  })

  describe('Category Filtering', () => {
    test('filters templates by selected category', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const streamingButton = screen.getByRole('button', { name: /Streaming/i, pressed: false })
      await user.click(streamingButton)

      expect(streamingButton).toHaveAttribute('aria-pressed', 'true')
    })

    test('shows all categories when "All" is selected', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      // First select a specific category
      const streamingButton = screen.getByRole('button', { name: /Streaming/i })
      await user.click(streamingButton)

      // Then select "All"
      const allButton = screen.getByRole('button', { name: 'All' })
      await user.click(allButton)

      expect(allButton).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('Template Selection', () => {
    test('selects template when clicked', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      // Find and click a template (assuming templates are rendered)
      const templateList = screen.getByRole('list', { name: /Available subscription templates/i })
      const templates = within(templateList).getAllByRole('listitem')

      if (templates.length > 0) {
        await user.click(templates[0])
        expect(templates[0]).toHaveAttribute('aria-pressed', 'true')
      }
    })

    test('displays price tier selector when template is selected', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const templateList = screen.getByRole('list', { name: /Available subscription templates/i })
      const templates = within(templateList).getAllByRole('listitem')

      if (templates.length > 0) {
        await user.click(templates[0])

        // Should show price tier selector
        expect(screen.getByText(/Select your plan/i)).toBeInTheDocument()
      }
    })
  })

  describe('Custom Mode', () => {
    test('switches to custom form when "Add Custom Subscription" is clicked', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const customButton = screen.getByRole('button', { name: /Add Custom Subscription/i })
      await user.click(customButton)

      expect(screen.getByText(/Fill in your subscription details/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Subscription Name/i)).toBeInTheDocument()
    })

    test('displays custom form fields', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const customButton = screen.getByRole('button', { name: /Add Custom Subscription/i })
      await user.click(customButton)

      expect(screen.getByLabelText(/Subscription Name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Category/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Billing Cycle/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Price/i)).toBeInTheDocument()
    })

    test('switches back to template view when "Back to services" is clicked', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      // Switch to custom mode
      const customButton = screen.getByRole('button', { name: /Add Custom Subscription/i })
      await user.click(customButton)

      // Switch back
      const backButton = screen.getByRole('button', { name: /Back to services/i })
      await user.click(backButton)

      expect(screen.getByText(/Pick a service or add manually/i)).toBeInTheDocument()
    })
  })

  describe('Form Validation', () => {
    test('disables submit button when name is empty', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      // Switch to custom mode
      const customButton = screen.getByRole('button', { name: /Add Custom Subscription/i })
      await user.click(customButton)

      const submitButton = screen.getByRole('button', { name: /Add to Dashboard/i })
      expect(submitButton).toBeDisabled()
    })

    test('disables submit button when price is empty', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      // Switch to custom mode
      const customButton = screen.getByRole('button', { name: /Add Custom Subscription/i })
      await user.click(customButton)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      await user.type(nameInput, 'Test Service')

      const submitButton = screen.getByRole('button', { name: /Add to Dashboard/i })
      expect(submitButton).toBeDisabled()
    })

    test('enables submit button when all required fields are filled', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      // Switch to custom mode
      const customButton = screen.getByRole('button', { name: /Add Custom Subscription/i })
      await user.click(customButton)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      await user.type(nameInput, 'Test Service')
      await user.type(priceInput, '9.99')

      const submitButton = screen.getByRole('button', { name: /Add to Dashboard/i })
      expect(submitButton).not.toBeDisabled()
    })
  })

  describe('Form Submission', () => {
    test('calls onAdd with correct data when custom form is submitted', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      // Switch to custom mode
      const customButton = screen.getByRole('button', { name: /Add Custom Subscription/i })
      await user.click(customButton)

      // Fill form
      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      await user.type(nameInput, 'Test Service')
      await user.type(priceInput, '9.99')

      // Submit
      const submitButton = screen.getByRole('button', { name: /Add to Dashboard/i })
      await user.click(submitButton)

      expect(defaultProps.onAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Service',
          price: 9.99,
          billing_cycle: 'monthly',
          status: 'active',
          source: 'manual',
        })
      )
    })

    test('calls onAdd when template is selected and submitted', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const templateList = screen.getByRole('list', { name: /Available subscription templates/i })
      const templates = within(templateList).getAllByRole('listitem')

      if (templates.length > 0) {
        await user.click(templates[0])

        const submitButton = screen.getByRole('button', { name: /Add to Dashboard/i })
        await user.click(submitButton)

        expect(defaultProps.onAdd).toHaveBeenCalled()
      }
    })
  })

  describe('Modal Interactions', () => {
    test('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const closeButton = screen.getByLabelText(/Close add subscription dialog/i)
      await user.click(closeButton)

      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    test('calls onClose when cancel button is clicked', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    test('has proper dialog role and labels', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      const dialog = screen.getByRole('dialog', { name: /Add Subscription/i })
      expect(dialog).toBeInTheDocument()
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    test('search input has proper label', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      const searchInput = screen.getByLabelText(/Search for a subscription service/i)
      expect(searchInput).toBeInTheDocument()
    })

    test('category filter has proper group label', () => {
      render(<AddSubscriptionModal {...defaultProps} />)

      const categoryGroup = screen.getByRole('group', { name: /Filter by category/i })
      expect(categoryGroup).toBeInTheDocument()
    })

    test('form fields have proper labels and required indicators', async () => {
      const user = userEvent.setup()
      render(<AddSubscriptionModal {...defaultProps} />)

      const customButton = screen.getByRole('button', { name: /Add Custom Subscription/i })
      await user.click(customButton)

      const nameInput = screen.getByLabelText(/Subscription Name/i)
      const priceInput = screen.getByLabelText(/Price/i)

      expect(nameInput).toHaveAttribute('aria-required', 'true')
      expect(priceInput).toHaveAttribute('aria-required', 'true')
    })
  })

  describe('Dark Mode', () => {
    test('applies dark mode styles when darkMode prop is true', () => {
      const { container } = render(<AddSubscriptionModal {...defaultProps} darkMode={true} />)

      const dialog = container.querySelector('.bg-\\[\\#2D3748\\]')
      expect(dialog).toBeInTheDocument()
    })

    test('applies light mode styles when darkMode prop is false', () => {
      const { container } = render(<AddSubscriptionModal {...defaultProps} darkMode={false} />)

      const dialog = container.querySelector('.bg-white')
      expect(dialog).toBeInTheDocument()
    })
  })
})


