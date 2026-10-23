"use client"

import { X, ChevronDown, SlidersHorizontal } from "lucide-react"
import { useState, useRef, useEffect } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FilterState {
  statuses: string[]
  categories: string[]
  priceRange: [number, number] | null // [min, max] in dollars, null = no filter
}

export const EMPTY_FILTERS: FilterState = {
  statuses: [],
  categories: [],
  priceRange: null,
}

export function hasActiveFilters(f: FilterState): boolean {
  return f.statuses.length > 0 || f.categories.length > 0 || f.priceRange !== null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trial: "Trial",
  expiring: "Expiring",
  expired: "Expired",
  paused: "Paused",
  cancelled: "Cancelled",
}

const PRICE_PRESETS: { label: string; range: [number, number] }[] = [
  { label: "Under $5", range: [0, 5] },
  { label: "$5 – $15", range: [5, 15] },
  { label: "$15 – $50", range: [15, 50] },
  { label: "Over $50", range: [50, Infinity] },
]

function priceRangeLabel(range: [number, number]): string {
  const preset = PRICE_PRESETS.find((p) => p.range[0] === range[0] && p.range[1] === range[1])
  if (preset) return preset.label
  if (range[1] === Infinity) return `Over $${range[0]}`
  return `$${range[0]} – $${range[1]}`
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

interface ChipProps {
  label: string
  active: boolean
  onClick: () => void
  onRemove?: () => void
  darkMode?: boolean
}

function Chip({ label, active, onClick, onRemove, darkMode }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all select-none ${
        active
          ? "bg-[#FFD166] text-[#1E2A35] shadow-sm"
          : darkMode
          ? "bg-[#2D3748] text-gray-300 hover:bg-[#374151] hover:text-white"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
      }`}
    >
      {label}
      {active && onRemove && (
        <span
          role="button"
          aria-label={`Remove ${label} filter`}
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onRemove() } }}
          className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10 transition-colors"
        >
          <X className="w-2.5 h-2.5" aria-hidden="true" />
        </span>
      )}
    </button>
  )
}

// ─── Dropdown panel ───────────────────────────────────────────────────────────

interface DropdownPanelProps {
  label: string
  activeCount: number
  darkMode?: boolean
  children: React.ReactNode
}

function DropdownPanel({ label, activeCount, darkMode, children }: DropdownPanelProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleOutside)
    return () => document.removeEventListener("mousedown", handleOutside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
          activeCount > 0
            ? "bg-[#FFD166] text-[#1E2A35] border-[#FFD166]"
            : darkMode
            ? "bg-[#2D3748] text-gray-300 border-[#374151] hover:border-[#4A5568]"
            : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
        }`}
      >
        {label}
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#1E2A35] text-[#FFD166] text-[10px] font-bold">
            {activeCount}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          className={`absolute left-0 top-full mt-2 min-w-[180px] rounded-xl border shadow-lg z-40 p-2 ${
            darkMode ? "bg-[#1E2A35] border-[#374151]" : "bg-white border-gray-200"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AdvancedFilterBarProps {
  filters: FilterState
  onChange: (filters: FilterState) => void
  availableCategories: string[]
  darkMode?: boolean
}

export function AdvancedFilterBar({
  filters,
  onChange,
  availableCategories,
  darkMode,
}: AdvancedFilterBarProps) {
  const activeCount = filters.statuses.length + filters.categories.length + (filters.priceRange ? 1 : 0)

  function toggleStatus(status: string) {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status]
    onChange({ ...filters, statuses: next })
  }

  function toggleCategory(cat: string) {
    const next = filters.categories.includes(cat)
      ? filters.categories.filter((c) => c !== cat)
      : [...filters.categories, cat]
    onChange({ ...filters, categories: next })
  }

  function setPriceRange(range: [number, number] | null) {
    onChange({ ...filters, priceRange: range })
  }

  function clearAll() {
    onChange(EMPTY_FILTERS)
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Subscription filters">
      {/* Filter icon label */}
      <span className={`flex items-center gap-1.5 text-sm font-medium ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        Filters
      </span>

      {/* Status multi-select */}
      <DropdownPanel
        label="Status"
        activeCount={filters.statuses.length}
        darkMode={darkMode}
      >
        <p className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
          Status
        </p>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="option"
            aria-selected={filters.statuses.includes(value)}
            onClick={() => toggleStatus(value)}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm transition-colors ${
              filters.statuses.includes(value)
                ? "bg-[#FFD166] text-[#1E2A35] font-medium"
                : darkMode
                ? "text-gray-300 hover:bg-[#2D3748]"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            {label}
            {filters.statuses.includes(value) && <X className="w-3 h-3" aria-hidden="true" />}
          </button>
        ))}
      </DropdownPanel>

      {/* Category multi-select */}
      {availableCategories.length > 0 && (
        <DropdownPanel
          label="Category"
          activeCount={filters.categories.length}
          darkMode={darkMode}
        >
          <p className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
            Category
          </p>
          <div className="max-h-52 overflow-y-auto">
            {availableCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                role="option"
                aria-selected={filters.categories.includes(cat)}
                onClick={() => toggleCategory(cat)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm transition-colors ${
                  filters.categories.includes(cat)
                    ? "bg-[#FFD166] text-[#1E2A35] font-medium"
                    : darkMode
                    ? "text-gray-300 hover:bg-[#2D3748]"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {cat}
                {filters.categories.includes(cat) && <X className="w-3 h-3" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </DropdownPanel>
      )}

      {/* Price range */}
      <DropdownPanel
        label="Price"
        activeCount={filters.priceRange ? 1 : 0}
        darkMode={darkMode}
      >
        <p className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
          Price / month
        </p>
        {PRICE_PRESETS.map((preset) => {
          const isActive =
            filters.priceRange !== null &&
            filters.priceRange[0] === preset.range[0] &&
            filters.priceRange[1] === preset.range[1]
          return (
            <button
              key={preset.label}
              type="button"
              role="option"
              aria-selected={isActive}
              onClick={() => setPriceRange(isActive ? null : preset.range)}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-[#FFD166] text-[#1E2A35] font-medium"
                  : darkMode
                  ? "text-gray-300 hover:bg-[#2D3748]"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {preset.label}
              {isActive && <X className="w-3 h-3" aria-hidden="true" />}
            </button>
          )
        })}
      </DropdownPanel>

      {/* Active filter chips */}
      {filters.statuses.map((s) => (
        <Chip
          key={`status-${s}`}
          label={STATUS_LABELS[s] ?? s}
          active
          onClick={() => toggleStatus(s)}
          onRemove={() => toggleStatus(s)}
          darkMode={darkMode}
        />
      ))}
      {filters.categories.map((c) => (
        <Chip
          key={`cat-${c}`}
          label={c}
          active
          onClick={() => toggleCategory(c)}
          onRemove={() => toggleCategory(c)}
          darkMode={darkMode}
        />
      ))}
      {filters.priceRange && (
        <Chip
          label={priceRangeLabel(filters.priceRange)}
          active
          onClick={() => setPriceRange(null)}
          onRemove={() => setPriceRange(null)}
          darkMode={darkMode}
        />
      )}

      {/* Clear all */}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className={`text-xs px-2 py-1 rounded-full transition-colors ${
            darkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-700"
          }`}
        >
          Clear all
        </button>
      )}
    </div>
  )
}
