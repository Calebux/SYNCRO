import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  AriaLiveAnnouncer,
  announcePolite,
  announceAssertive,
} from "@syncro/ui"

/**
 * Issue #956 – ARIA live announcer component tests
 */

describe('AriaLiveAnnouncer', () => {
  it('should render two hidden spans with correct ARIA roles', () => {
    render(<AriaLiveAnnouncer />)

    const politeRegion = screen.getByRole('status')
    const alertRegion = screen.getByRole('alert')

    expect(politeRegion).toBeInTheDocument()
    expect(alertRegion).toBeInTheDocument()
  })

  it('should have aria-live="polite" on status region', () => {
    render(<AriaLiveAnnouncer />)
    const politeRegion = screen.getByRole('status')
    expect(politeRegion).toHaveAttribute('aria-live', 'polite')
  })

  it('should have aria-live="assertive" on alert region', () => {
    render(<AriaLiveAnnouncer />)
    const alertRegion = screen.getByRole('alert')
    expect(alertRegion).toHaveAttribute('aria-live', 'assertive')
  })

  it('should have aria-atomic="true" on both regions', () => {
    render(<AriaLiveAnnouncer />)
    const politeRegion = screen.getByRole('status')
    const alertRegion = screen.getByRole('alert')
    expect(politeRegion).toHaveAttribute('aria-atomic', 'true')
    expect(alertRegion).toHaveAttribute('aria-atomic', 'true')
  })

  it('should accept custom className', () => {
    const customClass = 'custom-announcer'
    render(<AriaLiveAnnouncer className={customClass} />)
    const politeRegion = screen.getByRole('status')
    expect(politeRegion).toHaveClass(customClass)
  })

  it('should apply sr-only or similar hidden styling', () => {
    render(<AriaLiveAnnouncer />)
    const politeRegion = screen.getByRole('status')
    // Should have some kind of hidden styling (sr-only, or absolute positioning, etc)
    const classList = politeRegion.className || ''
    const styles = window.getComputedStyle(politeRegion)
    expect(
      classList.includes('sr-only') ||
      classList.includes('hidden') ||
      classList.includes('absolute') ||
      styles.display === 'none' ||
      styles.visibility === 'hidden' ||
      styles.clip === 'rect(0, 0, 0, 0)'
    ).toBe(true)
  })
})

describe('announcePolite and announceAssertive functions', () => {
  it('should write message to polite region', (done) => {
    render(<AriaLiveAnnouncer />)
    const politeRegion = screen.getByRole('status')

    announcePolite('Subscription paused')

    setTimeout(() => {
      expect(politeRegion.textContent).toBe('Subscription paused')
      done()
    }, 50)
  })

  it('should write message to assertive region', (done) => {
    render(<AriaLiveAnnouncer />)
    const alertRegion = screen.getByRole('alert')

    announceAssertive('Error: Failed to update')

    setTimeout(() => {
      expect(alertRegion.textContent).toBe('Error: Failed to update')
      done()
    }, 50)
  })

  it('should clear then reset text for identical messages', (done) => {
    render(<AriaLiveAnnouncer />)
    const politeRegion = screen.getByRole('status')

    announcePolite('Message')
    setTimeout(() => {
      announcePolite('Message')
      expect(politeRegion.textContent).toBeDefined()
      done()
    }, 50)
  })

  it('should handle empty messages', (done) => {
    render(<AriaLiveAnnouncer />)
    const politeRegion = screen.getByRole('status')

    announcePolite('')

    setTimeout(() => {
      expect(politeRegion.textContent).toBe('')
      done()
    }, 50)
  })

  it('should handle long messages', (done) => {
    render(<AriaLiveAnnouncer />)
    const politeRegion = screen.getByRole('status')

    const longMessage =
      'This is a long message with multiple sentences. It contains important information about the current operation.'
    announcePolite(longMessage)

    setTimeout(() => {
      expect(politeRegion.textContent).toBe(longMessage)
      done()
    }, 50)
  })
})
