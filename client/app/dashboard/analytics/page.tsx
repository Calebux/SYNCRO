"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { analyticsApi, type AnalyticsSummary } from "@/lib/api/analytics"
import { useTheme } from "next-themes"
import { Skeleton } from "@/components/ui/skeleton"
import { BarChart3, AlertTriangle, PlusCircle } from "lucide-react"
import Link from "next/link"

const AnalyticsPage = dynamic(() => import("@/components/pages/analytics"), {
  loading: () => <AnalyticsLoadingSkeleton />,
})

// ─── Empty state ──────────────────────────────────────────────────────────────

function AnalyticsEmptyState({ darkMode }: { darkMode: boolean }) {
  return (
    <section
      aria-labelledby="analytics-empty-heading"
      className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center gap-4"
    >
      <BarChart3
        className={`h-12 w-12 ${darkMode ? "text-gray-600" : "text-gray-300"}`}
        aria-hidden="true"
      />
      <h2
        id="analytics-empty-heading"
        className={`text-xl font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
      >
        No analytics yet
      </h2>
      <p className={`text-sm max-w-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
        Add your first subscription to start tracking spending trends and category breakdowns.
      </p>
      <Link
        href="/dashboard?action=add"
        className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        <PlusCircle className="h-4 w-4" aria-hidden="true" />
        Add your first subscription
      </Link>
    </section>
  )
}

// ─── Error state ──────────────────────────────────────────────────────────────

function AnalyticsErrorState({
  message,
  onRetry,
  darkMode,
}: {
  message: string
  onRetry: () => void
  darkMode: boolean
}) {
  return (
    <section
      aria-labelledby="analytics-error-heading"
      role="alert"
      className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center gap-4"
    >
      <AlertTriangle className="h-10 w-10 text-red-500" aria-hidden="true" />
      <h2
        id="analytics-error-heading"
        className={`text-xl font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
      >
        Couldn&apos;t load analytics
      </h2>
      <p className={`text-sm max-w-sm ${darkMode ? "text-red-400" : "text-red-600"}`}>
        {message}
      </p>
      <button
        onClick={onRetry}
        className="mt-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        Try again
      </button>
    </section>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function AnalyticsLoadingSkeleton() {
  return (
    <div className="p-4 sm:p-8 space-y-8" aria-busy="true" aria-label="Loading analytics…">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        <Skeleton className="h-64 sm:h-80 w-full rounded-xl" />
        <Skeleton className="h-64 sm:h-80 w-full rounded-xl" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}

// ─── Route component ──────────────────────────────────────────────────────────

export default function AnalyticsRoute() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { theme } = useTheme()
  const darkMode = theme === "dark"

  const fetchAnalytics = async () => {
    setError(null)
    setLoading(true)
    try {
      const data = await analyticsApi.getSummary()
      setSummary(data)
    } catch (err) {
      console.error("Failed to fetch analytics:", err)
      const isNetworkError =
        err instanceof TypeError && err.message.toLowerCase().includes("network")
      setError(
        isNetworkError
          ? "Network error — check your connection and try again."
          : "Failed to load analytics data. Please try again."
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [])

  if (loading) return <AnalyticsLoadingSkeleton />

  if (error) {
    return (
      <AnalyticsErrorState
        message={error}
        onRetry={fetchAnalytics}
        darkMode={darkMode}
      />
    )
  }

  if (!summary || summary.active_subscriptions === 0) {
    return <AnalyticsEmptyState darkMode={darkMode} />
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 sm:mb-8">
        <h1
          className={`text-2xl sm:text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}
        >
          Spending Analytics
        </h1>
        <p
          className={`text-sm sm:text-base mt-1 ${darkMode ? "text-gray-400" : "text-gray-600"}`}
        >
          Track your subscription spend and stay within budget.
        </p>
      </div>
      <AnalyticsPage summary={summary} darkMode={darkMode} />
    </div>
  )
}
