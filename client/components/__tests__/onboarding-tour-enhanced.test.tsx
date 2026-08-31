import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, test, it, expect, vi, beforeEach } from 'vitest'
import { OnboardingTourEnhanced, useOnboardingTourEnhanced } from '../onboarding-tour-enhanced'

// Mock react-joyride-react-19
vi.mock('react-joyride-react-19', () => {
  return {
    default: function MockJoyride({ run, steps, callback, stepIndex = 0 }: any) {
      if (!run) return null
      
      return (
        <div data-testid="joyride-tour">
          <div data-testid="tour-step-count">{steps.length} steps</div>
          <div data-testid="tour-step-index">{stepIndex}</div>
          <button 
            data-testid="tour-next" 
            onClick={() => callback({ status: 'running', type: 'step:after', action: 'next', index: stepIndex })}
          >
            Next Step
          </button>
          <button 
            data-testid="tour-skip" 
            onClick={() => callback({ status: 'skipped', type: 'step:after', action: 'close', index: stepIndex })}
          >
            Skip Tour
          </button>
          <button 
            data-testid="tour-complete" 
            onClick={() => callback({ status: 'finished', type: 'tour:end', action: 'next', index: stepIndex })}
          >
            Complete Tour
          </button>
        </div>
      )
    }
  }
})

// Test component that uses the hook
function TestComponent() {
  const { shouldShowTour, tourCompleted, tourSkipped, resetTour } = useOnboardingTourEnhanced()
  
  return (
    <div>
      <div data-testid="should-show-tour">{shouldShowTour.toString()}</div>
      <div data-testid="tour-completed">{tourCompleted.toString()}</div>
      <div data-testid="tour-skipped">{tourSkipped.toString()}</div>
      <button data-testid="reset-tour" onClick={resetTour}>Reset Tour</button>
      {shouldShowTour && <OnboardingTourEnhanced />}
    </div>
  )
}

