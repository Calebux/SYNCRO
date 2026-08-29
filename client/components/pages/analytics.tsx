"use client"

import { useState } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { AnalyticsSummary } from "@/lib/api/analytics"
import { Download, Calendar, BarChart3, ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from "lucide-react"
import { Progress } from "@syncro/ui"
import { type Currency, formatCurrency, CURRENCY_SYMBOLS } from "@/lib/currency-utils"
import { useUserSettings } from "@/components/providers/user-settings-provider"
import { DISPLAY_CURRENCIES } from "@/lib/exchange-rates"
import { useExchangeRates } from "@/hooks/use-exchange-rates"

interface AnalyticsPageProps {
  summary: AnalyticsSummary
  darkMode?: boolean
  mode?: string
  savedBySyncroCount?: number
}

export default function AnalyticsPage({ summary, darkMode, savedBySyncroCount = 0 }: AnalyticsPageProps) {
  const { settings } = useUserSettings()
  const [chartCurrency, setChartCurrency] = useState<Currency>(settings.currency)
  const { convert, isLoading: ratesLoading } = useExchangeRates()
  const currency = settings.currency
  const [view, setView] = useState("default")
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const COLORS = ["#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe", "#e0e7ff"]

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        <div className={`p-4 sm:p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <p className="text-xs sm:text-sm text-gray-400 mb-1">Total Monthly Spend</p>
          <p className={`text-2xl sm:text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
            {formatCurrency(summary.total_monthly_spend, currency)}
          </p>
        </div>
        <div className={`p-4 sm:p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <p className="text-xs sm:text-sm text-gray-400 mb-1">Active Subscriptions</p>
          <p className={`text-2xl sm:text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
            {summary.active_subscriptions}
          </p>
        </div>
        <div className={`p-4 sm:p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <p className="text-xs sm:text-sm text-gray-400 mb-1">Upcoming (7 days)</p>
          <p className={`text-2xl sm:text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
            {summary.upcoming_renewals_count}
          </p>
        </div>
      </div>

      {/* Budget Progress */}
      {summary.budget_status.overall_limit && (
        <div className={`p-4 sm:p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
            <h3 className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Monthly Budget</h3>
            <span className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
              {formatCurrency(summary.budget_status.current_spend, currency)} / {formatCurrency(summary.budget_status.overall_limit, currency)}
            </span>
          </div>
          <Progress value={summary.budget_status.percentage} className="h-2" />
          <p className="text-xs text-gray-400 mt-2">
            {summary.budget_status.percentage.toFixed(1)}% of budget used
          </p>
        </div>
      )}

      {/* Main Charts */}
      {/* Chart currency toggle – Issue #972 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-sm font-medium ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
          Chart currency:
        </span>
        <div role="group" aria-label="Select chart currency" className="flex flex-wrap gap-1">
          {DISPLAY_CURRENCIES.map((code) => (
            <button
              key={code}
              onClick={() => setChartCurrency(code)}
              aria-pressed={chartCurrency === code}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD166] ${
                chartCurrency === code
                  ? "bg-[#FFD166] text-[#1E2A35]"
                  : darkMode
                  ? "bg-[#374151] text-gray-300 hover:bg-[#4B5563]"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {CURRENCY_SYMBOLS[code] ?? code} {code}
            </button>
          ))}
        </div>
        {ratesLoading && (
          <span className="text-xs text-gray-400" aria-live="polite">
            Loading live rates…
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        <div className={`p-4 sm:p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <h3 className={`font-semibold mb-4 sm:mb-6 ${darkMode ? "text-white" : "text-gray-900"}`}>Spending Trend</h3>
          <div className="w-full overflow-x-auto">
            <div style={{ minWidth: 280 }}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={summary.monthly_trend.map((point) => ({
                    ...point,
                    total_spend: convert(point.total_spend, "USD", chartCurrency),
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#374151" : "#e5e7eb"} />
                  <XAxis dataKey="month" stroke={darkMode ? "#9ca3af" : "#9ca3af"} tick={{ fontSize: 11 }} />
                  <YAxis stroke={darkMode ? "#9ca3af" : "#9ca3af"} tick={{ fontSize: 11 }} width={55} />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value), chartCurrency)}
                    contentStyle={{ backgroundColor: darkMode ? "#1F2937" : "#FFF", border: "none", borderRadius: "8px" }}
                    itemStyle={{ color: "#6366F1" }}
                  />
                  <Line type="monotone" dataKey="total_spend" stroke="#6366F1" strokeWidth={3} dot={{ fill: "#6366F1", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className={`p-4 sm:p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <h3 className={`font-semibold mb-4 sm:mb-6 ${darkMode ? "text-white" : "text-gray-900"}`}>Category Breakdown</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={summary.category_breakdown.map((item) => ({
                  ...item,
                  total_spend: convert(item.total_spend, "USD", chartCurrency),
                }))}
                dataKey="total_spend"
                nameKey="category"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={5}
              >
                {summary.category_breakdown.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrency(Number(value), chartCurrency)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {summary.category_breakdown.map((cat, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs sm:text-sm">
                <div className="w-2 h-2 flex-shrink-0 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                <span className="text-gray-400 truncate">
                  {cat.category}: {formatCurrency(convert(cat.total_spend, "USD", chartCurrency), chartCurrency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Saved by SYNCRO metric */}
      {savedBySyncroCount > 0 && (
        <div className={`border rounded-xl p-6 flex items-center gap-5 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <div className="text-4xl" aria-hidden="true">🛡️</div>
          <div>
            <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
              Saved by SYNCRO
            </h3>
            <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
              You cancelled <span className="font-bold text-[#007A5C]">{savedBySyncroCount}</span> trial{savedBySyncroCount !== 1 ? "s" : ""} before being auto-charged — nice work.
            </p>
          </div>
        </div>
      )}

      {/* Top Subscriptions */}
      <div className={`p-4 sm:p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
        <h3 className={`font-semibold mb-4 sm:mb-6 ${darkMode ? "text-white" : "text-gray-900"}`}>Top Subscriptions (Monthly)</h3>
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <div className="min-w-[320px]">
            <div className="space-y-3 sm:space-y-4">
              {summary.top_subscriptions.map((sub, idx) => (
                <div key={idx} className="flex justify-between items-center pb-3 sm:pb-4 border-b border-gray-700 last:border-0 gap-4">
                  <div className="min-w-0">
                    <p className={`font-medium truncate ${darkMode ? "text-white" : "text-gray-900"}`}>{sub.name}</p>
                    <p className="text-xs text-gray-400">{sub.billing_cycle}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold text-sm sm:text-base ${darkMode ? "text-white" : "text-gray-900"}`}>
                      {formatCurrency(sub.monthly_normalized_price, currency)}
                    </p>
                    <p className="text-xs text-green-600">Active</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
