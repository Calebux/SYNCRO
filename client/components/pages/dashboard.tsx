"use client"

import { ArrowRight, Mail, Sparkles, Package, FlaskConical } from "lucide-react"
import { useState } from "react"
import { formatCurrency, convertCurrency, getCurrencySymbol, type Currency } from "@/lib/currency-utils"

import { AnalyticsSummary } from "@/lib/api/analytics"

interface DashboardPageProps {
  subscriptions: any[]
  totalSpend: number
  summary?: AnalyticsSummary
  insights: any[]
  onViewInsights: () => void
  onRenew: (subscription: any) => void
  onManage: (subscription: any) => void
  darkMode?: boolean
  emailAccounts?: any[]
  duplicates?: any[]
  unusedSubscriptions?: any[]
  trialSubscriptions?: any[]
  displayCurrency?: Currency
  exchangeRates?: Record<string, number>
  ratesStale?: boolean
}

export default function DashboardPage({
  subscriptions,
  totalSpend,
  summary,
  insights,
  onViewInsights,
  onRenew,
  onManage,
  darkMode,
  emailAccounts,
  duplicates,
  unusedSubscriptions,
  trialSubscriptions,
  displayCurrency,
  exchangeRates,
  ratesStale,
}: DashboardPageProps) {
  const dc = displayCurrency || "USD"
  const rates = exchangeRates || {}

  const convertPrice = (price: number, currency?: string) => {
    const from = currency || "USD"
    if (from === dc || !rates[from]) return price
    return convertCurrency(price, from, dc, rates)
  }

  const [hoveredCard, setHoveredCard] = useState(null)
  const [filterEmail, setFilterEmail] = useState("all")
  const [filterType, setFilterType] = useState("all")
  const [searchTerm, setSearchTerm] = useState("")
  // Local trial list so cancel/convert removes the card immediately
  const [activeTrials, setActiveTrials] = useState<any[]>(
    () => (trialSubscriptions ?? subscriptions.filter((s: any) => s.isTrial && s.status === "active"))
  )

  const handleTrialAction = (_id: number, _action: "convert" | "cancel") => {
    setActiveTrials((prev) => prev.filter((t) => t.id !== _id))
  }

  const emailAccountsList = ["all", ...new Set(subscriptions.map((s) => s.email).filter(Boolean))]

  const searchFiltered = searchTerm
    ? subscriptions.filter((sub) => sub.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : subscriptions

  const emailFiltered =
    filterEmail === "all" ? searchFiltered : searchFiltered.filter((sub) => sub.email === filterEmail)

  const filteredSubscriptions =
    filterType === "all"
      ? emailFiltered
      : filterType === "ai"
        ? emailFiltered.filter((sub) => sub.category === "AI Tools")
        : emailFiltered.filter((sub) => sub.category !== "AI Tools")

  const activeSubscriptions = filteredSubscriptions.filter((sub) => sub.status === "active").length

  const filteredTotalSpend = filteredSubscriptions.reduce(
    (sum, sub) => sum + convertPrice(sub.price, sub.currency), 0
  )

  // Calculate AI vs Other stats
  const aiSubs = emailFiltered.filter((sub) => sub.category === "AI Tools")
  const otherSubs = emailFiltered.filter((sub) => sub.category !== "AI Tools")
  const aiSpend = aiSubs.reduce((sum, sub) => sum + convertPrice(sub.price, sub.currency), 0)
  const otherSpend = otherSubs.reduce((sum, sub) => sum + convertPrice(sub.price, sub.currency), 0)

  const hasNoSubscriptions = subscriptions.length === 0
  const hasNoResults = filteredSubscriptions.length === 0 && subscriptions.length > 0

  if (hasNoSubscriptions) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-6xl mb-4">📦</div>
        <h3 className={`text-2xl font-bold ${darkMode ? "text-white" : "text-gray-900"} mb-2`}>No subscriptions yet</h3>
        <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"} mb-6 text-center max-w-md`}>
          Start tracking your subscriptions by connecting your email or adding them manually. We'll help you manage and
          optimize your spending.
        </p>
        <button
          onClick={() => {}}
          className="bg-[#FFD166] text-[#1E2A35] px-6 py-3 rounded-lg font-semibold hover:bg-[#FFD166]/90 transition-colors"
        >
          Add your first subscription
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2" role="group" aria-label="Filter subscriptions by type">
          <button
            onClick={() => setFilterType("all")}
            aria-pressed={filterType === "all"}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterType === "all"
                ? "bg-[#FFD166] text-[#1E2A35]"
                : darkMode
                  ? "bg-[#2D3748] text-gray-400 hover:text-white"
                  : "bg-gray-100 text-gray-600 hover:text-gray-900"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterType("ai")}
            aria-pressed={filterType === "ai"}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              filterType === "ai"
                ? "bg-[#FFD166] text-[#1E2A35]"
                : darkMode
                  ? "bg-[#2D3748] text-gray-400 hover:text-white"
                  : "bg-gray-100 text-gray-600 hover:text-gray-900"
            }`}
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            AI Only
          </button>
          <button
            onClick={() => setFilterType("other")}
            aria-pressed={filterType === "other"}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              filterType === "other"
                ? "bg-[#FFD166] text-[#1E2A35]"
                : darkMode
                  ? "bg-[#2D3748] text-gray-400 hover:text-white"
                  : "bg-gray-100 text-gray-600 hover:text-gray-900"
            }`}
          >
            <Package className="w-4 h-4" aria-hidden="true" />
            Other Services
          </button>
        </div>

        <div className="flex gap-3">
          <label htmlFor="dashboard-search" className="sr-only">Search subscriptions</label>
          <input
            id="dashboard-search"
            type="search"
            placeholder="Search subscriptions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search subscriptions"
            className={`px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${
              darkMode ? "bg-[#2D3748] border-gray-700 text-white" : "bg-white border-gray-300 text-gray-900"
            }`}
          />
          {searchTerm && (
            <span role="status" aria-live="polite" className="sr-only">
              Showing {filteredSubscriptions.length} of {subscriptions.length} subscriptions
            </span>
          )}

          {emailAccountsList.length > 1 && (
            <select
              value={filterEmail}
              onChange={(e) => setFilterEmail(e.target.value)}
              className={`px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${
                darkMode ? "bg-[#2D3748] border-gray-700 text-white" : "bg-white border-gray-300 text-gray-900"
              }`}
            >
              {emailAccountsList.map((email) => (
                <option key={email} value={email}>
                  {email === "all" ? "All Emails" : email}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className={`${darkMode ? "bg-[#1E2A35]" : "bg-[#1E2A35]"} rounded-2xl p-6 mb-8 relative overflow-hidden`}>
        <div className="absolute right-0 top-0 w-48 h-48 bg-gray-700 rounded-full -mr-24 -mt-24 opacity-20"></div>
        <div className="relative z-10">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-gray-400 text-sm mb-1">
                {filterEmail === "all" ? "This Month's Total Spend" : `Spend from ${filterEmail}`}
              </p>
              <h3 className="text-4xl font-bold text-white mb-1">
                  {formatCurrency(filteredTotalSpend, dc)}
                  {ratesStale && (
                    <span className="text-xs text-gray-400 font-normal ml-2">(rates may be outdated)</span>
                  )}
                </h3>
              <p className="text-gray-400 text-xs">
                {filteredSubscriptions.length} subscription{filteredSubscriptions.length !== 1 ? "s" : ""}
                {filterEmail !== "all" && ` from this email`}
              </p>
            </div>
            <button
              onClick={onViewInsights}
              className="flex items-center gap-2 bg-[#FFD166] text-[#1E2A35] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#FFD166]/90 transition-colors"
            >
              View detailed insights
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#2D3748] rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-3 h-3 text-[#FFD166]" />
                <span className="text-gray-400 text-xs">AI Tools</span>
              </div>
              <p className="text-xl font-bold text-white">{formatCurrency(aiSpend, dc)}</p>
              <p className="text-xs text-gray-400">{aiSubs.length} subscriptions</p>
            </div>
            <div className="bg-[#2D3748] rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Package className="w-3 h-3 text-[#E86A33]" />
                <span className="text-gray-400 text-xs">Other Services</span>
              </div>
              <p className="text-xl font-bold text-white">{formatCurrency(otherSpend, dc)}</p>
              <p className="text-xs text-gray-400">{otherSubs.length} subscriptions</p>
            </div>
          </div>
        </div>
      </div>

      {/* Budget Overview Widget */}
      {summary?.budget_status?.overall_limit ? (
        <div className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-5 mb-8`}>
          <div className="flex justify-between items-center mb-2">
            <h3 className={`text-sm font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Overall Budget Status</h3>
            <span className={`text-sm font-bold ${summary.budget_status.percentage > 90 ? "text-red-500" : "text-green-500"}`}>
              ${summary.budget_status.current_spend.toFixed(0)} / ${summary.budget_status.overall_limit.toFixed(0)}
            </span>
          </div>
          <div className={`w-full ${darkMode ? "bg-[#1E2A35]" : "bg-gray-100"} rounded-full h-2`}>
            <div 
              className={`h-2 rounded-full transition-all duration-500 ${summary.budget_status.percentage > 90 ? "bg-red-500" : summary.budget_status.percentage > 70 ? "bg-yellow-500" : "bg-green-500"}`}
              style={{ width: `${Math.min(summary.budget_status.percentage, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            You have used {summary.budget_status.percentage.toFixed(1)}% of your monthly budget.
          </p>
        </div>
      ) : null}

      {hasNoResults && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="text-4xl mb-3">🔍</div>
          <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"} mb-2`}>
            No subscriptions found
          </h3>
          <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"} mb-4`}>
            Try adjusting your filters or search term
          </p>
          <button
            onClick={() => {
              setSearchTerm("")
              setFilterEmail("all")
              setFilterType("all")
            }}
            className={`text-sm ${darkMode ? "text-[#FFD166] hover:text-[#FFD166]/80" : "text-blue-600 hover:text-blue-700"}`}
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Subscriptions Grid */}
      {!hasNoResults && (
        <>
          {/* Active Trials Section */}
          <TrialSection
            trials={activeTrials}
            darkMode={darkMode}
            onTrialAction={handleTrialAction}
          />

          {/* AI Tools Section */}
          {filterType !== "other" && aiSubs.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-[#FFD166]" />
                <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                  AI Tools {filterEmail !== "all" && `from ${filterEmail}`}
                </h3>
                <span className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>({aiSubs.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {aiSubs.slice(0, 6).map((sub) => (
                  <div
                    key={sub.id}
                    className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-5 relative group transition-all duration-200 flex flex-col`}
                    onMouseEnter={() => setHoveredCard(sub.id)}
                    onMouseLeave={() => setHoveredCard(null)}
                  >
                    {sub.isTrial && (
                      <div aria-hidden="true" className="absolute top-3 right-3 bg-[#007A5C] text-white text-xs px-2 py-1 rounded-full font-semibold">
                        Trial
                      </div>
                    )}

                    {sub.priceChange && (
                      <div aria-hidden="true" className="absolute top-3 right-3 bg-[#E86A33] text-white text-xs px-2 py-1 rounded-full font-semibold">
                        Price ↑
                      </div>
                    )}

                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          aria-hidden="true"
                          className={`w-12 h-12 ${darkMode ? "bg-[#1E2A35]" : "bg-[#1E2A35]"} rounded-lg flex items-center justify-center text-2xl flex-shrink-0`}
                        >
                          {sub.icon}
                        </div>
                        <div>
                          <h4 className={`font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>{sub.name}</h4>
                          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{sub.category}</p>
                          {sub.email && (
                            <div className="flex items-center gap-1 mt-1">
                              <Mail aria-hidden="true" className={`w-3 h-3 ${darkMode ? "text-gray-500" : "text-gray-400"}`} />
                              <p className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-400"}`}>{sub.email}</p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p
                          className={`font-bold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}
                          title={
                            sub.currency && sub.currency !== dc && rates[sub.currency]
                              ? `${formatCurrency(sub.price, sub.currency || "USD")} = ${formatCurrency(convertPrice(sub.price, sub.currency), dc)}`
                              : undefined
                          }
                        >
                          {formatCurrency(sub.price, sub.currency || "USD")}
                        </p>
                        <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>/Month</p>
                      </div>
                    </div>

                    <div className="flex-1 space-y-3 mb-3">
                      {sub.hasApiKey && sub.lastUsedAt && (
                        <div className={`p-2 ${darkMode ? "bg-[#1E2A35]" : "bg-gray-50"} rounded-lg`}>
                          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-600"} mb-1`}>
                            Usage Insights
                          </p>
                          <div className="flex items-center justify-between">
                            <span className={`text-xs ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                              Last used: {Math.floor((new Date().getTime() - new Date(sub.lastUsedAt).getTime()) / (1000 * 60 * 60 * 24))} days ago
                            </span>
                            <span className={`text-xs font-semibold ${darkMode ? "text-[#007A5C]" : "text-green-600"}`}>
                              Active
                            </span>
                          </div>
                        </div>
                      )}

                      {!sub.hasApiKey && (
                        <div className={`p-2 ${darkMode ? "bg-[#FFD166]/10" : "bg-yellow-50"} rounded-lg`}>
                          <p className={`text-xs ${darkMode ? "text-[#FFD166]" : "text-yellow-700"}`}>
                            Connect API key for usage tracking
                          </p>
                        </div>
                      )}

                      {sub.isTrial && sub.trialEndsAt && (
                        <div className="p-2 bg-[#007A5C]/10 rounded-lg">
                          <p className={`text-xs ${darkMode ? "text-[#007A5C]" : "text-green-700"}`}>
                            Trial ends in {Math.ceil((new Date(sub.trialEndsAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days - $
                            {sub.priceAfterTrial}/month after
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-auto">
                      <div className="mb-3">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span
                            className={
                              sub.status === "expiring"
                                ? "text-[#E86A33]"
                                : darkMode
                                  ? "text-gray-400"
                                  : "text-gray-600"
                            }
                          >
                            {sub.status === "expiring"
                              ? `Expires in ${sub.renewsIn} days`
                              : sub.status === "trial"
                                ? "Trial period"
                                : `Renewal in ${sub.renewsIn} days`}
                          </span>
                          <span
                            className={
                              sub.status === "expiring"
                                ? "text-[#E86A33] font-semibold"
                                : sub.status === "trial"
                                  ? "text-[#007A5C] font-semibold"
                                  : "text-[#007A5C] font-semibold"
                            }
                          >
                            {sub.status === "expiring" ? "Expiring" : sub.status === "trial" ? "Trial" : "Active"}
                          </span>
                        </div>
                        <div className={`w-full ${darkMode ? "bg-[#374151]" : "bg-gray-200"} rounded-full h-1`}>
                          <div
                            aria-hidden="true"
                            className={`h-1 rounded-full ${sub.status === "expiring" ? "bg-[#E86A33]" : sub.status === "trial" ? "bg-[#007A5C]" : "bg-[#007A5C]"}`}
                            style={{ width: "75%" }}
                          ></div>
                        </div>
                      </div>

                      <button
                        onClick={() => (sub.status === "expiring" ? onRenew(sub) : onManage(sub))}
                        aria-label={sub.status === "expiring" ? `Renew ${sub.name}` : `Manage ${sub.name} subscription`}
                        className={`w-full py-2 rounded-lg text-sm font-medium transition-all duration-200 opacity-0 group-hover:opacity-100 focus:opacity-100 ${
                          sub.status === "expiring"
                            ? darkMode
                              ? "bg-[#E86A33]/20 text-[#E86A33] hover:bg-[#E86A33]/30"
                              : "bg-orange-50 text-orange-700 hover:bg-orange-100"
                            : darkMode
                              ? "bg-[#374151] text-gray-300 hover:bg-[#4B5563]"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {sub.status === "expiring" ? "Renew now" : "Manage subscription"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Other Services Section */}
          {filterType !== "ai" && otherSubs.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Package className="w-5 h-5 text-[#E86A33]" />
                <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                  Other Services {filterEmail !== "all" && `from ${filterEmail}`}
                </h3>
                <span className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>({otherSubs.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {otherSubs.slice(0, 6).map((sub) => (
                  <div
                    key={sub.id}
                    className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-5 relative group transition-all duration-200 flex flex-col`}
                    onMouseEnter={() => setHoveredCard(sub.id)}
                    onMouseLeave={() => setHoveredCard(null)}
                  >
                    {sub.isTrial && (
                      <div aria-hidden="true" className="absolute top-3 right-3 bg-[#007A5C] text-white text-xs px-2 py-1 rounded-full font-semibold">
                        Trial
                      </div>
                    )}

                    {sub.priceChange && (
                      <div aria-hidden="true" className="absolute top-3 right-3 bg-[#E86A33] text-white text-xs px-2 py-1 rounded-full font-semibold">
                        Price ↑
                      </div>
                    )}

                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          aria-hidden="true"
                          className={`w-12 h-12 ${darkMode ? "bg-[#1E2A35]" : "bg-[#1E2A35]"} rounded-lg flex items-center justify-center text-2xl flex-shrink-0`}
                        >
                          {sub.icon}
                        </div>
                        <div>
                          <h4 className={`font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>{sub.name}</h4>
                          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{sub.category}</p>
                          {sub.email && (
                            <div className="flex items-center gap-1 mt-1">
                              <Mail aria-hidden="true" className={`w-3 h-3 ${darkMode ? "text-gray-500" : "text-gray-400"}`} />
                              <p className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-400"}`}>{sub.email}</p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p
                          className={`font-bold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}
                          title={
                            sub.currency && sub.currency !== dc && rates[sub.currency]
                              ? `${formatCurrency(sub.price, sub.currency || "USD")} = ${formatCurrency(convertPrice(sub.price, sub.currency), dc)}`
                              : undefined
                          }
                        >
                          {formatCurrency(sub.price, sub.currency || "USD")}
                        </p>
                        <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>/Month</p>
                      </div>
                    </div>

                    <div className="flex-1 space-y-3 mb-3">
                      {sub.isTrial && sub.trialEndsAt && (
                        <div className="p-2 bg-[#007A5C]/10 rounded-lg">
                          <p className={`text-xs ${darkMode ? "text-[#007A5C]" : "text-green-700"}`}>
                            Trial ends in {Math.ceil((new Date(sub.trialEndsAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days - $
                            {sub.priceAfterTrial}/month after
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-auto">
                      <div className="mb-3">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span
                            className={
                              sub.status === "expiring"
                                ? "text-[#E86A33]"
                                : darkMode
                                  ? "text-gray-400"
                                  : "text-gray-600"
                            }
                          >
                            {sub.status === "expiring"
                              ? `Expires in ${sub.renewsIn} days`
                              : sub.status === "trial"
                                ? "Trial period"
                                : `Renewal in ${sub.renewsIn} days`}
                          </span>
                          <span
                            className={
                              sub.status === "expiring"
                                ? "text-[#E86A33] font-semibold"
                                : sub.status === "trial"
                                  ? "text-[#007A5C] font-semibold"
                                  : "text-[#007A5C] font-semibold"
                            }
                          >
                            {sub.status === "expiring" ? "Expiring" : sub.status === "trial" ? "Trial" : "Active"}
                          </span>
                        </div>
                        <div className={`w-full ${darkMode ? "bg-[#374151]" : "bg-gray-200"} rounded-full h-1`}>
                          <div
                            aria-hidden="true"
                            className={`h-1 rounded-full ${sub.status === "expiring" ? "bg-[#E86A33]" : sub.status === "trial" ? "bg-[#007A5C]" : "bg-[#007A5C]"}`}
                            style={{ width: "75%" }}
                          ></div>
                        </div>
                      </div>

                      <button
                        onClick={() => (sub.status === "expiring" ? onRenew(sub) : onManage(sub))}
                        aria-label={sub.status === "expiring" ? `Renew ${sub.name}` : `Manage ${sub.name} subscription`}
                        className={`w-full py-2 rounded-lg text-sm font-medium transition-all duration-200 opacity-0 group-hover:opacity-100 focus:opacity-100 ${
                          sub.status === "expiring"
                            ? darkMode
                              ? "bg-[#E86A33]/20 text-[#E86A33] hover:bg-[#E86A33]/30"
                              : "bg-orange-50 text-orange-700 hover:bg-orange-100"
                            : darkMode
                              ? "bg-[#374151] text-gray-300 hover:bg-[#4B5563]"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {sub.status === "expiring" ? "Renew now" : "Manage subscription"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
