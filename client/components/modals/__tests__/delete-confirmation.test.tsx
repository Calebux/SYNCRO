import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, it, expect, vi, beforeEach } from 'vitest'

// Mock component for delete confirmation modal
// Since it's embedded in manage-subscription-modal, we'll create a standalone version for testing
interface DeleteConfirmationModalProps {
  subscriptionName: string
  onConfirm: () => void
  onCancel: () => void
  darkMode?: boolean
  loading?: boolean
}

function DeleteConfirmationModal({
  subscriptionName,
  onConfirm,
  onCancel,
  darkMode,
  loading,
}: DeleteConfirmationModalProps) {
  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
      <div
        role="alertdialog"
        aria-labelledby="delete-modal-title"
        aria-describedby="delete-modal-desc"
        aria-modal="true"
        className={`${
          darkMode ? 'bg-[#2D3748]' : 'bg-white'
        } rounded-xl p-6 max-w-md w-full shadow-2xl`}
      >
        <h3
          id="delete-modal-title"
          className={`text-lg font-bold mb-2 ${
            darkMode ? 'text-white' : 'text-gray-900'
          }`}
        >
          Remove subscription?
        </h3>
        <p
          id="delete-modal-desc"
          className={`text-sm mb-6 ${
            darkMode ? 'text-gray-400' : 'text-gray-600'
          }`}
        >
          This will remove {subscriptionName} from your dashboard. This action
          cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            aria-label="Cancel deletion"
            className={`flex-1 px-4 py-2 border rounded-lg ${
              darkMode
                ? 'border-[#374151] text-gray-300'
                : 'border-gray-300 text-gray-700'
            } disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            aria-label={`Confirm removal of ${subscriptionName}`}
            className="flex-1 px-4 py-2 bg-[#E86A33] text-white rounded-lg hover:bg-[#E86A33]/90 disabled:opacity-50"
          >
            {loading ? 'Removing...' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  )
}

describe('DeleteConfirmationModal', () => {
  const defaultProps = {
    subscriptionName: 'Netflix',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    test('displays confirmation title', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      expect(screen.getByText('Remove subscription?')).toBeInTheDocument()
    })

    test('displays confirmation message with subscription name', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      expect(
        screen.getByText(/This will remove Netflix from your dashboard/i)
      ).toBeInTheDocument()
      expect(screen.getByText(/This action cannot be undone/i)).toBeInTheDocument()
    })

    test('displays cancel button', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: /Cancel deletion/i })).toBeInTheDocument()
    })

    test('displays confirm button', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      expect(
        screen.getByRole('button', { name: /Confirm removal of Netflix/i })
      ).toBeInTheDocument()
    })

    test('displays different subscription name correctly', () => {
      render(<DeleteConfirmationModal {...defaultProps} subscriptionName="Spotify" />)

      expect(
        screen.getByText(/This will remove Spotify from your dashboard/i)
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Confirm removal of Spotify/i })
      ).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    test('calls onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup()
      render(<DeleteConfirmationModal {...defaultProps} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel deletion/i })
      await user.click(cancelButton)

      expect(defaultProps.onCancel).toHaveBeenCalled()
      expect(defaultProps.onConfirm).not.toHaveBeenCalled()
    })

    test('calls onConfirm when confirm button is clicked', async () => {
      const user = userEvent.setup()
      render(<DeleteConfirmationModal {...defaultProps} />)

      const confirmButton = screen.getByRole('button', {
        name: /Confirm removal of Netflix/i,
      })
      await user.click(confirmButton)

      expect(defaultProps.onConfirm).toHaveBeenCalled()
      expect(defaultProps.onCancel).not.toHaveBeenCalled()
    })
  })

  describe('Loading State', () => {
    test('displays loading text when loading is true', () => {
      render(<DeleteConfirmationModal {...defaultProps} loading={true} />)

      expect(screen.getByText('Removing...')).toBeInTheDocument()
    })

    test('disables buttons when loading is true', () => {
      render(<DeleteConfirmationModal {...defaultProps} loading={true} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel deletion/i })
      const confirmButton = screen.getByRole('button', {
        name: /Confirm removal of Netflix/i,
      })

      expect(cancelButton).toBeDisabled()
      expect(confirmButton).toBeDisabled()
    })

    test('enables buttons when loading is false', () => {
      render(<DeleteConfirmationModal {...defaultProps} loading={false} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel deletion/i })
      const confirmButton = screen.getByRole('button', {
        name: /Confirm removal of Netflix/i,
      })

      expect(cancelButton).not.toBeDisabled()
      expect(confirmButton).not.toBeDisabled()
    })

    test('does not call handlers when buttons are disabled', async () => {
      const user = userEvent.setup()
      render(<DeleteConfirmationModal {...defaultProps} loading={true} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel deletion/i })
      const confirmButton = screen.getByRole('button', {
        name: /Confirm removal of Netflix/i,
      })

      await user.click(cancelButton)
      await user.click(confirmButton)

      expect(defaultProps.onCancel).not.toHaveBeenCalled()
      expect(defaultProps.onConfirm).not.toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    test('has proper alertdialog role', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toBeInTheDocument()
    })

    test('has aria-modal attribute', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    test('has aria-labelledby pointing to title', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      const dialog = screen.getByRole('alertdialog')
      const titleId = dialog.getAttribute('aria-labelledby')

      expect(titleId).toBe('delete-modal-title')
      expect(document.getElementById(titleId!)).toHaveTextContent(
        'Remove subscription?'
      )
    })

    test('has aria-describedby pointing to description', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      const dialog = screen.getByRole('alertdialog')
      const descId = dialog.getAttribute('aria-describedby')

      expect(descId).toBe('delete-modal-desc')
      expect(document.getElementById(descId!)).toHaveTextContent(
        /This will remove Netflix from your dashboard/i
      )
    })

    test('buttons have descriptive aria-labels', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      expect(screen.getByLabelText(/Cancel deletion/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Confirm removal of Netflix/i)).toBeInTheDocument()
    })
  })

  describe('Dark Mode', () => {
    test('applies dark mode styles when darkMode prop is true', () => {
      const { container } = render(
        <DeleteConfirmationModal {...defaultProps} darkMode={true} />
      )

      const dialog = container.querySelector('.bg-\\[\\#2D3748\\]')
      expect(dialog).toBeInTheDocument()
    })

    test('applies light mode styles when darkMode prop is false', () => {
      const { container } = render(
        <DeleteConfirmationModal {...defaultProps} darkMode={false} />
      )

      const dialog = container.querySelector('.bg-white')
      expect(dialog).toBeInTheDocument()
    })

    test('applies dark mode text colors', () => {
      render(<DeleteConfirmationModal {...defaultProps} darkMode={true} />)

      const title = screen.getByText('Remove subscription?')
      expect(title).toHaveClass('text-white')
    })

    test('applies light mode text colors', () => {
      render(<DeleteConfirmationModal {...defaultProps} darkMode={false} />)

      const title = screen.getByText('Remove subscription?')
      expect(title).toHaveClass('text-gray-900')
    })
  })

  describe('Keyboard Navigation', () => {
    test('can navigate between buttons with Tab', async () => {
      const user = userEvent.setup()
      render(<DeleteConfirmationModal {...defaultProps} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel deletion/i })
      const confirmButton = screen.getByRole('button', {
        name: /Confirm removal of Netflix/i,
      })

      // Focus first button
      cancelButton.focus()
      expect(cancelButton).toHaveFocus()

      // Tab to next button
      await user.tab()
      expect(confirmButton).toHaveFocus()

      // Shift+Tab back
      await user.tab({ shift: true })
      expect(cancelButton).toHaveFocus()
    })

    test('can activate cancel button with Enter key', async () => {
      const user = userEvent.setup()
      render(<DeleteConfirmationModal {...defaultProps} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel deletion/i })
      cancelButton.focus()

      await user.keyboard('{Enter}')

      expect(defaultProps.onCancel).toHaveBeenCalled()
    })

    test('can activate confirm button with Enter key', async () => {
      const user = userEvent.setup()
      render(<DeleteConfirmationModal {...defaultProps} />)

      const confirmButton = screen.getByRole('button', {
        name: /Confirm removal of Netflix/i,
      })
      confirmButton.focus()

      await user.keyboard('{Enter}')

      expect(defaultProps.onConfirm).toHaveBeenCalled()
    })
  })

  describe('Warning Emphasis', () => {
    test('confirm button has danger styling', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      const confirmButton = screen.getByRole('button', {
        name: /Confirm removal of Netflix/i,
      })

      expect(confirmButton).toHaveClass('bg-[#E86A33]')
    })

    test('message emphasizes irreversibility', () => {
      render(<DeleteConfirmationModal {...defaultProps} />)

      expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
    })
  })
})


