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
import { downloadSubscriptionPDF } from "@/lib/pdf-report"
import { Progress } from "@/components/ui/progress"

interface AnalyticsPageProps {
  summary: AnalyticsSummary
  darkMode?: boolean
}

export default function AnalyticsPage({ summary, darkMode }: AnalyticsPageProps) {
  const [view, setView] = useState("default")
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const COLORS = ["#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe", "#e0e7ff"]

  const handleExportCSV = () => {
    // Basic CSV export
    const headers = ["Name", "Monthly Price", "Cycle"]
    const rows = summary.top_subscriptions.map((sub) => [
      sub.name,
      `$${sub.monthly_normalized_price.toFixed(2)}`,
      sub.billing_cycle,
    ])

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `analytics-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
  }

  return (
    <div className="space-y-8">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className={`p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <p className="text-sm text-gray-400 mb-1">Total Monthly Spend</p>
          <p className={`text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
            ${summary.total_monthly_spend.toFixed(2)}
          </p>
        </div>
        <div className={`p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <p className="text-sm text-gray-400 mb-1">Active Subscriptions</p>
          <p className={`text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
            {summary.active_subscriptions}
          </p>
        </div>
        <div className={`p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <p className="text-sm text-gray-400 mb-1">Upcoming (7 days)</p>
          <p className={`text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
            {summary.upcoming_renewals_count}
          </p>
        </div>
      </div>

      {/* Budget Progress */}
      {summary.budget_status.overall_limit && (
        <div className={`p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <div className="flex justify-between items-center mb-4">
            <h3 className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Monthly Budget</h3>
            <span className={darkMode ? "text-gray-400" : "text-gray-600"}>
              ${summary.budget_status.current_spend.toFixed(2)} / ${summary.budget_status.overall_limit.toFixed(2)}
            </span>
          </div>
          <Progress value={summary.budget_status.percentage} className="h-2" />
          <p className="text-xs text-gray-400 mt-2">
            {summary.budget_status.percentage.toFixed(1)}% of budget used
          </p>
        </div>
      )}

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className={`p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <h3 className={`font-semibold mb-6 ${darkMode ? "text-white" : "text-gray-900"}`}>Spending Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={summary.monthly_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#374151" : "#e5e7eb"} />
              <XAxis dataKey="month" stroke={darkMode ? "#9ca3af" : "#9ca3af"} />
              <YAxis stroke={darkMode ? "#9ca3af" : "#9ca3af"} />
              <Tooltip 
                contentStyle={{ backgroundColor: darkMode ? "#1F2937" : "#FFF", border: 'none', borderRadius: '8px' }}
                itemStyle={{ color: '#6366F1' }}
              />
              <Line type="monotone" dataKey="total_spend" stroke="#6366F1" strokeWidth={3} dot={{ fill: "#6366F1", r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className={`p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
          <h3 className={`font-semibold mb-6 ${darkMode ? "text-white" : "text-gray-900"}`}>Category Breakdown</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={summary.category_breakdown}
                dataKey="total_spend"
                nameKey="category"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
              >
                {summary.category_breakdown.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-4 grid grid-cols-2 gap-2">
             {summary.category_breakdown.map((cat, idx) => (
               <div key={idx} className="flex items-center gap-2 text-sm">
                 <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                 <span className="text-gray-400">{cat.category}: ${cat.total_spend.toFixed(0)}</span>
               </div>
             ))}
          </div>
        </div>
      </div>

      {/* Top Subscriptions */}
      <div className={`p-6 rounded-xl border ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"}`}>
        <h3 className={`font-semibold mb-6 ${darkMode ? "text-white" : "text-gray-900"}`}>Top Subscriptions (Monthly)</h3>
        <div className="space-y-4">
          {summary.top_subscriptions.map((sub, idx) => (
            <div key={idx} className="flex justify-between items-center pb-4 border-b border-gray-700 last:border-0">
              <div>
                <p className={`font-medium ${darkMode ? "text-white" : "text-gray-900"}`}>{sub.name}</p>
                <p className="text-xs text-gray-400">{sub.billing_cycle}</p>
              </div>
              <div className="text-right">
                <p className={`font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
                  ${sub.monthly_normalized_price.toFixed(2)}
                </p>
                <p className="text-xs text-green-500">Active</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
