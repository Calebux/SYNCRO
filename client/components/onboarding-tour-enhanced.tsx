"use client"

import { useState, useEffect, useCallback } from "react"
import Joyride, { CallBackProps, STATUS, EVENTS, ACTIONS } from "react-joyride-react-19"
import { Plus, Mail, Wallet } from "lucide-react"

interface OnboardingTourEnhancedProps {
  onComplete?: () => void
  onSkip?: () => void
  darkMode?: boolean
  autoStart?: boolean
}

const TOUR_STEPS = [
  {
    target: "[data-tour='add-subscription']",
    content: (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
            <Plus className="w-4 h-4 text-white" />
          </div>
          <h3 className="text-lg font-semibold">Add Your First Subscription</h3>
        </div>
        <p className="text-gray-700 dark:text-gray-300">
          Start by adding subscriptions manually or connect your email to automatically scan for existing ones.
        </p>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="w-6 h-6 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-blue-600 dark:text-blue-400 text-xs font-semibold">1</span>
            </div>
            <div>
              <p className="text-sm font-medium">Quick Add</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Choose from 100+ pre-configured services like Netflix, Spotify, etc.</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="w-6 h-6 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-green-600 dark:text-green-400 text-xs font-semibold">2</span>
            </div>
            <div>
              <p className="text-sm font-medium">Email Scan</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Automatically detect subscriptions from receipts and confirmations</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="px-2 py-1 bg-blue-100 dark:bg-blue-900 rounded text-blue-700 dark:text-blue-300 text-xs font-medium">
            Step 1 of 3
          </div>
          <span>•</span>
          <span>~2 minutes</span>
        </div>
      </div>
    ),
    placement: "bottom" as const,
  },
  {
    target: "[data-tour='connect-email']",
    content: (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
            <Mail className="w-4 h-4 text-white" />
          </div>
          <h3 className="text-lg font-semibold">Connect Your Email</h3>
        </div>
        <p className="text-gray-700 dark:text-gray-300">
          Connect Gmail, Outlook, or any IMAP email to automatically track subscription changes and renewals.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span className="text-sm font-medium">Gmail</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
            <div className="w-4 h-4 bg-blue-500 rounded"></div>
            <span className="text-sm font-medium">Outlook</span>
          </div>
        </div>
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <strong>Privacy First:</strong> We only scan for subscription-related emails and never store your personal messages.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="px-2 py-1 bg-blue-100 dark:bg-blue-900 rounded text-blue-700 dark:text-blue-300 text-xs font-medium">
            Step 2 of 3
          </div>
        </div>
      </div>
    ),
    placement: "right" as const,
  },
  {
    target: "[data-tour='wallet-settings']",
    content: (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
            <Wallet className="w-4 h-4 text-white" />
          </div>
          <h3 className="text-lg font-semibold">Set Up Wallet</h3>
        </div>
        <p className="text-gray-700 dark:text-gray-300">
          Configure your wallet and budget limits to track spending and get alerts when approaching limits.
        </p>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <div className="w-6 h-6 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <Wallet className="w-3 h-3 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium">Budget Limits</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Set monthly spending limits and get alerts before you overspend</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
            <div className="w-6 h-6 bg-orange-100 dark:bg-orange-900 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-orange-600 dark:text-orange-400 text-xs">📊</span>
            </div>
            <div>
              <p className="text-sm font-medium">Spending Analytics</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Track trends and optimize your subscription portfolio</p>
            </div>
          </div>
        </div>
        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
          <p className="text-xs text-green-800 dark:text-green-200">
            <strong>🎉 Setup Complete!</strong> You&apos;re ready to manage your subscriptions.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="px-2 py-1 bg-green-100 dark:bg-green-900 rounded text-green-700 dark:text-green-300 text-xs font-medium">
            Step 3 of 3
          </div>
        </div>
      </div>
    ),
    placement: "left" as const,
  },
]

