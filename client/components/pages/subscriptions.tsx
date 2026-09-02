"use client"

import { useState, useEffect, useRef } from "react"
import { Edit2, Trash2, Mail, Clock, Copy, Lock, LockOpen, Users, Calendar, Check, Download, FileText, Upload, PauseCircle, PlayCircle, ShieldAlert, AlertCircle } from "lucide-react"
import { exportAllCSV, exportActiveCSV, exportDateRangeCSV } from "@/lib/csv-export"
import CSVImportModal from "@/components/modals/csv-import-modal"

import { useDebounce } from "@/hooks/use-debounce"
import { VirtualizedList } from "@syncro/ui"
import { EmptyState } from "@syncro/ui"
import { ErrorBoundary } from "@syncro/ui"
import CancellationGuideModal from "@/components/modals/cancellation-guide-modal"
import { fetchAllCancellationGuides, type CancellationGuide } from "@/lib/supabase/cancellation-guides"
import { StatusBadge, normalizeStatus } from "@syncro/ui"
import { AdvancedFilterBar, type FilterState, EMPTY_FILTERS, hasActiveFilters } from "@syncro/ui"
import { KeyboardHelpModal } from "@/components/modals/keyboard-help-modal"
import { useUserSettings } from "@/components/providers/user-settings-provider"
import { formatCurrency } from "@/lib/currency-utils"
import { formatDate, getDaysDifference } from "@/lib/timezone-utils"
import { fetchCalendarToken as getCalendarToken, downloadCalendarExport, getCalendarFeedUrl, updateCalendarPreferences } from "@/lib/api/calendar"
import { SortableSubscriptionList } from "@/components/subscriptions/sortable-subscription-list"
import {
  PriorityBadge,
  SortableDragHandle,
  SortableItemShell,
} from "@/components/subscriptions/subscription-priority-ui"
import { useSubscriptionPriorityOrder } from "@/hooks/use-subscription-priority-order"
import {
  getGlobalPriorityRank,
  sortByPriorityOrder,
  type PriorityRank,
} from "@/lib/subscription-priority-order"
import type { CSSProperties, ReactNode } from "react"