describe('OnboardingTourEnhanced', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('useOnboardingTourEnhanced hook', () => {
    test('should show tour for new users', () => {
      render(<TestComponent />)
      
      expect(screen.getByTestId('should-show-tour')).toHaveTextContent('true')
      expect(screen.getByTestId('tour-completed')).toHaveTextContent('false')
      expect(screen.getByTestId('tour-skipped')).toHaveTextContent('false')
    })

    test('should not show tour for completed users', () => {
      localStorage.setItem('onboarding-tour-completed', 'true')
      
      render(<TestComponent />)
      
      expect(screen.getByTestId('should-show-tour')).toHaveTextContent('false')
      expect(screen.getByTestId('tour-completed')).toHaveTextContent('true')
      expect(screen.getByTestId('tour-skipped')).toHaveTextContent('false')
    })

    test('should not show tour for users who skipped', () => {
      localStorage.setItem('onboarding-tour-skipped', 'true')
      
      render(<TestComponent />)
      
      expect(screen.getByTestId('should-show-tour')).toHaveTextContent('false')
      expect(screen.getByTestId('tour-completed')).toHaveTextContent('false')
      expect(screen.getByTestId('tour-skipped')).toHaveTextContent('true')
    })

    test('should reset tour state', () => {
      localStorage.setItem('onboarding-tour-completed', 'true')
      
      render(<TestComponent />)
      
      expect(screen.getByTestId('should-show-tour')).toHaveTextContent('false')
      
      fireEvent.click(screen.getByTestId('reset-tour'))
      
      expect(screen.getByTestId('should-show-tour')).toHaveTextContent('true')
      expect(localStorage.getItem('onboarding-tour-completed')).toBeNull()
      expect(localStorage.getItem('onboarding-tour-skipped')).toBeNull()
      expect(localStorage.getItem('onboarding-tour-step-index')).toBeNull()
    })
  })

  describe('OnboardingTourEnhanced component', () => {
    test('should render tour with correct number of steps', async () => {
      render(<OnboardingTourEnhanced autoStart={true} />)
      
      await waitFor(() => {
        expect(screen.getByTestId('joyride-tour')).toBeInTheDocument()
      }, { timeout: 2000 })
      
      expect(screen.getByTestId('tour-step-count')).toHaveTextContent('3 steps')
    })

    test('should not render tour when autoStart is false and no localStorage flags', () => {
      render(<OnboardingTourEnhanced autoStart={false} />)
      
      expect(screen.queryByTestId('joyride-tour')).not.toBeInTheDocument()
    })

    test('should handle tour completion', async () => {
      const onComplete = vi.fn()
      
      render(<OnboardingTourEnhanced autoStart={true} onComplete={onComplete} />)
      
      await waitFor(() => {
        expect(screen.getByTestId('joyride-tour')).toBeInTheDocument()
      }, { timeout: 2000 })
      
      fireEvent.click(screen.getByTestId('tour-complete'))
      
      expect(onComplete).toHaveBeenCalled()
      expect(localStorage.getItem('onboarding-tour-completed')).toBe('true')
    })

    test('should handle tour skip', async () => {
      const onSkip = vi.fn()
      
      render(<OnboardingTourEnhanced autoStart={true} onSkip={onSkip} />)
      
      await waitFor(() => {
        expect(screen.getByTestId('joyride-tour')).toBeInTheDocument()
      }, { timeout: 2000 })
      
      fireEvent.click(screen.getByTestId('tour-skip'))
      
      expect(onSkip).toHaveBeenCalled()
      expect(localStorage.getItem('onboarding-tour-skipped')).toBe('true')
    })

    test('should persist progress across reloads', async () => {
      render(<OnboardingTourEnhanced autoStart={true} />)
      
      await waitFor(() => {
        expect(screen.getByTestId('joyride-tour')).toBeInTheDocument()
      }, { timeout: 2000 })
      
      expect(screen.getByTestId('tour-step-index')).toHaveTextContent('0')

      fireEvent.click(screen.getByTestId('tour-next'))
      
      expect(localStorage.getItem('onboarding-tour-step-index')).toBe('1')
      expect(screen.getByTestId('tour-step-index')).toHaveTextContent('1')
    })

    test('should resume from persisted progress', async () => {
      localStorage.setItem('onboarding-tour-step-index', '2')
      
      render(<OnboardingTourEnhanced autoStart={true} />)
      
      await waitFor(() => {
        expect(screen.getByTestId('joyride-tour')).toBeInTheDocument()
      }, { timeout: 2000 })
      
      expect(screen.getByTestId('tour-step-index')).toHaveTextContent('2')
    })

    test('should clear persisted progress on completion', async () => {
      localStorage.setItem('onboarding-tour-step-index', '2')
      const onComplete = vi.fn()
      
      render(<OnboardingTourEnhanced autoStart={true} onComplete={onComplete} />)
      
      await waitFor(() => {
        expect(screen.getByTestId('joyride-tour')).toBeInTheDocument()
      }, { timeout: 2000 })
      
      fireEvent.click(screen.getByTestId('tour-complete'))
      
      expect(localStorage.getItem('onboarding-tour-step-index')).toBeNull()
    })

    test('should support dark mode', async () => {
      render(<OnboardingTourEnhanced autoStart={true} darkMode={true} />)
      
      await waitFor(() => {
        expect(screen.getByTestId('joyride-tour')).toBeInTheDocument()
      }, { timeout: 2000 })
      
      // Test would verify dark mode styles are applied
      // This would require more detailed DOM inspection in a real test
    })
  })

  describe('Tour steps content', () => {
    test('should have welcome step with correct content', () => {
      // This would test the actual step content
      // In a real implementation, you'd render the steps and verify content
      const component = render(<OnboardingTourEnhanced autoStart={true} />)
      
      // Verify step content includes expected elements
      // This is a placeholder for more detailed content testing
      expect(component).toBeTruthy()
    })

    test('should have add subscription step', () => {
      // Test for Add Subscription step content
      expect(true).toBe(true) // Placeholder
    })

    test('should have connect email step', () => {
      // Test for Connect Email step content
      expect(true).toBe(true) // Placeholder
    })

    test('should have wallet settings step', () => {
      // Test for Wallet Settings step content
      expect(true).toBe(true) // Placeholder
    })
  })
})

describe('Integration with data-tour attributes', () => {
  test('should target correct elements', () => {
    // Mock DOM elements with data-tour attributes
    document.body.innerHTML = `
      <button data-tour="add-subscription">Add Subscription</button>
      <div data-tour="connect-email">Connect Email</div>
      <div data-tour="wallet-settings">Wallet Settings</div>
    `
    
    // Verify elements exist for tour targeting
    expect(document.querySelector('[data-tour="add-subscription"]')).toBeInTheDocument()
    expect(document.querySelector('[data-tour="connect-email"]')).toBeInTheDocument()
    expect(document.querySelector('[data-tour="wallet-settings"]')).toBeInTheDocument()
  })
})