export function OnboardingTourEnhanced({
  onComplete,
  onSkip,
  darkMode = false,
  autoStart = true,
}: OnboardingTourEnhancedProps) {
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    // Check if user has completed tour
    const tourCompleted = localStorage.getItem("onboarding-tour-completed")
    const tourSkipped = localStorage.getItem("onboarding-tour-skipped")
    
    // Resume from saved step if partially completed
    const savedStep = localStorage.getItem("onboarding-tour-step-index")
    if (savedStep) {
      setStepIndex(parseInt(savedStep, 10))
    }
    
    if (!tourCompleted && !tourSkipped && autoStart) {
      // Small delay to ensure DOM elements are rendered
      const timer = setTimeout(() => {
        setRun(true)
      }, 1000)
      
      return () => clearTimeout(timer)
    }
  }, [autoStart])

  const trackEvent = (eventName: string, data?: any) => {
    // Basic analytics tracking via console to simulate analytics capture
    console.log(`[Analytics] ${eventName}`, data)
  }

  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status, type, action, index } = data

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
      setStepIndex(nextIndex)
      localStorage.setItem("onboarding-tour-step-index", String(nextIndex))
    }

    if (([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(status)) {
      setRun(false)
      
      if (status === STATUS.FINISHED) {
        localStorage.setItem("onboarding-tour-completed", "true")
        localStorage.removeItem("onboarding-tour-step-index")
        trackEvent("Tour Completed")
        onComplete?.()
      } else if (status === STATUS.SKIPPED) {
        localStorage.setItem("onboarding-tour-skipped", "true")
        trackEvent("Tour Skipped", { step: index })
        onSkip?.()
      }
    }

    // Handle close button click
    if (type === EVENTS.STEP_AFTER && action === ACTIONS.CLOSE) {
      setRun(false)
      localStorage.setItem("onboarding-tour-skipped", "true")
      trackEvent("Tour Skipped", { step: index, action: "close" })
      onSkip?.()
    }
  }, [onComplete, onSkip])

  if (!run) return null

  return (
    <Joyride
      stepIndex={stepIndex}
      steps={TOUR_STEPS}
      run={run}
      continuous
      showProgress
      showSkipButton
      callback={handleJoyrideCallback}
      styles={{
        options: {
          primaryColor: darkMode ? "#3b82f6" : "#2563eb",
          backgroundColor: darkMode ? "#1f2937" : "#ffffff",
          textColor: darkMode ? "#f9fafb" : "#374151",
          overlayColor: "rgba(0, 0, 0, 0.5)",
          arrowColor: darkMode ? "#1f2937" : "#ffffff",
          zIndex: 1000,
        },
        tooltip: {
          borderRadius: 8,
          padding: 20,
          fontSize: 14,
          maxWidth: 400,
        },
        tooltipContainer: {
          textAlign: "left" as const,
        },
        tooltipTitle: {
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 8,
          color: darkMode ? "#f9fafb" : "#111827",
        },
        tooltipContent: {
          color: darkMode ? "#d1d5db" : "#4b5563",
          lineHeight: 1.5,
        },
        buttonNext: {
          backgroundColor: darkMode ? "#3b82f6" : "#2563eb",
          color: "#ffffff",
          borderRadius: 6,
          padding: "8px 16px",
          fontSize: 14,
          fontWeight: 500,
          border: "none",
          cursor: "pointer",
        },
        buttonBack: {
          backgroundColor: "transparent",
          color: darkMode ? "#9ca3af" : "#6b7280",
          borderRadius: 6,
          padding: "8px 16px",
          fontSize: 14,
          fontWeight: 500,
          border: `1px solid ${darkMode ? "#4b5563" : "#d1d5db"}`,
          cursor: "pointer",
          marginRight: 8,
        },
        buttonSkip: {
          backgroundColor: "transparent",
          color: darkMode ? "#9ca3af" : "#6b7280",
          borderRadius: 6,
          padding: "8px 16px",
          fontSize: 14,
          fontWeight: 500,
          border: "none",
          cursor: "pointer",
        },
        buttonClose: {
          backgroundColor: "transparent",
          color: darkMode ? "#9ca3af" : "#6b7280",
          border: "none",
          cursor: "pointer",
          fontSize: 16,
          padding: 4,
          position: "absolute" as const,
          right: 8,
          top: 8,
        },
        spotlight: {
          borderRadius: 4,
        },
        beacon: {
          backgroundColor: darkMode ? "#3b82f6" : "#2563eb",
        },
      }}
      locale={{
        back: "Back",
        close: "Close",
        last: "Finish Tour",
        next: "Next",
        skip: "Skip Tour",
      }}
      disableOverlayClose
      hideCloseButton={false}
      scrollToFirstStep
      spotlightClicks
      disableScrollParentFix
    />
  )
}

// Hook for managing tour state
export function useOnboardingTourEnhanced() {
  const [tourCompleted, setTourCompleted] = useState(false)
  const [tourSkipped, setTourSkipped] = useState(false)

  useEffect(() => {
    setTourCompleted(!!localStorage.getItem("onboarding-tour-completed"))
    setTourSkipped(!!localStorage.getItem("onboarding-tour-skipped"))
  }, [])

  const resetTour = useCallback(() => {
    localStorage.removeItem("onboarding-tour-completed")
    localStorage.removeItem("onboarding-tour-skipped")
    localStorage.removeItem("onboarding-tour-step-index")
    setTourCompleted(false)
    setTourSkipped(false)
  }, [])

  const completeTour = useCallback(() => {
    localStorage.setItem("onboarding-tour-completed", "true")
    localStorage.removeItem("onboarding-tour-step-index")
    setTourCompleted(true)
  }, [])

  const skipTour = useCallback(() => {
    localStorage.setItem("onboarding-tour-skipped", "true")
    setTourSkipped(true)
  }, [])

  return {
    tourCompleted,
    tourSkipped,
    shouldShowTour: !tourCompleted && !tourSkipped,
    resetTour,
    completeTour,
    skipTour,
  }
}