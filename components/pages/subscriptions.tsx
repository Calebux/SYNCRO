"use client"

import { useState, useEffect } from "react"
import { Edit2, Trash2, Mail, Clock, Copy } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { VirtualizedList } from "@/components/ui/virtualized-list"
import { EmptyState } from "@/components/ui/empty-state"

export default function SubscriptionsPage({
  subscriptions = [],
  onDelete,
  maxSubscriptions,
  currentPlan,
  darkMode,
  onManage,
  onRenew,
  selectedSubscriptions,
  onToggleSelect,
  emailAccounts = [],
  duplicates = [],
  unusedSubscriptions = [],
}) {
  const [searchTerm, setSearchTerm] = useState("")
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [isSearching, setIsSearching] = useState(false)
  const [filterCategory, setFilterCategory] = useState("all")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterEmail, setFilterEmail] = useState("all")
  const [sortBy, setSortBy] = useState("name")
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false)
  const [showUnusedOnly, setShowUnusedOnly] = useState(false)

  const emailAccountsList = ["all", ...new Set((subscriptions || []).map((s) => s.email).filter(Boolean))]
  const categories = ["all", ...new Set((subscriptions || []).map((s) => s.category))]
  const statuses = ["all", "active", "trial", "expiring", "expired"]

  useEffect(() => {
    if (searchTerm !== debouncedSearchTerm) {
      setIsSearching(true)
    } else {
      setIsSearching(false)
    }
  }, [searchTerm, debouncedSearchTerm])

  const filtered = (subscriptions || []).filter((sub) => {
    const matchesSearch = sub.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
    const matchesCategory = filterCategory === "all" || sub.category === filterCategory
    const matchesStatus = filterStatus === "all" || sub.status === filterStatus
    const matchesEmail = filterEmail === "all" || sub.email === filterEmail

    if (showDuplicatesOnly) {
      const isDuplicate = (duplicates || []).some((dup) => dup.subscriptions.some((s) => s.id === sub.id))
      return matchesSearch && matchesCategory && matchesStatus && matchesEmail && isDuplicate
    }

    if (showUnusedOnly) {
      const isUnused = (unusedSubscriptions || []).some((unused) => unused.id === sub.id)
      return matchesSearch && matchesCategory && matchesStatus && matchesEmail && isUnused
    }

    return matchesSearch && matchesCategory && matchesStatus && matchesEmail
  })

  if (sortBy === "price-high") {
    filtered.sort((a, b) => b.price - a.price)
  } else if (sortBy === "price-low") {
    filtered.sort((a, b) => a.price - b.price)
  } else if (sortBy === "renewal") {
    filtered.sort((a, b) => a.renewsIn - b.renewsIn)
  } else {
    filtered.sort((a, b) => a.name.localeCompare(b.name))
  }

  const totalCost = filtered.reduce((sum, sub) => sum + sub.price, 0)

  const hasNoSubscriptions = !subscriptions || subscriptions.length === 0
  const hasNoResults = filtered.length === 0 && subscriptions && subscriptions.length > 0

  if (hasNoSubscriptions) {
    return (
      <EmptyState
        icon="📦"
        title="No subscriptions yet"
        description="Start tracking your subscriptions by connecting your email or adding them manually."
        action={{
          label: "Add your first subscription",
          onClick: () => {},
        }}
        darkMode={darkMode}
      />
    )
  }

  const shouldVirtualize = filtered.length > 100

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div
          className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-6`}
        >
          <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} text-sm mb-2`}>Total subscriptions</p>
          <h3 className={`text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>{subscriptions.length}</h3>
          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-600"} mt-2`}>
            {maxSubscriptions - subscriptions.length} slots available
          </p>
        </div>
        <div
          className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-6`}
        >
          <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} text-sm mb-2`}>Monthly Cost</p>
          <h3 className={`text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>${totalCost}</h3>
          <p className={`text-xs ${darkMode ? "text-[#E86A33]" : "text-red-600"} mt-2`}>-$35 last month</p>
        </div>
        <div
          className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-6`}
        >
          <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} text-sm mb-2`}>Yearly Cost</p>
          <h3 className={`text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
            ${(totalCost * 12).toFixed(0)}
          </h3>
          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-600"} mt-2`}>Projected</p>
        </div>
        <div
          className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-6`}
        >
          <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} text-sm mb-2`}>Renewal Due</p>
          <h3 className={`text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
            {subscriptions.filter((s) => s.status === "expiring").length}
          </h3>
          <p className={`text-xs ${darkMode ? "text-[#E86A33]" : "text-orange-600"} mt-2`}>Next 7 days</p>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {duplicates.length > 0 && (
          <button
            onClick={() => {
              setShowDuplicatesOnly(!showDuplicatesOnly)
              setShowUnusedOnly(false)
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showDuplicatesOnly
                ? "bg-[#FFD166] text-[#1E2A35]"
                : darkMode
                  ? "bg-[#2D3748] text-gray-400 hover:text-white"
                  : "bg-gray-100 text-gray-600 hover:text-gray-900"
            }`}
          >
            <Copy className="w-4 h-4" />
            Duplicates ({duplicates.reduce((sum, d) => sum + d.count, 0)})
          </button>
        )}
        {unusedSubscriptions.length > 0 && (
          <button
            onClick={() => {
              setShowUnusedOnly(!showUnusedOnly)
              setShowDuplicatesOnly(false)
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              showUnusedOnly
                ? "bg-[#FFD166] text-[#1E2A35]"
                : darkMode
                  ? "bg-[#2D3748] text-gray-400 hover:text-white"
                  : "bg-gray-100 text-gray-600 hover:text-gray-900"
            }`}
          >
            <Clock className="w-4 h-4" />
            Unused ({unusedSubscriptions.length})
          </button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="mb-6 flex gap-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search subscriptions"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
              darkMode
                ? "bg-[#2D3748] border-[#374151] text-white placeholder-gray-500 focus:ring-[#FFD166]"
                : "bg-white border-gray-300 text-gray-900 focus:ring-black"
            }`}
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#FFD166]"></div>
            </div>
          )}
        </div>
        <select
          value={filterEmail}
          onChange={(e) => setFilterEmail(e.target.value)}
          className={`px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
            darkMode
              ? "bg-[#2D3748] border-[#374151] text-white focus:ring-[#FFD166]"
              : "bg-white border-gray-300 text-gray-900 focus:ring-black"
          }`}
        >
          {emailAccountsList.map((email) => (
            <option key={email} value={email}>
              {email === "all" ? "All Emails" : email}
            </option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className={`px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
            darkMode
              ? "bg-[#2D3748] border-[#374151] text-white focus:ring-[#FFD166]"
              : "bg-white border-gray-300 text-gray-900 focus:ring-black"
          }`}
        >
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat === "all" ? "All Categories" : cat}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className={`px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
            darkMode
              ? "bg-[#2D3748] border-[#374151] text-white focus:ring-[#FFD166]"
              : "bg-white border-gray-300 text-gray-900 focus:ring-black"
          }`}
        >
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? "All Status" : status.charAt(0).toUpperCase() + status.slice(1)}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className={`px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
            darkMode
              ? "bg-[#2D3748] border-[#374151] text-white focus:ring-[#FFD166]"
              : "bg-white border-gray-300 text-gray-900 focus:ring-black"
          }`}
        >
          <option value="name">Sort by Name</option>
          <option value="price-high">Price: High to Low</option>
          <option value="price-low">Price: Low to High</option>
          <option value="renewal">Renewal Soon</option>
        </select>
      </div>

      {/* Subscriptions List */}
      {!hasNoResults && (
        <>
          {shouldVirtualize ? (
            <VirtualizedList
              items={filtered}
              itemHeight={80}
              containerHeight={600}
              renderItem={(sub, index) => (
                <SubscriptionCard
                  key={sub.id}
                  subscription={sub}
                  onDelete={onDelete}
                  onManage={onManage}
                  selectedSubscriptions={selectedSubscriptions}
                  onToggleSelect={onToggleSelect}
                  darkMode={darkMode}
                  isDuplicate={duplicates.some((dup) => dup.subscriptions.some((s) => s.id === sub.id))}
                  unusedInfo={unusedSubscriptions.find((unused) => unused.id === sub.id)}
                />
              )}
            />
          ) : (
            <div className="space-y-3">
              {filtered.map((sub) => (
                <SubscriptionCard
                  key={sub.id}
                  subscription={sub}
                  onDelete={onDelete}
                  onManage={onManage}
                  selectedSubscriptions={selectedSubscriptions}
                  onToggleSelect={onToggleSelect}
                  darkMode={darkMode}
                  isDuplicate={duplicates.some((dup) => dup.subscriptions.some((s) => s.id === sub.id))}
                  unusedInfo={unusedSubscriptions.find((unused) => unused.id === sub.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {hasNoResults && (
        <EmptyState
          icon="🔍"
          title="No subscriptions found"
          description="Try adjusting your filters or search term to find what you're looking for."
          action={{
            label: "Clear all filters",
            onClick: () => {
              setSearchTerm("")
              setFilterEmail("all")
              setFilterCategory("all")
              setFilterStatus("all")
              setShowDuplicatesOnly(false)
              setShowUnusedOnly(false)
            },
          }}
          darkMode={darkMode}
        />
      )}
    </div>
  )
}

function SubscriptionCard({
  subscription: sub,
  onDelete,
  onManage,
  selectedSubscriptions,
  onToggleSelect,
  darkMode,
  isDuplicate,
  unusedInfo,
}) {
  return (
    <div
      className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-5 flex items-center justify-between`}
    >
      <div className="flex items-center gap-4 flex-1">
        {selectedSubscriptions && onToggleSelect && (
          <input
            type="checkbox"
            checked={selectedSubscriptions.has(sub.id)}
            onChange={() => onToggleSelect(sub.id)}
            className="w-4 h-4 rounded"
          />
        )}
        <div
          className={`w-12 h-12 ${darkMode ? "bg-[#1E2A35]" : "bg-black"} rounded-lg flex items-center justify-center text-2xl`}
        >
          {sub.icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{sub.name}</h4>
            {sub.isTrial && (
              <span className="bg-[#007A5C] text-white text-xs px-2 py-0.5 rounded-full font-semibold">Trial</span>
            )}
            {isDuplicate && (
              <span className="bg-[#FFD166] text-[#1E2A35] text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <Copy className="w-3 h-3" />
                Duplicate
              </span>
            )}
            {unusedInfo && sub.category === "AI Tools" && sub.hasApiKey && (
              <span className="bg-[#E86A33] text-white text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Unused {unusedInfo.daysSinceLastUse}d
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{sub.category}</p>
            {sub.email && (
              <>
                <span className={`text-xs ${darkMode ? "text-gray-600" : "text-gray-300"}`}>•</span>
                <div className="flex items-center gap-1">
                  <Mail className={`w-3 h-3 ${darkMode ? "text-gray-500" : "text-gray-400"}`} />
                  <p className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-400"}`}>{sub.email}</p>
                </div>
              </>
            )}
          </div>
          {sub.isTrial && sub.trialEndsAt && (
            <p className={`text-xs ${darkMode ? "text-[#007A5C]" : "text-green-600"} mt-1`}>
              Trial ends in {Math.ceil((sub.trialEndsAt - new Date()) / (1000 * 60 * 60 * 24))} days - $
              {sub.priceAfterTrial}/month after
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-8">
        <div className="text-right">
          <p className={`font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>${sub.price}</p>
          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>/Month</p>
        </div>

        <div className="text-right min-w-32">
          <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
            {sub.status === "expiring" ? `Expires in ${sub.renewsIn} days` : `Renewal in ${sub.renewsIn} days`}
          </p>
          <span className={`text-xs font-semibold ${sub.status === "expiring" ? "text-[#E86A33]" : "text-[#007A5C]"}`}>
            {sub.status === "expiring" ? "Expiring" : "Active"}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onManage && onManage(sub)}
            className={`p-2 rounded-lg ${darkMode ? "hover:bg-[#374151] text-gray-400" : "hover:bg-gray-100 text-gray-600"}`}
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(sub.id)}
            className={`p-2 rounded-lg ${darkMode ? "hover:bg-[#E86A33]/20 text-[#E86A33]" : "hover:bg-red-50 text-red-600"}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
