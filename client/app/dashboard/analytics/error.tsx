"use client"

import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"

interface AnalyticsErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AnalyticsError({ error, reset }: AnalyticsErrorProps) {
  useEffect(() => {
    console.error("Analytics route error:", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center gap-4">
      <AlertTriangle className="h-10 w-10 text-red-500" aria-hidden="true" />
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
        Failed to load analytics
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
        Something went wrong while fetching your spending data. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
