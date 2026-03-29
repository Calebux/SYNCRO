"use client"

import { useState } from "react"
import { X, DollarSign, Calendar, Tag, AlertCircle } from "lucide-react"
import { validateSubscriptionData } from "@/lib/validation"

interface EditSubscriptionModalProps {
  subscription: any
  onSave: (updates: any) => void
  onClose: () => void
  darkMode?: boolean
}

export default function EditSubscriptionModal({ subscription, onSave, onClose, darkMode }: EditSubscriptionModalProps) {
  const [formData, setFormData] = useState({
    name: subscription.name,
    price: subscription.price,
    billingCycle: subscription.billingCycle || "monthly",
    renewsIn: subscription.renewsIn || 30,
    category: subscription.category,
    tags: subscription.tags?.join(", ") || "",
    renewalUrl: subscription.renewalUrl || "",
    notes: subscription.notes || "",
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    const validation = validateSubscriptionData(formData)
    if (!validation.isValid) {
      setErrors(validation.errors)
      return
    }

    // Convert tags string to array
    const tagsArray = formData.tags
      .split(",")
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0)

    onSave({
      ...formData,
      price: Number.parseFloat(formData.price),
      renewsIn: Number.parseInt(formData.renewsIn),
      tags: tagsArray,
      notes: formData.notes,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-labelledby="edit-modal-title"
        aria-modal="true"
        className={`${darkMode ? "bg-[#2D3748] text-[#F9F6F2]" : "bg-white text-[#1E2A35]"} rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden`}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1E2A35] to-[#2D3748] p-6">
          <div className="flex items-center justify-between">
            <h2 id="edit-modal-title" className="text-2xl font-bold text-white">Edit Subscription</h2>
            <button onClick={onClose} aria-label="Close edit subscription dialog" className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <X aria-hidden="true" className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6" noValidate>
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="edit-name" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                Subscription Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="edit-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                aria-required="true"
                aria-describedby={errors.name ? "edit-name-error" : undefined}
                aria-invalid={!!errors.name}
                className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  darkMode
                    ? "bg-[#1E2A35] border-[#374151] text-white focus:ring-[#FFD166]"
                    : "bg-white border-gray-300 text-gray-900 focus:ring-black"
                } ${errors.name ? "border-red-500" : ""}`}
              />
              {errors.name && <p id="edit-name-error" role="alert" className="text-red-500 text-xs mt-1">{errors.name}</p>}
            </div>

            {/* Price and Billing Cycle */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-price" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  <DollarSign aria-hidden="true" className="w-4 h-4 inline mr-1" />
                  Price <span aria-hidden="true">*</span>
                </label>
                <input
                  id="edit-price"
                  type="number"
                  step="0.01"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  aria-required="true"
                  aria-describedby={errors.price ? "edit-price-error" : undefined}
                  aria-invalid={!!errors.price}
                  className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                    darkMode
                      ? "bg-[#1E2A35] border-[#374151] text-white focus:ring-[#FFD166]"
                      : "bg-white border-gray-300 text-gray-900 focus:ring-black"
                  } ${errors.price ? "border-red-500" : ""}`}
                />
                {errors.price && <p id="edit-price-error" role="alert" className="text-red-500 text-xs mt-1">{errors.price}</p>}
              </div>

              <div>
                <label htmlFor="edit-billing-cycle" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Billing Cycle
                </label>
                <select
                  id="edit-billing-cycle"
                  value={formData.billingCycle}
                  onChange={(e) => setFormData({ ...formData, billingCycle: e.target.value })}
                  className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                    darkMode
                      ? "bg-[#1E2A35] border-[#374151] text-white focus:ring-[#FFD166]"
                      : "bg-white border-gray-300 text-gray-900 focus:ring-black"
                  }`}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                  <option value="lifetime">Lifetime</option>
                </select>
              </div>
            </div>

            {/* Renewal Days */}
            {formData.billingCycle !== "lifetime" && (
              <div>
                <label htmlFor="edit-renews-in" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  <Calendar aria-hidden="true" className="w-4 h-4 inline mr-1" />
                  Days Until Renewal
                </label>
                <input
                  id="edit-renews-in"
                  type="number"
                  value={formData.renewsIn}
                  onChange={(e) => setFormData({ ...formData, renewsIn: e.target.value })}
                  aria-describedby={errors.renewsIn ? "edit-renews-error" : undefined}
                  aria-invalid={!!errors.renewsIn}
                  className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                    darkMode
                      ? "bg-[#1E2A35] border-[#374151] text-white focus:ring-[#FFD166]"
                      : "bg-white border-gray-300 text-gray-900 focus:ring-black"
                  } ${errors.renewsIn ? "border-red-500" : ""}`}
                />
                {errors.renewsIn && <p id="edit-renews-error" role="alert" className="text-red-500 text-xs mt-1">{errors.renewsIn}</p>}
              </div>
            )}

            {/* Category */}
            <div>
              <label htmlFor="edit-category" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                Category
              </label>
              <select
                id="edit-category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  darkMode
                    ? "bg-[#1E2A35] border-[#374151] text-white focus:ring-[#FFD166]"
                    : "bg-white border-gray-300 text-gray-900 focus:ring-black"
                }`}
              >
                <option value="AI Tools">AI Tools</option>
                <option value="Streaming">Streaming</option>
                <option value="Productivity">Productivity</option>
                <option value="Design">Design</option>
                <option value="Development">Development</option>
                <option value="Finance">Finance</option>
                <option value="Health">Health</option>
                <option value="Gaming">Gaming</option>
              </select>
            </div>

            {/* Tags */}
            <div>
              <label htmlFor="edit-tags" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                <Tag aria-hidden="true" className="w-4 h-4 inline mr-1" />
                Tags (comma separated)
              </label>
              <input
                id="edit-tags"
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="ai, productivity, work"
                className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  darkMode
                    ? "bg-[#1E2A35] border-[#374151] text-white focus:ring-[#FFD166]"
                    : "bg-white border-gray-300 text-gray-900 focus:ring-black"
                }`}
              />
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="edit-notes" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                Notes (optional)
              </label>
              <textarea
                id="edit-notes"
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="e.g. cancel if price goes above $20, shared with roommate…"
                className={`w-full px-4 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 text-sm ${
                  darkMode
                    ? "bg-[#1E2A35] border-[#374151] text-white focus:ring-[#FFD166] placeholder:text-gray-600"
                    : "bg-white border-gray-300 text-gray-900 focus:ring-black placeholder:text-gray-400"
                }`}
              />
            </div>

            {/* Renewal URL */}
            <div>
              <label htmlFor="edit-renewal-url" className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                Renewal/Management URL (optional)
              </label>
              <input
                id="edit-renewal-url"
                type="url"
                value={formData.renewalUrl}
                onChange={(e) => setFormData({ ...formData, renewalUrl: e.target.value })}
                placeholder="https://..."
                className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  darkMode
                    ? "bg-[#1E2A35] border-[#374151] text-white focus:ring-[#FFD166]"
                    : "bg-white border-gray-300 text-gray-900 focus:ring-black"
                }`}
              />
            </div>

            {/* Manual Edit Warning */}
            {subscription.source === "auto_detected" && (
              <div
                role="note"
                className={`flex items-start gap-2 p-3 rounded-lg ${darkMode ? "bg-[#FFD166]/10 border border-[#FFD166]/30" : "bg-yellow-50 border border-yellow-200"}`}
              >
                <AlertCircle aria-hidden="true" className="w-5 h-5 text-[#FFD166] flex-shrink-0 mt-0.5" />
                <p className={`text-xs ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  This subscription was auto-detected. Manual edits will prevent automatic updates from email scans.
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 px-4 py-3 border-2 rounded-lg font-medium transition-colors ${
                darkMode
                  ? "border-[#374151] hover:border-[#FFD166] text-[#F9F6F2]"
                  : "border-gray-300 hover:border-[#1E2A35] text-[#1E2A35]"
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
