"use client"

import { useState, useRef, useEffect } from "react"
import { X, Search, Plus, ChevronDown, ExternalLink } from "lucide-react"
import {
  SUBSCRIPTION_TEMPLATES,
  TEMPLATE_CATEGORIES,
  searchTemplates,
  type SubscriptionTemplate,
  type PriceTier,
} from "@/lib/subscription-templates"

const DIFFICULTY_LABEL: Record<string, { label: string; color: string }> = {
  easy: { label: "Easy to cancel", color: "text-green-500" },
  medium: { label: "Moderate to cancel", color: "text-yellow-500" },
  hard: { label: "Hard to cancel", color: "text-red-500" },
}

export default function AddSubscriptionModal({
  onAdd,
  onClose,
  darkMode,
}: {
  onAdd: (subscription: any) => void
  onClose: () => void
  darkMode?: boolean
}) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTemplate, setSelectedTemplate] = useState<SubscriptionTemplate | null>(null)
  const [selectedTier, setSelectedTier] = useState<PriceTier | null>(null)
  const [customMode, setCustomMode] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [formData, setFormData] = useState({
    name: "",
    category: "AI Tools",
    price: "",
    billingCycle: "monthly",
    renewalUrl: "",
    logo: "",
    tags: [] as string[],
  })
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const filteredTemplates = searchTemplates(searchQuery, selectedCategory)

  const handleSelectTemplate = (template: SubscriptionTemplate) => {
    setSelectedTemplate(template)
    const defaultTier = template.commonPrices[0] ?? null
    setSelectedTier(defaultTier)
    setFormData({
      name: template.name,
      category: template.category,
      price: defaultTier ? defaultTier.price.toString() : "",
      billingCycle: template.billingCycle,
      renewalUrl: template.renewalUrl,
      logo: template.logo,
      tags: template.tags,
    })
  }

  const handleSelectTier = (tier: PriceTier) => {
    setSelectedTier(tier)
    setFormData((prev: typeof formData) => ({
      ...prev,
      price: tier.price.toString(),
      billingCycle: tier.billingCycle,
    }))
  }

  const buildPayload = () => ({
    name: formData.name,
    category: formData.category,
    price: parseFloat(formData.price),
    billing_cycle: formData.billingCycle,
    renewal_url: formData.renewalUrl || null,
    icon: "🔗",
    color: "#000000",
    renews_in: 30,
    status: "active",
    tags: formData.tags,
    logo: formData.logo || null,
    source: "manual",
  })

  const handleSubmit = () => {
    if (!formData.name || !formData.price) return
    onAdd(buildPayload())
  }

  const base = darkMode ? "bg-[#2D3748] text-[#F9F6F2]" : "bg-white text-[#1E2A35]"
  const input = darkMode
    ? "bg-[#1E2A35] border-[#374151] text-[#F9F6F2]"
    : "bg-white border-gray-300 text-[#1E2A35]"
  const card = darkMode ? "border-[#374151]" : "border-gray-200"
  const muted = darkMode ? "text-gray-400" : "text-gray-500"

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-labelledby="add-modal-title"
        aria-modal="true"
        className={`${base} rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col`}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1E2A35] to-[#2D3748] p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 id="add-modal-title" className="text-2xl font-bold text-white">
                Add Subscription
              </h2>
              <p className="text-sm text-gray-300 mt-1">
                {customMode ? "Fill in your subscription details" : "Pick a service or add manually"}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close add subscription dialog"
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X aria-hidden="true" className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!customMode ? (
            <>
              {/* Search */}
              <div className="mb-4">
                <label htmlFor="add-sub-search" className="sr-only">
                  Search for a subscription service
                </label>
                <div className={`flex items-center gap-3 px-4 py-3 ${darkMode ? "bg-[#1E2A35]" : "bg-[#F9F6F2]"} rounded-lg`}>
                  <Search aria-hidden="true" className="w-5 h-5 text-gray-400 shrink-0" />
                  <input
                    id="add-sub-search"
                    ref={searchRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search services..."
                    className="flex-1 bg-transparent outline-none"
                  />
                </div>
              </div>

              {/* Category pills */}
              <div role="group" aria-label="Filter by category" className="mb-6 flex gap-2 overflow-x-auto pb-2">
                {TEMPLATE_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    aria-pressed={selectedCategory === cat}
                    className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                      selectedCategory === cat
                        ? "bg-[#FFD166] text-[#1E2A35]"
                        : darkMode
                        ? "bg-[#1E2A35] text-gray-300 hover:bg-[#374151]"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Template grid */}
              <div role="list" aria-label="Available subscription templates" className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                {filteredTemplates.map((template) => {
                  const isSelected = selectedTemplate?.name === template.name
                  return (
                    <button
                      key={template.name}
                      role="listitem"
                      onClick={() => handleSelectTemplate(template)}
                      aria-pressed={isSelected}
                      aria-label={`${template.name}, ${template.subcategory}`}
                      className={`p-4 rounded-xl border-2 transition-all text-left ${
                        isSelected
                          ? "border-[#FFD166] bg-[#FFD166]/10"
                          : `${card} hover:border-[#FFD166]/60`
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <img
                          src={template.logo}
                          alt=""
                          aria-hidden="true"
                          onError={(e) => {
                            ;(e.currentTarget as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(template.name)}&size=32&background=random`
                          }}
                          className="w-8 h-8 rounded-lg object-contain bg-white p-1 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{template.name}</p>
                          <p className={`text-xs truncate ${muted}`}>{template.subcategory}</p>
                        </div>
                      </div>
                      <p className="text-sm font-bold text-[#FFD166]">
                        from ${template.commonPrices[0]?.price ?? "—"}/
                        {template.commonPrices[0]?.billingCycle === "yearly" ? "yr" : "mo"}
                      </p>
                    </button>
                  )
                })}
              </div>

              {filteredTemplates.length === 0 && (
                <p className={`text-center py-8 ${muted}`}>No services found. Try a different search or add manually.</p>
              )}

              {/* Price tier selector — shown when a template is selected */}
              {selectedTemplate && (
                <div className={`mb-4 p-4 rounded-xl border-2 border-[#FFD166]/40 ${darkMode ? "bg-[#1E2A35]" : "bg-[#FFFBF0]"}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <img
                      src={selectedTemplate.logo}
                      alt=""
                      aria-hidden="true"
                      onError={(e) => {
                        ;(e.currentTarget as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedTemplate.name)}&size=32&background=random`
                      }}
                      className="w-8 h-8 rounded-lg object-contain bg-white p-1"
                    />
                    <div>
                      <p className="font-semibold">{selectedTemplate.name}</p>
                      {selectedTemplate.cancellationDifficulty && (
                        <p className={`text-xs ${DIFFICULTY_LABEL[selectedTemplate.cancellationDifficulty].color}`}>
                          {DIFFICULTY_LABEL[selectedTemplate.cancellationDifficulty].label}
                        </p>
                      )}
                    </div>
                    {selectedTemplate.renewalUrl && (
                      <a
                        href={selectedTemplate.renewalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${selectedTemplate.name} billing page`}
                        className={`ml-auto flex items-center gap-1 text-xs ${muted} hover:text-[#FFD166] transition-colors`}
                      >
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        Billing page
                      </a>
                    )}
                  </div>

                  <p className={`text-xs font-medium mb-2 ${muted}`}>Select your plan:</p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Price tiers">
                    {selectedTemplate.commonPrices.map((tier) => {
                      const isActive = selectedTier?.label === tier.label
                      return (
                        <button
                          key={tier.label}
                          onClick={() => handleSelectTier(tier)}
                          aria-pressed={isActive}
                          className={`px-3 py-2 rounded-lg text-sm transition-all border-2 ${
                            isActive
                              ? "border-[#FFD166] bg-[#FFD166] text-[#1E2A35] font-semibold"
                              : `${card} hover:border-[#FFD166]/60`
                          }`}
                        >
                          <span className="block">{tier.label}</span>
                          <span className="block font-bold">
                            ${tier.price}/{tier.billingCycle === "yearly" ? "yr" : tier.billingCycle === "lifetime" ? "once" : "mo"}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Add manually */}
              <button
                onClick={() => setCustomMode(true)}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed ${
                  darkMode ? "border-[#374151] hover:border-[#FFD166]" : "border-gray-300 hover:border-[#1E2A35]"
                } rounded-lg transition-colors`}
              >
                <Plus aria-hidden="true" className="w-4 h-4" />
                Add Custom Subscription
              </button>
            </>
          ) : (
            /* Custom form */
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit() }} className="space-y-4" noValidate>
              <div>
                <label htmlFor="custom-name" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Subscription Name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="custom-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., My Custom Tool"
                  aria-required="true"
                  className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${input}`}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="custom-category" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                    Category
                  </label>
                  <select
                    id="custom-category"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${input}`}
                  >
                    {TEMPLATE_CATEGORIES.filter((c) => c !== "All").map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="custom-cycle" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                    Billing Cycle
                  </label>
                  <select
                    id="custom-cycle"
                    value={formData.billingCycle}
                    onChange={(e) => setFormData({ ...formData, billingCycle: e.target.value })}
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${input}`}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="lifetime">Lifetime</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="custom-price" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Price ($) <span aria-hidden="true">*</span>
                </label>
                <input
                  id="custom-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  placeholder="e.g., 9.99"
                  aria-required="true"
                  className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${input}`}
                />
              </div>

              <div>
                <label htmlFor="custom-renewal-url" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Renewal / Billing URL (optional)
                </label>
                <input
                  id="custom-renewal-url"
                  type="url"
                  value={formData.renewalUrl}
                  onChange={(e) => setFormData({ ...formData, renewalUrl: e.target.value })}
                  placeholder="https://example.com/billing"
                  className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${input}`}
                />
              </div>

              <div>
                <label htmlFor="custom-logo" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Logo URL (optional)
                </label>
                <input
                  id="custom-logo"
                  type="url"
                  value={formData.logo}
                  onChange={(e) => setFormData({ ...formData, logo: e.target.value })}
                  placeholder="https://example.com/logo.png"
                  className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${input}`}
                />
              </div>

              <button
                type="button"
                onClick={() => setCustomMode(false)}
                className={`text-sm ${darkMode ? "text-gray-400 hover:text-gray-300" : "text-gray-600 hover:text-gray-800"}`}
              >
                ← Back to services
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className={`p-6 border-t ${darkMode ? "border-[#374151]" : "border-gray-200"}`}>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className={`flex-1 px-4 py-3 border-2 ${
                darkMode ? "border-[#374151] hover:border-[#FFD166]" : "border-gray-300 hover:border-[#1E2A35]"
              } rounded-lg font-medium transition-colors`}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!formData.name || !formData.price}
              aria-disabled={!formData.name || !formData.price}
              className="flex-1 px-4 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add to Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
