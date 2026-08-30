"use client"

import { useCallback, useEffect, useState } from "react"

// Lightweight tour state hook separated from Joyride UI to keep initial bundle small.
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