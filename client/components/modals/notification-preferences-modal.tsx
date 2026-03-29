"use client"

import { useState, useEffect } from "react"
import { Bell, BellOff, X, Loader2 } from "lucide-react"
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  snoozeSubscription,
  type NotificationPreferences,
} from "@/lib/supabase/notification-preferences"

const PRESET_DAYS = [30, 14, 7, 3, 1]

const CHANNELS = [
  { id: "email", label: "Email" },
  { id: "push", label: "Push" },
  { id: "telegram", label: "Telegram" },
  { id: "slack", label: "Slack" },
] as const

interface NotificationPreferencesModalProps {
  subscriptionId: string
  subscriptionName: string
  darkMode?: boolean
  onClose: () => void
}

export default function NotificationPreferencesModal({
  subscriptionId,
  subscriptionName,
  darkMode,
  onClose,
}: NotificationPreferencesModalProps) {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [snoozeSaving, setSnoozeSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Local editable state — defaults match backend defaults
  const [selectedDays, setSelectedDays] = useState<number[]>([7, 3, 1])
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["email"])
  const [muted, setMuted] = useState(false)
  const [showSnoozeInput, setShowSnoozeInput] = useState(false)
  const [snoozeDate, setSnoozeDate] = useState("")

  // Load existing preferences on mount
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const data = await fetchNotificationPreferences(subscriptionId)
        if (data) {
          setPrefs(data)
          setSelectedDays(data.reminder_days_before)
          setSelectedChannels(data.channels)
          setMuted(data.muted)
        }
      } catch {
        setError("Failed to load notification preferences")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [subscriptionId])

  function toggleDay(day: number) {
    setSelectedDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort((a, b) => b - a),
    )
  }

  function toggleChannel(channel: string) {
    setSelectedChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((c) => c !== channel)
        : [...prev, channel],
    )
  }

  async function handleSave() {
    if (selectedDays.length === 0) {
      setError("Select at least one reminder day")
      return
    }
    if (selectedChannels.length === 0) {
      setError("Select at least one channel")
      return
    }

    setSaving(true)
    setError(null)

    try {
      const updated = await updateNotificationPreferences(subscriptionId, {
        reminder_days_before: selectedDays,
        channels: selectedChannels as NotificationPreferences["channels"],
        muted,
      })
      setPrefs(updated)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch {
      setError("Failed to save preferences. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  async function handleMuteToggle() {
    const newMuted = !muted
    setMuted(newMuted)
    setSaving(true)
    setError(null)

    try {
      const updated = await updateNotificationPreferences(subscriptionId, {
        muted: newMuted,
        // Clear muted_until when manually unmuting
        ...(newMuted === false && { muted_until: null }),
      })
      setPrefs(updated)
    } catch {
      setMuted(!newMuted) // revert on failure
      setError("Failed to update mute setting")
    } finally {
      setSaving(false)
    }
  }

  async function handleSnooze() {
    if (!snoozeDate) {
      setError("Please select a snooze date")
      return
    }

    const snoozeUntil = new Date(snoozeDate)
    if (snoozeUntil <= new Date()) {
      setError("Snooze date must be in the future")
      return
    }

    setSnoozeSaving(true)
    setError(null)

    try {
      const updated = await snoozeSubscription(
        subscriptionId,
        snoozeUntil.toISOString(),
      )
      setPrefs(updated)
      setMuted(true)
      setShowSnoozeInput(false)
      setSnoozeDate("")
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch {
      setError("Failed to snooze. Please try again.")
    } finally {
      setSnoozeSaving(false)
    }
  }

  // Tomorrow as min selectable date
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = tomorrow.toISOString().split("T")[0]

  const isSnoozed =
    prefs?.muted_until && new Date(prefs.muted_until) > new Date()

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-labelledby="notif-modal-title"
        aria-modal="true"
        className={`${
          darkMode ? "bg-[#2D3748] text-[#F9F6F2]" : "bg-white text-[#1E2A35]"
        } rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden`}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1E2A35] to-[#2D3748] p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell
                className="w-5 h-5 text-[#FFD166]"
                aria-hidden="true"
              />
              <h2
                id="notif-modal-title"
                className="text-xl font-bold text-white"
              >
                Notification Settings
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close notification settings"
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-white" aria-hidden="true" />
            </button>
          </div>
          <p className="text-gray-400 text-sm mt-1">for {subscriptionName}</p>
        </div>

        <div className="p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2
                className="w-6 h-6 animate-spin text-[#FFD166]"
                aria-label="Loading preferences"
              />
            </div>
          ) : (
            <>
              {/* Snooze active banner */}
              {isSnoozed && (
                <div className="p-3 bg-[#FFD166]/10 border border-[#FFD166]/30 rounded-lg">
                  <p className="text-sm text-[#FFD166]">
                    Snoozed until{" "}
                    {new Date(prefs!.muted_until!).toLocaleDateString()}
                  </p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="p-3 bg-[#E86A33]/10 border border-[#E86A33]/30 rounded-lg">
                  <p className="text-sm text-[#E86A33]">{error}</p>
                </div>
              )}

              {/* Success */}
              {success && (
                <div className="p-3 bg-[#007A5C]/10 border border-[#007A5C]/30 rounded-lg">
                  <p className="text-sm text-[#007A5C]">
                    Preferences saved!
                  </p>
                </div>
              )}

              {/* Reminder Days */}
              <div>
                <p
                  className={`text-sm font-semibold mb-3 ${
                    darkMode ? "text-gray-300" : "text-gray-700"
                  }`}
                >
                  Remind me before renewal
                </p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_DAYS.map((day) => (
                    <button
                      key={day}
                      onClick={() => toggleDay(day)}
                      aria-pressed={selectedDays.includes(day)}
                      disabled={muted}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        selectedDays.includes(day)
                          ? "bg-[#FFD166] text-[#1E2A35]"
                          : darkMode
                            ? "bg-[#1E2A35] text-gray-400 hover:text-white"
                            : "bg-gray-100 text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      {day}d
                    </button>
                  ))}
                </div>
                <p
                  className={`text-xs mt-2 ${
                    darkMode ? "text-gray-500" : "text-gray-400"
                  }`}
                >
                  Selected:{" "}
                  {selectedDays.length > 0
                    ? selectedDays.map((d) => `${d} days`).join(", ")
                    : "None"}
                </p>
              </div>

              {/* Channels */}
              <div>
                <p
                  className={`text-sm font-semibold mb-3 ${
                    darkMode ? "text-gray-300" : "text-gray-700"
                  }`}
                >
                  Notify via
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {CHANNELS.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => toggleChannel(ch.id)}
                      aria-pressed={selectedChannels.includes(ch.id)}
                      disabled={muted}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        selectedChannels.includes(ch.id)
                          ? "bg-[#FFD166] text-[#1E2A35]"
                          : darkMode
                            ? "bg-[#1E2A35] text-gray-400 hover:text-white"
                            : "bg-gray-100 text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`w-2 h-2 rounded-full ${
                          selectedChannels.includes(ch.id)
                            ? "bg-[#1E2A35]"
                            : "bg-gray-400"
                        }`}
                      />
                      {ch.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save */}
              <button
                onClick={handleSave}
                disabled={saving || muted}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving && (
                  <Loader2
                    className="w-4 h-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
                {saving ? "Saving..." : "Save Preferences"}
              </button>

              {/* Divider */}
              <div
                className={`border-t ${
                  darkMode ? "border-[#374151]" : "border-gray-200"
                }`}
              />

              {/* Mute toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p
                    className={`text-sm font-semibold ${
                      darkMode ? "text-gray-300" : "text-gray-700"
                    }`}
                  >
                    Mute all reminders
                  </p>
                  <p
                    className={`text-xs mt-0.5 ${
                      darkMode ? "text-gray-500" : "text-gray-400"
                    }`}
                  >
                    Silence all notifications for this subscription
                  </p>
                </div>
                <button
                  onClick={handleMuteToggle}
                  disabled={saving}
                  aria-pressed={muted}
                  aria-label={muted ? "Unmute reminders" : "Mute reminders"}
                  className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${
                    muted
                      ? "bg-[#E86A33]"
                      : darkMode
                        ? "bg-[#374151]"
                        : "bg-gray-200"
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      muted ? "translate-x-7" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Snooze */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p
                      className={`text-sm font-semibold ${
                        darkMode ? "text-gray-300" : "text-gray-700"
                      }`}
                    >
                      Snooze until...
                    </p>
                    <p
                      className={`text-xs mt-0.5 ${
                        darkMode ? "text-gray-500" : "text-gray-400"
                      }`}
                    >
                      Temporarily mute until a specific date
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSnoozeInput((v) => !v)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      darkMode
                        ? "bg-[#1E2A35] text-gray-400 hover:text-white"
                        : "bg-gray-100 text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <BellOff className="w-4 h-4" aria-hidden="true" />
                    Snooze
                  </button>
                </div>

                {showSnoozeInput && (
                  <div className="flex gap-2 mt-3">
                    <input
                      type="date"
                      value={snoozeDate}
                      min={minDate}
                      onChange={(e) => setSnoozeDate(e.target.value)}
                      aria-label="Snooze until date"
                      className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${
                        darkMode
                          ? "bg-[#1E2A35] border-[#374151] text-white"
                          : "bg-white border-gray-300 text-gray-900"
                      }`}
                    />
                    <button
                      onClick={handleSnooze}
                      disabled={snoozeSaving || !snoozeDate}
                      className="px-4 py-2 bg-[#FFD166] text-[#1E2A35] rounded-lg text-sm font-semibold hover:bg-[#FFD166]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {snoozeSaving ? (
                        <Loader2
                          className="w-4 h-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        "Apply"
                      )}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}