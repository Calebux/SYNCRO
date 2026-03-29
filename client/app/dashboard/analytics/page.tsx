"use client"

import { useEffect, useState } from "react"
import AnalyticsPage from "@/components/pages/analytics"
import { analyticsApi, AnalyticsSummary } from "@/lib/api/analytics"
import { useTheme } from "next-themes"
import { Skeleton } from "@/components/ui/skeleton"

export default function AnalyticsRoute() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { theme } = useTheme()
  const darkMode = theme === "dark"

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const data = await analyticsApi.getSummary()
        setSummary(data)
      } catch (err) {
        console.error("Failed to fetch analytics:", err)
        setError("Failed to load analytics data. Please try again later.")
      } finally {
        setLoading(false)
      }
    }

    fetchAnalytics()
  }, [])

  if (loading) {
    return (
      <div className="p-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">{error || "Something went wrong"}</p>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className={`text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>Spending Analytics</h1>
        <p className={darkMode ? "text-gray-400" : "text-gray-600"}>Track your subscription spend and stay within budget.</p>
      </div>
      <AnalyticsPage summary={summary} darkMode={darkMode} />
    </div>
  )
}
