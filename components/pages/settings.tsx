"use client"
import { LogOut, Bell, AlertCircle, Key, Plus, Eye, EyeOff, Trash2, Mail, DollarSign } from "lucide-react"
import { useState } from "react"
import { type Currency, CURRENCY_NAMES, CURRENCY_SYMBOLS } from "@/lib/currency-utils"

export default function SettingsPage({
  currentPlan,
  onUpgrade,
  budgetLimit,
  onBudgetChange,
  darkMode,
  currency,
  onCurrencyChange,
}) {
  const [alertThreshold, setAlertThreshold] = useState(80)
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [weeklyReports, setWeeklyReports] = useState(true)
  const [recommendations, setRecommendations] = useState(true)
  const [showAddApiKey, setShowAddApiKey] = useState(false)
  const [newApiKey, setNewApiKey] = useState({ tool: "", key: "" })
  const [apiKeys, setApiKeys] = useState([
    { id: 1, tool: "ChatGPT", key: "sk-...abc123", visible: false, lastUsed: "2 hours ago" },
    { id: 2, tool: "Midjourney", key: "mj-...xyz789", visible: false, lastUsed: "1 day ago" },
  ])

  const [showAddEmail, setShowAddEmail] = useState(false)
  const [emailAccounts, setEmailAccounts] = useState([
    {
      id: 1,
      email: "caleb@example.com",
      provider: "gmail",
      isPrimary: true,
      connectedAt: "2024-01-15",
      lastScanned: "2 hours ago",
      subscriptionCount: 8,
    },
    {
      id: 2,
      email: "caleb.work@company.com",
      provider: "gmail",
      isPrimary: false,
      connectedAt: "2024-02-01",
      lastScanned: "1 day ago",
      subscriptionCount: 5,
    },
  ])

  const handleAddApiKey = () => {
    if (newApiKey.tool && newApiKey.key) {
      setApiKeys([
        ...apiKeys,
        {
          id: Math.max(...apiKeys.map((k) => k.id), 0) + 1,
          tool: newApiKey.tool,
          key: newApiKey.key,
          visible: false,
          lastUsed: "Just now",
        },
      ])
      setNewApiKey({ tool: "", key: "" })
      setShowAddApiKey(false)
    }
  }

  const handleDeleteApiKey = (id) => {
    setApiKeys(apiKeys.filter((k) => k.id !== id))
  }

  const toggleKeyVisibility = (id) => {
    setApiKeys(apiKeys.map((k) => (k.id === id ? { ...k, visible: !k.visible } : k)))
  }

  const handleConnectEmail = () => {
    // This would trigger Gmail OAuth flow
    console.log("[v0] Connecting new email account...")
    setShowAddEmail(false)
    // Simulate adding a new email
    setTimeout(() => {
      setEmailAccounts([
        ...emailAccounts,
        {
          id: Math.max(...emailAccounts.map((e) => e.id), 0) + 1,
          email: "new.email@example.com",
          provider: "gmail",
          isPrimary: false,
          connectedAt: new Date().toISOString().split("T")[0],
          lastScanned: "Just now",
          subscriptionCount: 0,
        },
      ])
    }, 1000)
  }

  const handleSetPrimaryEmail = (id) => {
    const newPrimary = emailAccounts.find((e) => e.id === id)

    if (!newPrimary) return

    const confirmChange = window.confirm(
      `Set ${newPrimary.email} as your primary email? This will be used for new subscriptions and notifications.`,
    )

    if (!confirmChange) return

    setEmailAccounts(emailAccounts.map((e) => ({ ...e, isPrimary: e.id === id })))
  }

  const handleRemoveEmail = (id) => {
    const email = emailAccounts.find((e) => e.id === id)

    if (!email) return

    if (email.isPrimary) {
      const otherEmails = emailAccounts.filter((e) => e.id !== id)

      if (otherEmails.length === 0) {
        alert("Cannot delete your last email account. You need at least one email to track subscriptions.")
        return
      }

      alert("Cannot delete primary email. Please set another email as primary first.")
      return
    }

    const confirmDelete = window.confirm(
      `Remove ${email.email}? Subscriptions from this email will be marked as "source removed".`,
    )

    if (!confirmDelete) return

    setEmailAccounts(emailAccounts.filter((e) => e.id !== id))
  }

  const handleRescanEmail = (id) => {
    console.log("[v0] Rescanning email account:", id)
    setEmailAccounts(emailAccounts.map((e) => (e.id === id ? { ...e, lastScanned: "Just now" } : e)))
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Plan Information */}
      <div className={`border rounded-xl p-6 ${darkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"}`}>
        <h3 className={`text-lg font-semibold mb-4 ${darkMode ? "text-white" : "text-gray-900"}`}>Current Plan</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className={darkMode ? "text-gray-400" : "text-gray-600"}>You are currently on the</p>
            <p className={`text-2xl font-bold capitalize ${darkMode ? "text-white" : "text-gray-900"}`}>
              {currentPlan} Plan
            </p>
          </div>
          {currentPlan === "free" && (
            <button
              onClick={onUpgrade}
              className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                darkMode ? "bg-white text-black hover:bg-gray-100" : "bg-black text-white hover:bg-gray-800"
              }`}
            >
              Upgrade Plan
            </button>
          )}
        </div>
      </div>

      {/* Currency & Localization */}
      <div className={`border rounded-xl p-6 ${darkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"}`}>
        <h3
          className={`text-lg font-semibold mb-4 flex items-center gap-2 ${darkMode ? "text-white" : "text-gray-900"}`}
        >
          <DollarSign className="w-5 h-5" />
          Currency & Localization
        </h3>
        <div className="space-y-4">
          <div>
            <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
              Display Currency
            </label>
            <select
              value={currency}
              onChange={(e) => onCurrencyChange(e.target.value as Currency)}
              className={`w-full px-4 py-2 border rounded-lg ${
                darkMode ? "bg-gray-800 border-gray-700 text-white" : "bg-white border-gray-300 text-gray-900"
              }`}
            >
              {Object.entries(CURRENCY_NAMES).map(([code, name]) => (
                <option key={code} value={code}>
                  {CURRENCY_SYMBOLS[code as Currency]} {name} ({code})
                </option>
              ))}
            </select>
            <p className={`text-xs mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
              All prices will be displayed in your selected currency
            </p>
          </div>
        </div>
      </div>

      {/* Connected Email Accounts */}
      <div className={`border rounded-xl p-6 ${darkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-lg font-semibold flex items-center gap-2 ${darkMode ? "text-white" : "text-gray-900"}`}>
            <Mail className="w-5 h-5" />
            Connected Email Accounts
          </h3>
          <button
            onClick={() => setShowAddEmail(!showAddEmail)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              darkMode
                ? "bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"
                : "bg-[#1E2A35] text-white hover:bg-[#2D3748]"
            }`}
          >
            <Plus className="w-4 h-4" />
            Add Email
          </button>
        </div>

        <p className={`text-sm mb-4 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
          Connect multiple email accounts to track all your subscriptions in one place
        </p>

        {showAddEmail && (
          <div className={`mb-4 p-4 rounded-lg ${darkMode ? "bg-gray-800" : "bg-gray-50"}`}>
            <p className={`text-sm mb-3 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
              Connect a new Gmail account to scan for subscriptions
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConnectEmail}
                className="flex items-center gap-2 px-4 py-2 bg-[#007A5C] text-white rounded-lg text-sm font-medium hover:bg-[#007A5C]/90"
              >
                <Mail className="w-4 h-4" />
                Connect Gmail Account
              </button>
              <button
                onClick={() => setShowAddEmail(false)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  darkMode
                    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {emailAccounts.map((account) => (
            <div
              key={account.id}
              className={`p-4 rounded-lg border ${
                darkMode
                  ? account.isPrimary
                    ? "bg-[#FFD166]/10 border-[#FFD166]/30"
                    : "bg-gray-800 border-gray-700"
                  : account.isPrimary
                    ? "bg-[#FFD166]/10 border-[#FFD166]/30"
                    : "bg-gray-50 border-gray-200"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className={`font-medium ${darkMode ? "text-white" : "text-gray-900"}`}>{account.email}</p>
                    {account.isPrimary && (
                      <span className="px-2 py-0.5 bg-[#FFD166] text-[#1E2A35] text-xs font-medium rounded">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className={`text-sm space-y-1 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                    <p>
                      {account.subscriptionCount} subscription{account.subscriptionCount !== 1 ? "s" : ""} found
                    </p>
                    <p>Last scanned: {account.lastScanned}</p>
                    <p>Connected: {new Date(account.connectedAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => handleRescanEmail(account.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      darkMode
                        ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    Rescan
                  </button>
                  {!account.isPrimary && (
                    <>
                      <button
                        onClick={() => handleSetPrimaryEmail(account.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          darkMode
                            ? "bg-[#007A5C] text-white hover:bg-[#007A5C]/90"
                            : "bg-[#007A5C] text-white hover:bg-[#007A5C]/90"
                        }`}
                      >
                        Set Primary
                      </button>
                      <button
                        onClick={() => handleRemoveEmail(account.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Budget & Alerts */}
      <div className={`border rounded-xl p-6 ${darkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"}`}>
        <h3
          className={`text-lg font-semibold mb-4 flex items-center gap-2 ${darkMode ? "text-white" : "text-gray-900"}`}
        >
          <AlertCircle className="w-5 h-5" />
          Budget & Alerts
        </h3>
        <div className="space-y-4">
          <div>
            <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
              Monthly Budget Limit
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <span className={`absolute left-3 top-2.5 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                  {CURRENCY_SYMBOLS[currency]}
                </span>
                <input
                  type="number"
                  value={budgetLimit}
                  onChange={(e) => onBudgetChange(Number(e.target.value))}
                  className={`w-full pl-7 pr-4 py-2 border rounded-lg ${
                    darkMode ? "bg-gray-800 border-gray-700 text-white" : "bg-white border-gray-300 text-gray-900"
                  }`}
                />
              </div>
            </div>
            <p className={`text-xs mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
              Set your maximum monthly spending limit
            </p>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
              Alert Threshold
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="50"
                max="100"
                step="5"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(Number(e.target.value))}
                className="flex-1"
              />
              <span className={`text-sm font-medium w-12 ${darkMode ? "text-white" : "text-gray-900"}`}>
                {alertThreshold}%
              </span>
            </div>
            <p className={`text-xs mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
              Alert when spending reaches {alertThreshold}% of your budget
            </p>
          </div>
        </div>
      </div>

      {/* Account Settings */}
      <div className={`border rounded-xl p-6 ${darkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"}`}>
        <h3 className={`text-lg font-semibold mb-4 ${darkMode ? "text-white" : "text-gray-900"}`}>Account Settings</h3>
        <div className="space-y-4">
          <div>
            <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
              Email
            </label>
            <input
              type="email"
              value="caleb@example.com"
              disabled
              className={`w-full px-4 py-2 border rounded-lg ${
                darkMode ? "bg-gray-800 border-gray-700 text-gray-400" : "bg-gray-50 border-gray-300 text-gray-600"
              }`}
            />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
              Name
            </label>
            <input
              type="text"
              value="Caleb Alexhone"
              disabled
              className={`w-full px-4 py-2 border rounded-lg ${
                darkMode ? "bg-gray-800 border-gray-700 text-gray-400" : "bg-gray-50 border-gray-300 text-gray-600"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className={`border rounded-xl p-6 ${darkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"}`}>
        <h3
          className={`text-lg font-semibold mb-4 flex items-center gap-2 ${darkMode ? "text-white" : "text-gray-900"}`}
        >
          <Bell className="w-5 h-5" />
          Notification Preferences
        </h3>
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={emailAlerts}
              onChange={(e) => setEmailAlerts(e.target.checked)}
              className="w-4 h-4"
            />
            <div>
              <p className={darkMode ? "text-white" : "text-gray-700"}>Email alerts for budget overages</p>
              <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                Get notified when you exceed your budget
              </p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={weeklyReports}
              onChange={(e) => setWeeklyReports(e.target.checked)}
              className="w-4 h-4"
            />
            <div>
              <p className={darkMode ? "text-white" : "text-gray-700"}>Weekly spending summary</p>
              <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                Receive a summary of your spending every Monday
              </p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={recommendations}
              onChange={(e) => setRecommendations(e.target.checked)}
              className="w-4 h-4"
            />
            <div>
              <p className={darkMode ? "text-white" : "text-gray-700"}>Optimization recommendations</p>
              <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                Get AI-powered suggestions to reduce spending
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* API Keys Management */}
      <div className={`border rounded-xl p-6 ${darkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-lg font-semibold flex items-center gap-2 ${darkMode ? "text-white" : "text-gray-900"}`}>
            <Key className="w-5 h-5" />
            API Keys for Usage Tracking
          </h3>
          <button
            onClick={() => setShowAddApiKey(!showAddApiKey)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              darkMode
                ? "bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"
                : "bg-[#1E2A35] text-white hover:bg-[#2D3748]"
            }`}
          >
            <Plus className="w-4 h-4" />
            Add Key
          </button>
        </div>

        <p className={`text-sm mb-4 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
          Add API keys for your AI tools to track actual usage and get detailed analytics
        </p>

        {showAddApiKey && (
          <div className={`mb-4 p-4 rounded-lg ${darkMode ? "bg-gray-800" : "bg-gray-50"}`}>
            <div className="space-y-3">
              <div>
                <label className={`block text-sm font-medium mb-1 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Tool Name
                </label>
                <input
                  type="text"
                  value={newApiKey.tool}
                  onChange={(e) => setNewApiKey({ ...newApiKey, tool: e.target.value })}
                  placeholder="e.g., ChatGPT, Midjourney"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    darkMode ? "bg-gray-900 border-gray-700 text-white" : "bg-white border-gray-300 text-gray-900"
                  }`}
                />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  API Key
                </label>
                <input
                  type="password"
                  value={newApiKey.key}
                  onChange={(e) => setNewApiKey({ ...newApiKey, key: e.target.value })}
                  placeholder="Enter your API key"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    darkMode ? "bg-gray-900 border-gray-700 text-white" : "bg-white border-gray-300 text-gray-900"
                  }`}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddApiKey}
                  className="px-4 py-2 bg-[#007A5C] text-white rounded-lg text-sm font-medium hover:bg-[#007A5C]/90"
                >
                  Save Key
                </button>
                <button
                  onClick={() => setShowAddApiKey(false)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${
                    darkMode
                      ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {apiKeys.map((apiKey) => (
            <div
              key={apiKey.id}
              className={`flex items-center justify-between p-3 rounded-lg ${darkMode ? "bg-gray-800" : "bg-gray-50"}`}
            >
              <div className="flex-1">
                <p className={`font-medium ${darkMode ? "text-white" : "text-gray-900"}`}>{apiKey.tool}</p>
                <p className={`text-sm font-mono ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                  {apiKey.visible ? apiKey.key : "••••••••••••••••"}
                </p>
                <p className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-500"}`}>
                  Last used: {apiKey.lastUsed}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleKeyVisibility(apiKey.id)}
                  className={`p-2 rounded-lg ${darkMode ? "hover:bg-gray-700" : "hover:bg-gray-200"}`}
                >
                  {apiKey.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => handleDeleteApiKey(apiKey.id)}
                  className="p-2 rounded-lg hover:bg-red-100 text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Danger Zone */}
      <div
        className={`border rounded-xl p-6 ${darkMode ? "bg-red-900/20 border-red-800" : "bg-red-50 border-red-200"}`}
      >
        <h3 className={`text-lg font-semibold mb-4 ${darkMode ? "text-red-400" : "text-red-900"}`}>Danger Zone</h3>
        <button
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            darkMode ? "bg-red-600 text-white hover:bg-red-700" : "bg-red-600 text-white hover:bg-red-700"
          }`}
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  )
}
