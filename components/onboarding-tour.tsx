"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { X } from "lucide-react"

interface TourStep {
  title: string
  description: string
  target?: string
  position?: "top" | "bottom" | "left" | "right"
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to SubSync AI",
    description: "Let's take a quick tour to help you get started with managing your subscriptions.",
  },
  {
    title: "Add Subscriptions",
    description:
      "Click the 'Add Subscription' button to manually add subscriptions or connect your email to scan automatically.",
    target: "[data-tour='add-subscription']",
    position: "bottom",
  },
  {
    title: "View Analytics",
    description:
      "Track your spending trends, compare year-over-year data, and get insights on your subscription costs.",
    target: "[data-tour='analytics']",
    position: "right",
  },
  {
    title: "Manage Team",
    description: "Invite team members, assign roles, and collaborate on subscription management.",
    target: "[data-tour='teams']",
    position: "right",
  },
  {
    title: "Keyboard Shortcuts",
    description: "Press Ctrl+K (or Cmd+K) to open the command palette for quick actions. Press / to search.",
  },
]

export function OnboardingTour() {
  const [currentStep, setCurrentStep] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    // Check if user has completed tour
    const tourCompleted = localStorage.getItem("onboarding-tour-completed")
    if (!tourCompleted) {
      setIsVisible(true)
    }
  }, [])

  useEffect(() => {
    if (!isVisible) return

    const step = TOUR_STEPS[currentStep]
    if (step.target) {
      const element = document.querySelector(step.target)
      if (element) {
        const rect = element.getBoundingClientRect()
        const cardWidth = 320
        const cardHeight = 200

        let top = rect.top
        let left = rect.left

        switch (step.position) {
          case "bottom":
            top = rect.bottom + 10
            left = rect.left + rect.width / 2 - cardWidth / 2
            break
          case "top":
            top = rect.top - cardHeight - 10
            left = rect.left + rect.width / 2 - cardWidth / 2
            break
          case "left":
            top = rect.top + rect.height / 2 - cardHeight / 2
            left = rect.left - cardWidth - 10
            break
          case "right":
            top = rect.top + rect.height / 2 - cardHeight / 2
            left = rect.right + 10
            break
        }

        setPosition({ top, left })

        // Highlight the target element
        element.classList.add("ring-2", "ring-primary", "ring-offset-2")
        return () => {
          element.classList.remove("ring-2", "ring-primary", "ring-offset-2")
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

  const handleSkip = () => {
    handleComplete()
  }

  const handleComplete = () => {
    localStorage.setItem("onboarding-tour-completed", "true")
    setIsVisible(false)
  }

  if (!isVisible) return null

  const step = TOUR_STEPS[currentStep]
  const hasTarget = !!step.target

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={handleSkip} />

      {/* Tour Card */}
      <Card
        className="fixed z-50 w-80"
        style={
          hasTarget
            ? {
                top: `${position.top}px`,
                left: `${position.left}px`,
              }
            : {
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
              }
        }
      >
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{step.title}</CardTitle>
              <CardDescription className="mt-2">
                Step {currentStep + 1} of {TOUR_STEPS.length}
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={handleSkip}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{step.description}</p>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={handleSkip}>
            Skip Tour
          </Button>
          <Button onClick={handleNext}>{currentStep < TOUR_STEPS.length - 1 ? "Next" : "Finish"}</Button>
        </CardFooter>
      </Card>
    </>
  )
}
