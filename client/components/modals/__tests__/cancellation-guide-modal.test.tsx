import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CancellationGuideModal from '../cancellation-guide-modal'
import { mockCancellationGuide } from '@/lib/test-utils'

// Mock supabase cancellation-guides lib
vi.mock('@/lib/supabase/cancellation-guides', () => ({
  fetchCancellationGuide: vi.fn(),
  reportDifficulty: vi.fn(),
  markAsCancelled: vi.fn(),
}))

// Mock audit-log
vi.mock('@/lib/audit-log', () => ({
  logCancellationGuideAction: vi.fn(),
}))

// Mock supabase browser client
vi.mock('@/lib/supabase/browser-client', () => ({
  getSupabaseBrowserClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }),
    },
  })),
}))

import { fetchCancellationGuide, markAsCancelled } from '@/lib/supabase/cancellation-guides'
import { logCancellationGuideAction } from '@/lib/audit-log'

const mockSubscription = { id: '1', name: 'Netflix', icon: '📺', renewal_url: 'https://netflix.com' }

const defaultProps = {
  subscription: mockSubscription,
  onClose: vi.fn(),
  onCancelled: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CancellationGuideModal', () => {
  describe('guide loaded state', () => {
    it('logs guide_opened when guide loads successfully', async () => {
      const guide = mockCancellationGuide({ service_name: 'Netflix', steps: ['Step 1', 'Step 2'] })
      vi.mocked(fetchCancellationGuide).mockResolvedValue(guide)

      render(<CancellationGuideModal {...defaultProps} />)

      await waitFor(() => {
        expect(logCancellationGuideAction).toHaveBeenCalledWith(
          'user-123',
          'guide_opened',
          'Netflix',
        )
      })
    })

    it('logs direct_url_clicked when the cancellation page link is clicked', async () => {
      const guide = mockCancellationGuide({
        service_name: 'Netflix',
        steps: ['Step 1'],
        direct_url: 'https://netflix.com/cancel',
      })
      vi.mocked(fetchCancellationGuide).mockResolvedValue(guide)

      render(<CancellationGuideModal {...defaultProps} />)

      const link = await screen.findByRole('link', { name: /go to cancellation page/i })
      await userEvent.click(link)

      await waitFor(() => {
        expect(logCancellationGuideAction).toHaveBeenCalledWith(
          'user-123',
          'direct_url_clicked',
          'Netflix',
          { url: 'https://netflix.com/cancel' },
        )
      })
    })

    it('renders difficulty badge and estimated time', async () => {
      const guide = mockCancellationGuide({ service_name: 'Netflix', difficulty: 'hard', estimated_time: '10 minutes', steps: ['Step 1'] })
      vi.mocked(fetchCancellationGuide).mockResolvedValue(guide)

      render(<CancellationGuideModal {...defaultProps} />)

      expect(await screen.findByText(/hard difficulty/i)).toBeInTheDocument()
      expect(screen.getByText('10 minutes')).toBeInTheDocument()
    })

    it('renders warning note when present', async () => {
      const guide = mockCancellationGuide({ service_name: 'Netflix', steps: ['Step 1'], warning_note: 'Watch out for fees' })
      vi.mocked(fetchCancellationGuide).mockResolvedValue(guide)

      render(<CancellationGuideModal {...defaultProps} />)

      expect(await screen.findByText('Watch out for fees')).toBeInTheDocument()
    })
  })

  describe('fallback state (no guide)', () => {
    it('shows fallback UI when no guide is available', async () => {
      vi.mocked(fetchCancellationGuide).mockResolvedValue(null)

      render(<CancellationGuideModal {...defaultProps} />)

      expect(await screen.findByText(/no guide available/i)).toBeInTheDocument()
    })

    it('does not log guide_opened when guide is null', async () => {
      vi.mocked(fetchCancellationGuide).mockResolvedValue(null)

      render(<CancellationGuideModal {...defaultProps} />)

      await screen.findByText(/no guide available/i)
      expect(logCancellationGuideAction).not.toHaveBeenCalled()
    })

    it('shows account settings link in fallback state', async () => {
      vi.mocked(fetchCancellationGuide).mockResolvedValue(null)

      render(<CancellationGuideModal {...defaultProps} />)

      expect(await screen.findByRole('link', { name: /go to account settings/i })).toBeInTheDocument()
    })
  })

  describe('mark as cancelled', () => {
    it('calls markAsCancelled and onCancelled when all steps are completed', async () => {
      const guide = mockCancellationGuide({ service_name: 'Netflix', steps: ['Step 1'] })
      vi.mocked(fetchCancellationGuide).mockResolvedValue(guide)
      vi.mocked(markAsCancelled).mockResolvedValue(undefined)

      render(<CancellationGuideModal {...defaultProps} />)

      // Complete the single step
      const step = await screen.findByText('Step 1')
      await userEvent.click(step)

      const markBtn = screen.getByRole('button', { name: /mark as cancelled/i })
      await userEvent.click(markBtn)

      await waitFor(() => {
        expect(markAsCancelled).toHaveBeenCalledWith('1')
        expect(defaultProps.onCancelled).toHaveBeenCalled()
      })
    })
  })
})
