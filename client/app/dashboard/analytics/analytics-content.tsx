"use client";

import AnalyticsPage from "@/components/pages/analytics";
import { AnalyticsSummary } from "@/lib/api/analytics";
import { useTheme } from "next-themes";
import { BarChart3 } from "lucide-react";

interface AnalyticsPageContentProps {
  initialSummary: AnalyticsSummary | null;
}

/**
 * Interactive island for the analytics route.
 *
 * The summary is computed on the server and passed in as a prop; this
 * component holds only the genuinely interactive state (theme, charts).
 */
export function AnalyticsPageContent({ initialSummary }: AnalyticsPageContentProps) {
  const { theme } = useTheme();
  const darkMode = theme === "dark";

  if (!initialSummary || initialSummary.active_subscriptions === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] p-8 text-center gap-4">
        <BarChart3 className={`h-12 w-12 ${darkMode ? "text-gray-600" : "text-gray-300"}`} aria-hidden="true" />
        <h2 className={`text-xl font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>
          No analytics yet
        </h2>
        <p className={`text-sm max-w-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
          Add your first subscription to start tracking spending trends and category breakdowns.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 sm:mb-8">
        <h1 className={`text-2xl sm:text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
          Spending Analytics
        </h1>
        <p className={`text-sm sm:text-base mt-1 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
          Track your subscription spend and stay within budget.
        </p>
      </div>
      <AnalyticsPage summary={initialSummary} darkMode={darkMode} />
    </div>
  );
}
