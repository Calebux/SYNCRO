"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Mail, Wallet, Sparkles, X, ArrowRight, ArrowLeft } from "lucide-react"

interface OnboardingTourSimpleProps {
  onComplete?: () => void
  onSkip?: () => void
  darkMode?: boolean
  autoStart?: boolean
}

interface TourStep {
  title: string
  description: string
  target?: string
  position?: "top" | "bottom" | "left" | "right" | "center"
  icon?: React.ReactNode
  content?: React.ReactNode
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to SYNCRO!",
    description: "Let's take a quick 2-minute tour to help you get started with managing your subscriptions effectively.",
    position: "center",
    icon: <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
      <Sparkles className="w-5 h-5 text-white" />
    </div>,
    content: (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary" className="text-xs">
          3 steps
        </Badge>
        <span>•</span>
        <span>~2 minutes</span>
      </div>
    ),
  },
  {
    title: "Add Your First Subscription",
    description: "Start by adding subscriptions manually or connect your email to automatically scan for existing ones.",
    target: "[data-tour='add-subscription']",
    position: "bottom",
    icon: <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
      <Plus className="w-4 h-4 text-white" />
    </div>,
    content: (
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
    ),
  },
  {
    title: "Connect Your Email",
    description: "Connect Gmail, Outlook, or any IMAP email to automatically track subscription changes and renewals.",
    target: "[data-tour='connect-email']",
    position: "right",
    icon: <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
      <Mail className="w-4 h-4 text-white" />
    </div>,
    content: (
      <div className="space-y-3">
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
      </div>
    ),
  },
  {
    title: "Set Up Budget Tracking",
    description: "Configure payment methods and budget limits to track spending and get alerts when approaching limits.",
    target: "[data-tour='wallet-settings']",
    position: "left",
    icon: <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
      <Wallet className="w-4 h-4 text-white" />
    </div>,
    content: (
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
        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
          <p className="text-xs text-green-800 dark:text-green-200">
            <strong>🎉 You're all set!</strong> Start adding subscriptions to see the magic happen.
          </p>
        </div>
      </div>
    ),
  },
]

export function OnboardingTourSimple({
  onComplete,
  onSkip,
  darkMode = false,
  autoStart = true,
}: OnboardingTourSimpleProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    // Check if user has completed tour
    const tourCompleted = localStorage.getItem("onboarding-tour-completed")
    const tourSkipped = localStorage.getItem("onboarding-tour-skipped")
    
    if (!tourCompleted && !tourSkipped && autoStart) {
      // Small delay to ensure DOM elements are rendered
      const timer = setTimeout(() => {
        setIsVisible(true)
      }, 1000)
      
      return () => clearTimeout(timer)
    }
  }, [autoStart])

  useEffect(() => {
    if (!isVisible) return

    const step = TOUR_STEPS[currentStep]
    if (step.target && step.position !== "center") {
      const element = document.querySelector(step.target)
      if (element) {
        const rect = element.getBoundingClientRect()
        const cardWidth = 400
        const cardHeight = 300

        let top = rect.top
        let left = rect.left

        switch (step.position) {
          case "bottom":
            top = rect.bottom + 10
            left = Math.max(10, Math.min(window.innerWidth - cardWidth - 10, rect.left + rect.width / 2 - cardWidth / 2))
            break
          case "top":
            top = rect.top - cardHeight - 10
            left = Math.max(10, Math.min(window.innerWidth - cardWidth - 10, rect.left + rect.width / 2 - cardWidth / 2))
            break
          case "left":
            top = Math.max(10, Math.min(window.innerHeight - cardHeight - 10, rect.top + rect.height / 2 - cardHeight / 2))
            left = rect.left - cardWidth - 10
            break
          case "right":
            top = Math.max(10, Math.min(window.innerHeight - cardHeight - 10, rect.top + rect.height / 2 - cardHeight / 2))
            left = rect.right + 10
            break
        }

        // Ensure the card stays within viewport bounds
        top = Math.max(10, Math.min(window.innerHeight - cardHeight - 10, top))
        left = Math.max(10, Math.min(window.innerWidth - cardWidth - 10, left))

        setPosition({ top, left })

        // Highlight the target element
        element.classList.add("ring-2", "ring-primary", "ring-offset-2", "relative", "z-50")
        return () => {
          element.classList.remove("ring-2", "ring-primary", "ring-offset-2", "relative", "z-50")
        }
      }
    }
  }, [currentStep, isVisible])

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleComplete()
    }
  }

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSkip = () => {
    localStorage.setItem("onboarding-tour-skipped", "true")
    setIsVisible(false)
    onSkip?.()
  }

  const handleComplete = () => {
    localStorage.setItem("onboarding-tour-completed", "true")
    setIsVisible(false)
    onComplete?.()
  }

  if (!isVisible) return null

  const step = TOUR_STEPS[currentStep]
  const isCenter = step.position === "center"

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={handleSkip} />

      {/* Tour Card */}
      <Card
        className="fixed z-50 w-96 max-w-[calc(100vw-2rem)]"
        style={
          isCenter
            ? {
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
              }
            : {
                top: `${position.top}px`,
                left: `${position.left}px`,
              }
        }
      >
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {step.icon}
              <div>
                <CardTitle className="text-lg">{step.title}</CardTitle>
                <CardDescription className="mt-1">
                  Step {currentStep + 1} of {TOUR_STEPS.length}
                </CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleSkip}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{step.description}</p>
          {step.content}
          
          <div className="flex justify-between items-center pt-4">
            <div className="flex gap-2">
              {currentStep > 0 && (
                <Button variant="outline" onClick={handlePrevious} size="sm">
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
              )}
              <Button variant="outline" onClick={handleSkip} size="sm">
                Skip Tour
              </Button>
            </div>
            <Button onClick={handleNext} size="sm">
              {currentStep < TOUR_STEPS.length - 1 ? (
                <>
                  Next
                  <ArrowRight className="w-4 h-4 ml-1" />
                </>
              ) : (
                "Finish Tour"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

// Hook for managing tour state
export function useOnboardingTourSimple() {
  const [tourCompleted, setTourCompleted] = useState(false)
  const [tourSkipped, setTourSkipped] = useState(false)

  useEffect(() => {
    setTourCompleted(!!localStorage.getItem("onboarding-tour-completed"))
    setTourSkipped(!!localStorage.getItem("onboarding-tour-skipped"))
  }, [])

  const resetTour = useCallback(() => {
    localStorage.removeItem("onboarding-tour-completed")
    localStorage.removeItem("onboarding-tour-skipped")
    setTourCompleted(false)
    setTourSkipped(false)
  }, [])

  const completeTour = useCallback(() => {
    localStorage.setItem("onboarding-tour-completed", "true")
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