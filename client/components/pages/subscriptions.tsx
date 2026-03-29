"use client"

import { useState, useEffect, useRef } from "react"
import { Edit2, Trash2, Mail, Clock, Copy, Lock, Users, Calendar, Check, Download, FileText, Upload } from "lucide-react"
import { exportAllCSV, exportActiveCSV, exportDateRangeCSV } from "@/lib/csv-export"
import { downloadSubscriptionPDF } from "@/lib/pdf-report"
import CSVImportModal from "@/components/modals/csv-import-modal"

import { useDebounce } from "@/hooks/use-debounce"
import { VirtualizedList } from "@/components/ui/virtualized-list"
import { EmptyState } from "@/components/ui/empty-state"
import CancellationGuideModal from "@/components/modals/cancellation-guide-modal"
import { fetchAllCancellationGuides, type CancellationGuide } from "@/lib/supabase/cancellation-guides"

interface SubscriptionsPageProps {
  subscriptions?: any[]
  onDelete: (id: number) => void
  maxSubscriptions: number
  currentPlan: string
  darkMode?: boolean
  onManage: (subscription: any) => void
  onRenew: (subscription: any) => void
  selectedSubscriptions: Set<number>
  onToggleSelect: (id: number) => void
  emailAccounts?: any[]
  duplicates?: any[]
  unusedSubscriptions?: any[]
  onImportComplete?: () => void
}

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
  onImportComplete,
}: SubscriptionsPageProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [isSearching, setIsSearching] = useState(false)
  const [filterCategory, setFilterCategory] = useState("all")
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterEmail, setFilterEmail] = useState("all")
  const [sortBy, setSortBy] = useState("name")
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false)
  const [showUnusedOnly, setShowUnusedOnly] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exportingPDF, setExportingPDF] = useState(false)
  const [showCSVImport, setShowCSVImport] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleExportPDF = async () => {
    setShowExportMenu(false)
    setExportingPDF(true)
    try {
      await downloadSubscriptionPDF(filtered)
    } finally {
      setExportingPDF(false)
    }
  }

  const [guides, setGuides] = useState<CancellationGuide[]>([])
  const [selectedSubForCancel, setSelectedSubForCancel] = useState<any | null>(null)

  useEffect(() => {
    async function loadGuides() {
      try {
        const data = await fetchAllCancellationGuides()
        setGuides(data)
      } catch (error) {
        console.error("Failed to load all cancellation guides:", error)
      }
    }
    loadGuides()
  }, [])

  const [calendarToken, setCalendarToken] = useState<string | null>(null)
  const [calendarUserId, setCalendarUserId] = useState<string | null>(null)
  const [showCalendarModal, setShowCalendarModal] = useState(false)
  const [copied, setCopied] = useState(false)

  const emailAccountsList = ["all", ...new Set((subscriptions || []).map((s: any) => s.email).filter(Boolean))]
  const categories = ["all", ...new Set((subscriptions || []).map((s: any) => s.category))]
  const statuses = ["all", "active", "trial", "expiring", "expired"]

  useEffect(() => {
    if (searchTerm !== debouncedSearchTerm) {
      setIsSearching(true)
    } else {
      setIsSearching(false)
    }
  }, [searchTerm, debouncedSearchTerm])

  const fetchCalendarToken = async () => {
    try {
      const response = await fetch("/api/calendar/token")
      const data = await response.json()
      if (data.success) {
        setCalendarToken(data.token)
        setCalendarUserId(data.userId)
        setShowCalendarModal(true)
      }
    } catch (error) {
      console.error("Failed to fetch calendar token", error)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filtered = (subscriptions || []).filter((sub: any) => {
    const matchesSearch = sub.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
    const matchesCategory = filterCategory === "all" || sub.category === filterCategory
    const matchesStatus = filterStatus === "all" || sub.status === filterStatus
    const matchesEmail = filterEmail === "all" || sub.email === filterEmail

    if (showDuplicatesOnly) {
      const isDuplicate = (duplicates || []).some((dup: any) => dup.subscriptions.some((s: any) => s.id === sub.id))
      return matchesSearch && matchesCategory && matchesStatus && matchesEmail && isDuplicate
    }

    if (showUnusedOnly) {
      const isUnused = (unusedSubscriptions || []).some((unused: any) => unused.id === sub.id)
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

  const totalCost = filtered.reduce((sum: number, sub: any) => sum + sub.price, 0)

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
            {subscriptions.filter((s: any) => s.status === "expiring").length}
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
        <button
          onClick={fetchCalendarToken}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            darkMode ? "bg-[#2D3748] text-gray-400 hover:text-white" : "bg-gray-100 text-gray-600 hover:text-gray-900"
          }`}
        >
          <Calendar className="w-4 h-4" />
          Sync to Calendar
        </button>

        {/* Export dropdown */}
        <div className="relative" ref={exportMenuRef}>
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={exportingPDF}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              darkMode ? "bg-[#2D3748] text-gray-400 hover:text-white" : "bg-gray-100 text-gray-600 hover:text-gray-900"
            }`}
          >
            <Download className="w-4 h-4" />
            {exportingPDF ? "Generating…" : "Export"}
          </button>

          {showExportMenu && (
            <div
              className={`absolute left-0 top-full mt-1 w-56 rounded-lg border shadow-lg z-50 ${
                darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"
              }`}
            >
              <p className={`px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
                CSV
              </p>
              <button
                onClick={() => { exportAllCSV(filtered); setShowExportMenu(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  darkMode ? "text-gray-300 hover:bg-[#374151]" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                Export current view
              </button>
              <button
                onClick={() => { exportActiveCSV(subscriptions); setShowExportMenu(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  darkMode ? "text-gray-300 hover:bg-[#374151]" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                Active subscriptions only
              </button>
              <button
                onClick={() => {
                  const now = new Date()
                  const endOfYear = new Date(now.getFullYear(), 11, 31)
                  exportDateRangeCSV(subscriptions, now, endOfYear)
                  setShowExportMenu(false)
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  darkMode ? "text-gray-300 hover:bg-[#374151]" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                Renewals this year
              </button>

              <hr className={`my-1 ${darkMode ? "border-[#374151]" : "border-gray-100"}`} />

              <p className={`px-3 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
                PDF
              </p>
              <button
                onClick={handleExportPDF}
                className={`w-full flex items-center gap-2 px-3 py-2 pb-3 text-sm text-left transition-colors rounded-b-lg ${
                  darkMode ? "text-gray-300 hover:bg-[#374151]" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Full subscription report
              </button>
            </div>
          )}
        </div>

        {/* Import CSV */}
        <button
          onClick={() => setShowCSVImport(true)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            darkMode ? "bg-[#2D3748] text-gray-400 hover:text-white" : "bg-gray-100 text-gray-600 hover:text-gray-900"
          }`}
        >
          <Upload className="w-4 h-4" />
          Import CSV
        </button>
      </div>

      {/* Search and Filters */}
      <div className="mb-6 flex gap-4">
        <div className="relative flex-1">
          <label htmlFor="subscriptions-search" className="sr-only">Search subscriptions</label>
          <input
            id="subscriptions-search"
            type="search"
            placeholder="Search subscriptions"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search subscriptions"
            className={`w-full px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
              darkMode
                ? "bg-[#2D3748] border-[#374151] text-white placeholder-gray-500 focus:ring-[#FFD166]"
                : "bg-white border-gray-300 text-gray-900 focus:ring-black"
            }`}
          />
          {isSearching && (
            <div aria-hidden="true" className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#FFD166]"></div>
            </div>
          )}
        </div>
        <label htmlFor="filter-email" className="sr-only">Filter by email</label>
        <select
          id="filter-email"
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
        <label htmlFor="filter-category" className="sr-only">Filter by category</label>
        <select
          id="filter-category"
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
        <label htmlFor="filter-status" className="sr-only">Filter by status</label>
        <select
          id="filter-status"
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
        <label htmlFor="sort-by" className="sr-only">Sort subscriptions</label>
        <select
          id="sort-by"
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

      {/* Live region for search result count */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {!isSearching && debouncedSearchTerm
          ? `Showing ${filtered.length} of ${subscriptions.length} subscriptions`
          : ""}
      </div>

      {/* Subscriptions List */}
      {!hasNoResults && (
        <>
          {shouldVirtualize ? (
            <VirtualizedList
              items={filtered}
              itemHeight={80}
              containerHeight={600}
              renderItem={(sub: any, index: number) => (
                <SubscriptionCard
                  key={sub.id}
                  subscription={sub}
                  onDelete={onDelete}
                  onManage={onManage}
                  selectedSubscriptions={selectedSubscriptions}
                  onToggleSelect={onToggleSelect}
                  darkMode={darkMode}
                  isDuplicate={duplicates.some((dup: any) => dup.subscriptions.some((s: any) => s.id === sub.id))}
                  unusedInfo={unusedSubscriptions.find((unused: any) => unused.id === sub.id)}
                />
              )}
            />
          ) : (
            <div className="space-y-3">
              {filtered.map((sub: any) => (
                <SubscriptionCard
                  key={sub.id}
                  subscription={sub}
                  onDelete={onDelete}
                  onManage={onManage}
                  selectedSubscriptions={selectedSubscriptions}
                  onToggleSelect={onToggleSelect}
                  darkMode={darkMode}
                  isDuplicate={duplicates.some((dup: any) => dup.subscriptions.some((s: any) => s.id === sub.id))}
                  unusedInfo={unusedSubscriptions.find((unused: any) => unused.id === sub.id)}
                  onCancel={(s) => setSelectedSubForCancel(s)}
                  guide={guides.find((g) => g.service_name.toLowerCase() === sub.name.toLowerCase())}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showCSVImport && (
        <CSVImportModal
          darkMode={darkMode}
          onClose={() => setShowCSVImport(false)}
          onImportComplete={() => {
            setShowCSVImport(false)
            onImportComplete?.()
          }}
        />
      )}

      {selectedSubForCancel && (
        <CancellationGuideModal
          subscription={selectedSubForCancel}
          darkMode={darkMode}
          onClose={() => setSelectedSubForCancel(null)}
          onCancelled={() => {
            // In a real app, you would refresh the subscription list here
            // For now, we'll just show a success toast or manually update the local state if possible
            // But since subscriptions props are passed down, the parent should handle it.
            // For the sake of this demo, we'll just close it.
            setSelectedSubForCancel(null)
          }}
        />
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
      {showCalendarModal && calendarToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            className={`${darkMode ? "bg-[#1E2A35] text-white" : "bg-white text-gray-900"} rounded-2xl p-8 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-200`}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-blue-100 rounded-xl">
                <Calendar className="w-6 h-6 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold">Sync to Calendar</h2>
            </div>
            <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} mb-6`}>
              Copy this link and add it to your Apple, Google, or Outlook calendar to see your subscription renewal
              dates.
            </p>
            <div className="relative mb-8">
              <input
                readOnly
                value={`${window.location.protocol}//${window.location.host}/api/calendar/feed/${calendarUserId}/${calendarToken}.ics`}
                className={`w-full pr-12 pl-4 py-3 rounded-xl border text-sm ${
                  darkMode ? "bg-[#2D3748] border-[#374151] text-gray-300" : "bg-gray-50 border-gray-200 text-gray-600"
                }`}
              />
              <button
                onClick={() =>
                  copyToClipboard(
                    `${window.location.protocol}//${window.location.host}/api/calendar/feed/${calendarUserId}/${calendarToken}.ics`,
                  )
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-black/5 rounded-lg transition-colors"
              >
                {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-gray-400" />}
              </button>
            </div>
            <button
              onClick={() => setShowCalendarModal(false)}
              className="w-full py-4 bg-[#FFD166] hover:bg-[#F4C542] text-[#1E2A35] font-bold rounded-xl transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 active:translate-y-0"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface SubscriptionCardProps {
  subscription: any
  onDelete: (id: number) => void
  onManage?: (subscription: any) => void
  selectedSubscriptions: Set<number>
  onToggleSelect: (id: number) => void
  darkMode?: boolean
  isDuplicate?: boolean
  unusedInfo?: any
  onCancel?: (subscription: any) => void
  guide?: CancellationGuide
}

export function SubscriptionCard({
  subscription: sub,
  onDelete,
  onManage,
  selectedSubscriptions,
  onToggleSelect,
  darkMode,
  isDuplicate,
  unusedInfo,
  onCancel,
  guide,
}: SubscriptionCardProps) {
  const statusLabel =
    sub.status === "expiring"
      ? `expiring in ${sub.renewsIn} days`
      : sub.status === "trial"
        ? "trial"
        : sub.status === "cancelled"
          ? "cancelled"
          : "active"

  const difficultyColors = {
    easy: "text-green-500 bg-green-500/10",
    medium: "text-yellow-500 bg-yellow-500/10",
    hard: "text-red-500 bg-red-500/10",
  }

  return (
    <div
      className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-5 flex items-center justify-between`}
      aria-label={`${sub.name}, ${sub.category}, $${sub.price}/month, ${statusLabel}${isDuplicate ? ", duplicate" : ""}${unusedInfo ? ", unused" : ""}`}
    >
      <div className="flex items-center gap-4 flex-1">
        {selectedSubscriptions && onToggleSelect && (
          <input
            type="checkbox"
            id={`select-sub-${sub.id}`}
            checked={selectedSubscriptions.has(sub.id)}
            onChange={() => onToggleSelect(sub.id)}
            aria-label={`Select ${sub.name}`}
            className="w-4 h-4 rounded"
          />
        )}
        <div
          aria-hidden="true"
          className={`w-12 h-12 ${darkMode ? "bg-[#1E2A35]" : "bg-black"} rounded-lg flex items-center justify-center text-2xl`}
        >
          {sub.icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{sub.name}</h4>
            {sub.isTrial && (
              <span className="bg-[#007A5C] text-white text-xs px-2 py-0.5 rounded-full font-semibold">
                Trial
              </span>
            )}
            {isDuplicate && (
              <span className="bg-[#FFD166] text-[#1E2A35] text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <Copy aria-hidden="true" className="w-3 h-3" />
                Duplicate
              </span>
            )}
            {unusedInfo && sub.category === "AI Tools" && sub.hasApiKey && (
              <span className="bg-[#E86A33] text-white text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <Clock aria-hidden="true" className="w-3 h-3" />
                Unused {unusedInfo.daysSinceLastUse}d
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{sub.category}</p>
            {sub.email && (
              <>
                <span aria-hidden="true" className={`text-xs ${darkMode ? "text-gray-600" : "text-gray-300"}`}>•</span>
                <div className="flex items-center gap-1">
                  <Mail aria-hidden="true" className={`w-3 h-3 ${darkMode ? "text-gray-500" : "text-gray-400"}`} />
                  <p className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-400"}`}>{sub.email}</p>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {guide && (
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${difficultyColors[guide.difficulty]}`}>
                {guide.difficulty} to cancel
              </span>
            )}
             {sub.status === "cancelled" && (
              <span className="bg-gray-100 dark:bg-[#1E2A35] text-gray-500 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle className="w-2.5 h-2.5" />
                Cancelled
              </span>
            )}
          </div>
          {sub.isTrial && sub.trialEndsAt && (
            <p className={`text-xs ${darkMode ? "text-[#007A5C]" : "text-green-600"} mt-1`}>
              Trial ends in {Math.ceil((new Date(sub.trialEndsAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days - $
              {sub.priceAfterTrial}/month after
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-8">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => onManage && onManage({ ...sub, toggleVisibility: true })}
              className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors ${
                sub.visibility === 'team'
                  ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              title={sub.visibility === 'team' ? "Visible to Team" : "Private"}
            >
              {sub.visibility === 'team' ? <Users className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {sub.visibility === 'team' ? "Team" : "Private"}
            </button>
          </div>

          <div className="text-right min-w-32">
            <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
              {sub.status === "expiring" ? `Expires in ${sub.renewsIn} days` : `Renewal in ${sub.renewsIn} days`}
            </p>
            <span className={`text-xs font-semibold ${sub.status === "expiring" ? "text-[#E86A33]" : "text-[#007A5C]"}`}>
              {sub.status === "expiring" ? "Expiring" : "Active"}
            </span>
          </div>
        </div>

        <div className="text-right">
          <p className={`font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>${sub.price}</p>
          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>/Month</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => onManage && onManage({ ...sub, toggleVisibility: true })}
              className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors ${
                sub.visibility === 'team'
                  ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              title={sub.visibility === 'team' ? "Visible to Team" : "Private"}
            >
              {sub.visibility === 'team' ? <Users className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {sub.visibility === 'team' ? "Team" : "Private"}
            </button>
          </div>

          <div className="text-right min-w-32">
            <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
              {sub.status === "expiring" ? `Expires in ${sub.renewsIn} days` : `Renewal in ${sub.renewsIn} days`}
            </p>
            <span className={`text-xs font-semibold ${sub.status === "expiring" ? "text-[#E86A33]" : "text-[#007A5C]"}`}>
              {sub.status === "expiring" ? "Expiring" : "Active"}
            </span>
          </div>
        </div>

        <div className="flex gap-2" role="group" aria-label={`Actions for ${sub.name}`}>
          <button
            onClick={() => onManage && onManage(sub)}
            aria-label={`Edit ${sub.name}`}
            className={`p-2 rounded-lg ${darkMode ? "hover:bg-[#374151] text-gray-400" : "hover:bg-gray-100 text-gray-600"}`}
          >
            <Edit2 aria-hidden="true" className="w-4 h-4" />
          </button>
          {sub.status !== "cancelled" && (
            <button
              onClick={() => onCancel && onCancel(sub)}
              aria-label={`Cancel ${sub.name}`}
              className={`p-2 rounded-lg ${darkMode ? "hover:bg-red-500/20 text-red-500" : "hover:bg-red-50 text-red-600"} flex items-center gap-1 group`}
            >
              <ShieldAlert aria-hidden="true" className="w-4 h-4" />
              <span className="text-xs font-semibold hidden group-hover:inline">Cancel</span>
            </button>
          )}
          <button
            onClick={() => onDelete(sub.id)}
            aria-label={`Delete ${sub.name}`}
            className={`p-2 rounded-lg ${darkMode ? "hover:bg-[#E86A33]/20 text-[#E86A33]" : "hover:bg-red-50 text-red-600"}`}
          >
            <Trash2 aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