interface SubscriptionsPageProps {
  subscriptions?: any[]
  onDelete: (id: string) => void
  maxSubscriptions: number
  currentPlan: string
  darkMode?: boolean
  onManage: (subscription: any) => void
  onRenew: (subscription: any) => void
  selectedSubscriptions: Set<string>
  onToggleSelect: (id: string) => void
  emailAccounts?: any[]
  duplicates?: any[]
  unusedSubscriptions?: any[]
  onImportComplete?: () => void
  onPause?: (subscription: any) => void
  onResume?: (subscription: any) => void
  onCancelTrial?: (id: string) => void
  onConvertTrial?: (id: string) => void
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
  onPause,
  onResume,
  onCancelTrial,
  onConvertTrial,
}: SubscriptionsPageProps) {
  const { settings } = useUserSettings()
  const currency = settings.currency
  const [searchTerm, setSearchTerm] = useState("")
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [isSearching, setIsSearching] = useState(false)
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [filterEmail, setFilterEmail] = useState("all")
  const [sortBy, setSortBy] = useState("priority")
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
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

  // '?' opens keyboard help modal (only when not typing in an input)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "?") {
        e.preventDefault()
        setShowKeyboardHelp((v) => !v)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const handleExportPDF = async () => {
    setShowExportMenu(false)
    setExportingPDF(true)
    try {
      const { downloadSubscriptionPDF } = await import("@/lib/pdf-report")
      await downloadSubscriptionPDF(displayed)
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
  const [calendarFeedUrl, setCalendarFeedUrl] = useState<string | null>(null)
  const [showCalendarModal, setShowCalendarModal] = useState(false)
  const [exportingCalendar, setExportingCalendar] = useState(false)
  const [copied, setCopied] = useState(false)

  const emailAccountsList = ["all", ...new Set((subscriptions || []).map((s: any) => s.email).filter(Boolean))]
  const categories = ["all", ...new Set((subscriptions || []).map((s: any) => s.category))]
  const statuses = ["all", "active", "paused", "trial", "expiring", "expired"]

  useEffect(() => {
    if (searchTerm !== debouncedSearchTerm) {
      setIsSearching(true)
    } else {
      setIsSearching(false)
    }
  }, [searchTerm, debouncedSearchTerm])

  const fetchCalendarToken = async () => {
    try {
      await updateCalendarPreferences({ calendar_sync_enabled: true })
      const data = await getCalendarToken()
      setCalendarToken(data.token)
      setCalendarFeedUrl(data.feedUrl || getCalendarFeedUrl(data.userId, data.token))
      setShowCalendarModal(true)
    } catch (error) {
      console.error("Failed to fetch calendar token", error)
    }
  }

  const handleExportCalendar = async () => {
    setExportingCalendar(true)
    try {
      await updateCalendarPreferences({ calendar_sync_enabled: true })
      await downloadCalendarExport()
      setShowExportMenu(false)
    } catch (error) {
      console.error("Failed to export calendar reminders", error)
    } finally {
      setExportingCalendar(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const subscriptionIds = (subscriptions || []).map((sub: any) => sub.id)
  const {
    priorityOrder,
    isLoading: priorityOrderLoading,
    isSaving: priorityOrderSaving,
    reorder: reorderPriority,
  } = useSubscriptionPriorityOrder({ subscriptionIds })

  const filtered = (subscriptions || []).filter((sub: any) => {
    const matchesSearch = sub.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
    const matchesCategory =
      advancedFilters.categories.length === 0 || advancedFilters.categories.includes(sub.category)
    const matchesStatus =
      advancedFilters.statuses.length === 0 || advancedFilters.statuses.includes(sub.status)
    const matchesEmail = filterEmail === "all" || sub.email === filterEmail
    const matchesPrice =
      advancedFilters.priceRange === null ||
      (sub.price >= advancedFilters.priceRange[0] && sub.price < advancedFilters.priceRange[1])

    if (showDuplicatesOnly) {
      const isDuplicate = (duplicates || []).some((dup: any) => dup.subscriptions.some((s: any) => s.id === sub.id))
      return matchesSearch && matchesCategory && matchesStatus && matchesEmail && matchesPrice && isDuplicate
    }

    if (showUnusedOnly) {
      const isUnused = (unusedSubscriptions || []).some((unused: any) => unused.id === sub.id)
      return matchesSearch && matchesCategory && matchesStatus && matchesEmail && matchesPrice && isUnused
    }

    return matchesSearch && matchesCategory && matchesStatus && matchesEmail && matchesPrice
  })

  let displayed = filtered
  if (sortBy === "priority") {
    displayed = sortByPriorityOrder(filtered, priorityOrder)
  } else if (sortBy === "price-high") {
    displayed = [...filtered].sort((a, b) => b.price - a.price)
  } else if (sortBy === "price-low") {
    displayed = [...filtered].sort((a, b) => a.price - b.price)
  } else if (sortBy === "renewal") {
    displayed = [...filtered].sort((a, b) => a.renewsIn - b.renewsIn)
  } else {
    displayed = [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }

  const totalCost = displayed.reduce((sum: number, sub: any) => sum + sub.price, 0)

  const hasNoSubscriptions = !subscriptions || subscriptions.length === 0
  const hasNoResults = displayed.length === 0 && subscriptions && subscriptions.length > 0

  // Active trials sorted by urgency (soonest expiry first)
  const activeTrials = (subscriptions || [])
    .filter((s: any) => s.isTrial && s.trialEndsAt)
    .sort((a: any, b: any) => new Date(a.trialEndsAt).getTime() - new Date(b.trialEndsAt).getTime())

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

  const shouldVirtualize = displayed.length > 100 && sortBy !== "priority"
  const isPrioritySort = sortBy === "priority"
  const filteredIds = displayed.map((sub: any) => sub.id)

  const renderSubscriptionCard = (sub: any, options?: { priorityRank?: PriorityRank; dragHandle?: ReactNode; shellStyle?: CSSProperties; shellRef?: (node: HTMLElement | null) => void; isDragging?: boolean }) => (
    <ErrorBoundary
      fallback={<BrokenCardPlaceholder name={sub?.name} darkMode={darkMode} />}
    >
      <div
        ref={options?.shellRef}
        style={options?.shellStyle}
        className={`transition-shadow duration-200 ${options?.isDragging ? "shadow-xl ring-2 ring-[#FFD166]/40 rounded-xl" : ""}`}
      >
        <SubscriptionCard
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
          onPause={onPause}
          onResume={onResume}
          onCancelTrial={onCancelTrial}
          onConvertTrial={onConvertTrial}
          priorityRank={options?.priorityRank}
          dragHandle={options?.dragHandle}
        />
      </div>
    </ErrorBoundary>
  )

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
            Potentially Wasted ({unusedSubscriptions.length})
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
                onClick={() => { exportAllCSV(displayed); setShowExportMenu(false) }}
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
                Calendar
              </p>
              <button
                onClick={handleExportCalendar}
                disabled={exportingCalendar}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  darkMode ? "text-gray-300 hover:bg-[#374151]" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                {exportingCalendar ? "Exporting…" : "Export reminders (.ics)"}
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
      <div className="mb-4 flex gap-4">
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
          <option value="priority">Personal Priority</option>
          <option value="name">Sort by Name</option>
          <option value="price-high">Price: High to Low</option>
          <option value="price-low">Price: Low to High</option>
          <option value="renewal">Renewal Soon</option>
        </select>
      </div>

      {/* Advanced filter bar */}
      <div className="mb-6">
        <AdvancedFilterBar
          filters={advancedFilters}
          onChange={setAdvancedFilters}
          availableCategories={categories}
          darkMode={darkMode}
        />
      </div>

      {isPrioritySort && !hasNoResults && (
        <p className={`mb-3 text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
          Drag cards to set your personal priority. Top 3 subscriptions are highlighted.
          {priorityOrderSaving ? " Saving order…" : null}
        </p>
      )}

      {/* Live region for search result count */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {!isSearching && debouncedSearchTerm
          ? `Showing ${displayed.length} of ${subscriptions.length} subscriptions`
          : isPrioritySort && priorityOrderSaving
            ? "Saving subscription priority order"
            : ""}
      </div>

      {/* Active Trials Section */}
      {activeTrials.length > 0 && (
        <div className="mb-8">
          <h3 className={`text-lg font-bold mb-3 flex items-center gap-2 ${darkMode ? "text-white" : "text-gray-900"}`}>
            <AlertTriangle aria-hidden="true" className="w-5 h-5 text-orange-500" />
            Active Trials
            <span className="text-sm font-normal text-orange-500">({activeTrials.length})</span>
          </h3>
          <div className="space-y-3">
            {activeTrials.map((sub: any) => {
              const daysLeft = getDaysDifference(sub.trialEndsAt)
              const urgencyColor = daysLeft <= 1 ? "text-red-600" : daysLeft <= 3 ? "text-orange-500" : "text-yellow-600"
              const urgencyBg = daysLeft <= 1 ? (darkMode ? "bg-red-900/20 border-red-700" : "bg-red-50 border-red-200") : daysLeft <= 3 ? (darkMode ? "bg-orange-900/20 border-orange-700" : "bg-orange-50 border-orange-200") : (darkMode ? "bg-yellow-900/20 border-yellow-700" : "bg-yellow-50 border-yellow-200")
              return (
                <div
                  key={sub.id}
                  className={`${urgencyBg} border rounded-xl p-5 flex items-center justify-between`}
                  aria-label={`${sub.name} trial, expires in ${daysLeft} days`}
                >
                  <div className="flex items-center gap-4">
                    <div aria-hidden="true" className={`w-12 h-12 ${darkMode ? "bg-[#1E2A35]" : "bg-black"} rounded-lg flex items-center justify-center text-2xl`}>
                      {sub.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{sub.name}</h4>
                        <span className="bg-[#007A5C] text-white text-xs px-2 py-0.5 rounded-full font-semibold">Trial</span>
                      </div>
                      <p className={`text-sm font-bold ${urgencyColor} mt-0.5`}>
                        {daysLeft === 0 ? "Expires TODAY at midnight" : `Expires in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`}
                      </p>
                      {sub.priceAfterTrial && (
                        <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                          Auto-charges ${sub.priceAfterTrial}/{sub.billingCycle || "month"} after trial
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`text-right mr-4`}>
                      <p className={`text-2xl font-bold tabular-nums ${urgencyColor}`}>
                        {daysLeft === 0 ? "Today" : `${daysLeft}d`}
                      </p>
                      <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>remaining</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Subscriptions List */}
      {!hasNoResults && (
        <>
          {shouldVirtualize ? (
            <VirtualizedList
              items={displayed}
              itemHeight={80}
              containerHeight={600}
              renderItem={(sub: any) => renderSubscriptionCard(sub)}
            />
          ) : isPrioritySort && !priorityOrderLoading ? (
            <SortableSubscriptionList
              items={displayed}
              darkMode={darkMode}
              onReorder={(fromIndex, toIndex) =>
                reorderPriority(fromIndex, toIndex, filteredIds)
              }
              renderItem={(sub: any) => (
                <SortableItemShell id={sub.id}>
                  {({ setNodeRef, style, isDragging, attributes, listeners }) =>
                    renderSubscriptionCard(sub, {
                      priorityRank: getGlobalPriorityRank(sub.id, priorityOrder),
                      dragHandle: (
                        <SortableDragHandle
                          attributes={attributes}
                          listeners={listeners}
                          darkMode={darkMode}
                          label={`Drag to reorder ${sub.name}`}
                        />
                      ),
                      shellRef: setNodeRef,
                      shellStyle: style,
                      isDragging,
                    })
                  }
                </SortableItemShell>
              )}
            />
          ) : (
            <div className="space-y-3">
              {displayed.map((sub: any) => renderSubscriptionCard(sub))}
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
            setSelectedSubForCancel(null)
          }}
        />
      )}

      {showKeyboardHelp && (
        <KeyboardHelpModal
          darkMode={darkMode}
          onClose={() => setShowKeyboardHelp(false)}
        />
      )}

      {/* Keyboard shortcut hint footer */}
      <div className={`mt-8 flex items-center justify-center gap-1.5 text-xs ${darkMode ? "text-gray-600" : "text-gray-400"}`}>
        <span>Press</span>
        <kbd
          className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded border font-mono text-[11px] ${
            darkMode ? "bg-[#2D3748] border-[#374151] text-gray-400" : "bg-gray-100 border-gray-300 text-gray-500"
          }`}
        >
          ?
        </kbd>
        <span>for keyboard shortcuts</span>
        <span aria-hidden="true" className="mx-1">·</span>
        <kbd
          className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded border font-mono text-[11px] ${
            darkMode ? "bg-[#2D3748] border-[#374151] text-gray-400" : "bg-gray-100 border-gray-300 text-gray-500"
          }`}
        >
          ⌘K
        </kbd>
        <span>for command palette</span>
      </div>

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
              setAdvancedFilters(EMPTY_FILTERS)
              setShowDuplicatesOnly(false)
              setShowUnusedOnly(false)
            },
          }}
          darkMode={darkMode}
        />
      )}
      {showCalendarModal && calendarToken && calendarFeedUrl && (
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
                value={calendarFeedUrl}
                className={`w-full pr-12 pl-4 py-3 rounded-xl border text-sm ${
                  darkMode ? "bg-[#2D3748] border-[#374151] text-gray-300" : "bg-gray-50 border-gray-200 text-gray-600"
                }`}
              />
              <button
                onClick={() => copyToClipboard(calendarFeedUrl)}
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
  onDelete: (id: string) => void
  onManage?: (subscription: any) => void
  selectedSubscriptions: Set<string>
  onToggleSelect: (id: string) => void
  darkMode?: boolean
  isDuplicate?: boolean
  unusedInfo?: any
  onCancel?: (subscription: any) => void
  guide?: CancellationGuide
  onPause?: (subscription: any) => void
  onResume?: (subscription: any) => void
  onCancelTrial?: (id: string) => void
  onConvertTrial?: (id: string) => void
  priorityRank?: PriorityRank
  dragHandle?: ReactNode
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
  onPause,
  onResume,
  onCancelTrial,
  onConvertTrial,
  priorityRank,
  dragHandle,
}: SubscriptionCardProps) {
  const { settings } = useUserSettings()
  const currency = settings.currency
  const isPaused = sub.status === "paused"

  const statusLabel =
    isPaused
      ? "paused"
      : sub.status === "expiring"
        ? `expiring in ${sub.renewsIn} days`
        : sub.status === "trial"
          ? "trial"
          : sub.status === "cancelled"
            ? "cancelled"
            : "active"

  // WCAG-AA compliant difficulty badge tokens (≥ 4.5:1 contrast)
  const difficultyColors: Record<string, string> = {
    easy: darkMode
      ? "text-[#bbf7d0] bg-[#14532d]"
      : "text-[#166534] bg-[#dcfce7]",
    medium: darkMode
      ? "text-[#fde68a] bg-[#3b1c08]"
      : "text-[#92400e] bg-[#fef3c7]",
    hard: darkMode
      ? "text-[#fca5a5] bg-[#7f1d1d]"
      : "text-[#991b1b] bg-[#fee2e2]",
  }

  return (
    <div
      className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-5 flex items-center justify-between${isPaused ? " opacity-50" : ""}`}
      aria-label={`${sub.name}, ${sub.category}, $${sub.price}/month, ${statusLabel}${isDuplicate ? ", duplicate" : ""}${unusedInfo ? ", unused" : ""}`}
    >
      <div className="flex items-center gap-4 flex-1">
        {dragHandle}
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
            {priorityRank && <PriorityBadge rank={priorityRank} darkMode={darkMode} />}
            <div
              className="flex items-center gap-1 text-xs text-gray-500"
              title={
                sub.is_encrypted
                  ? "This subscription's on-chain data is encrypted"
                  : "This subscription is stored in plaintext on-chain"
              }
            >
              {sub.is_encrypted ? (
                <Lock className="w-3 h-3 text-green-500" aria-hidden="true" />
              ) : (
                <LockOpen className="w-3 h-3 text-yellow-500" aria-hidden="true" />
              )}
              <span className="sr-only">
                {sub.is_encrypted
                  ? "This subscription's on-chain data is encrypted"
                  : "This subscription is stored in plaintext on-chain"}
              </span>
            </div>
            {sub.isTrial && (
              <StatusBadge status="trial" darkMode={darkMode} />
            )}
            {isDuplicate && (
              <span className="bg-[#FFD166] text-[#1E2A35] text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <Copy aria-hidden="true" className="w-3 h-3" />
                Duplicate
              </span>
            )}
            {unusedInfo && (
              <span className="bg-[#E86A33] text-white text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <Clock aria-hidden="true" className="w-3 h-3" />
                Potentially Wasted
              </span>
            )}
            {sub.latest_price_change && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 ${
                  sub.latest_price_change.new_price > sub.latest_price_change.old_price
                    ? darkMode
                      ? "bg-[#7f1d1d] text-[#fca5a5]"
                      : "bg-[#fee2e2] text-[#991b1b]"
                    : darkMode
                      ? "bg-[#14532d] text-[#bbf7d0]"
                      : "bg-[#dcfce7] text-[#166534]"
                }`}
              >
                {sub.latest_price_change.new_price > sub.latest_price_change.old_price ? "↑" : "↓"} Price Changed
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
              <StatusBadge status="cancelled" darkMode={darkMode} className="text-[10px] uppercase tracking-wider" />
            )}
            {sub.status === "paused" && (
              <StatusBadge status="paused" darkMode={darkMode} className="text-[10px] uppercase tracking-wider" />
            )}
            {isPaused && (
              <span className="bg-gray-200 dark:bg-[#374151] text-gray-500 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1">
                <PauseCircle aria-hidden="true" className="w-2.5 h-2.5" />
                Paused
              </span>
            )}
          </div>
          {sub.isTrial && sub.trialEndsAt && (
            <p className={`text-xs ${darkMode ? "text-[#007A5C]" : "text-green-600"} mt-1`}>
              Trial ends in {getDaysDifference(sub.trialEndsAt)} days - {formatCurrency(sub.priceAfterTrial || 0, currency)}/month after
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
            <StatusBadge
              status={normalizeStatus(sub.status)}
              darkMode={darkMode}
              className="mt-1"
            />
          </div>
        </div>

        <div className="text-right">
          <p className={`font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>${sub.price}</p>
          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>/Month</p>
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
          {!isPaused && sub.status !== "cancelled" && (
            <button
              onClick={() => onPause && onPause(sub)}
              aria-label={`Pause ${sub.name}`}
              className={`p-2 rounded-lg ${darkMode ? "hover:bg-yellow-500/20 text-yellow-400" : "hover:bg-yellow-50 text-yellow-600"} flex items-center gap-1 group`}
            >
              <PauseCircle aria-hidden="true" className="w-4 h-4" />
              <span className="text-xs font-semibold hidden group-hover:inline">Pause</span>
            </button>
          )}
          {isPaused && (
            <button
              onClick={() => onResume && onResume(sub)}
              aria-label={`Resume ${sub.name}`}
              className={`p-2 rounded-lg ${darkMode ? "hover:bg-green-500/20 text-green-400" : "hover:bg-green-50 text-green-600"} flex items-center gap-1 group`}
            >
              <PlayCircle aria-hidden="true" className="w-4 h-4" />
              <span className="text-xs font-semibold hidden group-hover:inline">Resume</span>
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

function BrokenCardPlaceholder({ name, darkMode }: { name?: string; darkMode?: boolean }) {
  return (
    <div
      className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-5 flex items-center justify-between opacity-70`}
    >
      <div className="flex items-center gap-4 flex-1">
        <div className={`w-12 h-12 ${darkMode ? "bg-[#1E2A35]" : "bg-gray-100"} rounded-lg flex items-center justify-center`}>
          <AlertCircle className="w-6 h-6 text-destructive" />
        </div>
        <div>
          <h4 className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>
            {name || "Subscription"} (Error)
          </h4>
          <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
            This component failed to load.
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Unavailable</p>
      </div>
    </div>
  )
}
