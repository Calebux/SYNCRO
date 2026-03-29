"use client"
import {
  LogOut,
  Bell,
  AlertCircle,
  Key,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  Mail,
  DollarSign,
  Users,
  Building2,
  Send,
} from "lucide-react"
import React, { useState, useEffect } from "react"
import { apiGet, apiPatch } from "@/lib/api"
import { type Currency, CURRENCY_NAMES, CURRENCY_SYMBOLS } from "@/lib/currency-utils"

interface SettingsPageProps {
  currentPlan: string
  onUpgrade: (plan: string) => void
  budgetLimit: number
  onBudgetChange: (limit: number) => void
  darkMode?: boolean
  currency: Currency
  onCurrencyChange: (currency: Currency) => void
  accountType?: string
  onUpgradeToTeam?: (workspaceData: any) => void
}

export default function SettingsPage({
  currentPlan,
  onUpgrade,
  budgetLimit,
  onBudgetChange,
  darkMode,
  currency,
  onCurrencyChange,
  accountType = "individual",
  onUpgradeToTeam,
}: SettingsPageProps) {
  const [alertThreshold, setAlertThreshold] = useState(80)
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [weeklyReports, setWeeklyReports] = useState(true)
  const [recommendations, setRecommendations] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)
  const [showAddApiKey, setShowAddApiKey] = useState(false)
  const [newApiKey, setNewApiKey] = useState({ tool: "", key: "" })
  const [apiKeys, setApiKeys] = useState([
    { id: 1, tool: "ChatGPT", key: "sk-...abc123", visible: false, lastUsed: "2 hours ago" },
    { id: 2, tool: "Midjourney", key: "mj-...xyz789", visible: false, lastUsed: "1 day ago" },
  ])

  const [showTeamUpgrade, setShowTeamUpgrade] = useState(false)
  const [teamSetup, setTeamSetup] = useState({
    workspaceName: "",
    workDomain: "",
    inviteEmails: [""],
  })

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
      isWorkEmail: false,
      domain: "example.com",
    },
    {
      id: 2,
      email: "caleb.work@company.com",
      provider: "gmail",
      isPrimary: false,
      connectedAt: "2024-02-01",
      lastScanned: "1 day ago",
      subscriptionCount: 5,
      isWorkEmail: true,
      domain: "company.com",
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

  const handleDeleteApiKey = (id: number) => {
    setApiKeys(apiKeys.filter((k) => k.id !== id))
  }

  const toggleKeyVisibility = (id: number) => {
    setApiKeys(apiKeys.map((k) => (k.id === id ? { ...k, visible: !k.visible } : k)))
  }

  const handleConnectEmail = () => {
    // This would trigger Gmail OAuth flow
    console.log("[v0] Connecting new email account...")
    setShowAddEmail(false)
    // Simulate adding a new email
    setTimeout(() => {
      const newEmail = "new.email@example.com"
      const domain = newEmail.split("@")[1]
      const isWorkEmail = !["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"].includes(domain)

      setEmailAccounts([
        ...emailAccounts,
        {
          id: Math.max(...emailAccounts.map((e) => e.id), 0) + 1,
          email: newEmail,
          provider: "gmail",
          isPrimary: false,
          connectedAt: new Date().toISOString().split("T")[0],
          lastScanned: "Just now",
          subscriptionCount: 0,
          isWorkEmail,
          domain,
        },
      ])
    }, 1000)
  }

  const handleSetPrimaryEmail = (id: number) => {
    const newPrimary = emailAccounts.find((e) => e.id === id)

    if (!newPrimary) return

    const confirmChange = window.confirm(
      `Set ${newPrimary.email} as your primary email? This will be used for new subscriptions and notifications.`,
    )

    if (!confirmChange) return

    setEmailAccounts(emailAccounts.map((e) => ({ ...e, isPrimary: e.id === id })))
  }

  const handleRemoveEmail = (id: number) => {
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

  const handleRescanEmail = (id: number) => {
    console.log("[v0] Rescanning email account:", id)
    setEmailAccounts(emailAccounts.map((e) => (e.id === id ? { ...e, lastScanned: "Just now" } : e)))
  }



  const handleUpgradeToTeam = () => {
    if (!teamSetup.workspaceName || !teamSetup.workDomain) {
      alert("Please fill in workspace name and work domain")
      return
    }

    const workspaceData = {
      name: teamSetup.workspaceName,
      domain: teamSetup.workDomain,
      invitedEmails: teamSetup.inviteEmails.filter((e) => e.trim()),
      createdAt: new Date().toISOString(),
    }

    onUpgradeToTeam?.(workspaceData)
    setShowTeamUpgrade(false)
  }

  const handleAddInviteEmail = () => {
    setTeamSetup({
      ...teamSetup,
      inviteEmails: [...teamSetup.inviteEmails, ""],
    })
  }

  const handleRemoveInviteEmail = (index: number) => {
    setTeamSetup({
      ...teamSetup,
      inviteEmails: teamSetup.inviteEmails.filter((_, i) => i !== index),
    })
  }

  const handleInviteEmailChange = (index: number, value: string) => {
    const newInvites = [...teamSetup.inviteEmails]
    newInvites[index] = value
    setTeamSetup({
      ...teamSetup,
      inviteEmails: newInvites,
    })
  }

  const workDomains = [...new Set(emailAccounts.filter((e) => e.isWorkEmail).map((e) => e.domain))]

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
            <p className={`text-sm mt-1 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
              Account Type: <span className="font-medium capitalize">{accountType}</span>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {currentPlan === "free" && (
              <button
                onClick={() => onUpgrade("pro")}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  darkMode ? "bg-white text-black hover:bg-gray-100" : "bg-black text-white hover:bg-gray-800"
                }`}
              >
                Upgrade Plan
              </button>
            )}
            {accountType === "individual" && (
              <button
                onClick={() => setShowTeamUpgrade(true)}
                className={`px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  darkMode
                    ? "bg-[#007A5C] text-white hover:bg-[#007A5C]/90"
                    : "bg-[#007A5C] text-white hover:bg-[#007A5C]/90"
                }`}
              >
                <Users className="w-4 h-4" />
                Upgrade to Team
              </button>
            )}
          </div>
        </div>
      </div>

      {workDomains.length > 0 && accountType === "individual" && (
        <div
          className={`border rounded-xl p-6 ${darkMode ? "bg-[#007A5C]/10 border-[#007A5C]/30" : "bg-green-50 border-green-200"}`}
        >
          <div className="flex items-start gap-3">
            <Building2 className={`w-5 h-5 mt-0.5 ${darkMode ? "text-[#007A5C]" : "text-green-700"}`} />
            <div className="flex-1">
              <h4 className={`font-semibold mb-1 ${darkMode ? "text-white" : "text-gray-900"}`}>Work Email Detected</h4>
              <p className={`text-sm mb-3 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                We detected you're using a work email ({workDomains.join(", ")}). Upgrade to a Team account to
                collaborate with colleagues and manage team subscriptions.
              </p>
              <button
                onClick={() => setShowTeamUpgrade(true)}
                className={`text-sm font-medium ${darkMode ? "text-[#007A5C]" : "text-green-700"} hover:underline`}
              >
                Learn more about Team accounts →
              </button>
            </div>
          </div>
        </div>
      )}

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
                    {account.isWorkEmail && (
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded ${darkMode ? "bg-[#007A5C] text-white" : "bg-green-100 text-green-700"}`}
                      >
                        Work
                      </span>
                    )}
                  </div>
                  <div className={`text-sm space-y-1 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                    <p>
                      {account.subscriptionCount} subscription{account.subscriptionCount !== 1 ? "s" : ""} found
                    </p>
                    <p>Last scanned: {account.lastScanned}</p>
                    <p>Connected: {new Date(account.connectedAt).toLocaleDateString()}</p>
                    {account.isWorkEmail && (
                      <p className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        Domain: {account.domain}
                      </p>
                    )}
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

      {showTeamUpgrade && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div
            className={`${darkMode ? "bg-gray-900" : "bg-white"} rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto`}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-[#007A5C] flex items-center justify-center">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className={`text-2xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
                  Upgrade to Team Account
                </h3>
                <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                  Collaborate with your team and manage subscriptions together
                </p>
              </div>
            </div>

            <div className="space-y-6">
              {/* Workspace Setup */}
              <div>
                <h4 className={`font-semibold mb-4 ${darkMode ? "text-white" : "text-gray-900"}`}>Workspace Setup</h4>
                <div className="space-y-4">
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                      Workspace Name
                    </label>
                    <input
                      type="text"
                      value={teamSetup.workspaceName}
                      onChange={(e) => setTeamSetup({ ...teamSetup, workspaceName: e.target.value })}
                      placeholder="e.g., Acme Inc, Marketing Team"
                      className={`w-full px-4 py-2 border rounded-lg ${
                        darkMode ? "bg-gray-800 border-gray-700 text-white" : "bg-white border-gray-300 text-gray-900"
                      }`}
                    />
                  </div>

                  <div>
                    <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                      Work Domain
                    </label>
                    <input
                      type="text"
                      value={teamSetup.workDomain}
                      onChange={(e) => setTeamSetup({ ...teamSetup, workDomain: e.target.value })}
                      placeholder="e.g., company.com"
                      className={`w-full px-4 py-2 border rounded-lg ${
                        darkMode ? "bg-gray-800 border-gray-700 text-white" : "bg-white border-gray-300 text-gray-900"
                      }`}
                    />
                    <p className={`text-xs mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                      Team members with this domain will be automatically suggested
                    </p>
                    {workDomains.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-600"}`}>Detected domains:</p>
                        {workDomains.map((domain) => (
                          <button
                            key={domain}
                            onClick={() => setTeamSetup({ ...teamSetup, workDomain: domain })}
                            className={`text-xs px-2 py-1 rounded ${
                              darkMode
                                ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            {domain}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Invite Team Members */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>
                    Invite Team Members (Optional)
                  </h4>
                  <button
                    onClick={handleAddInviteEmail}
                    className={`text-sm flex items-center gap-1 ${darkMode ? "text-[#007A5C]" : "text-[#007A5C]"} hover:underline`}
                  >
                    <Plus className="w-4 h-4" />
                    Add Another
                  </button>
                </div>
                <div className="space-y-3">
                  {teamSetup.inviteEmails.map((email, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => handleInviteEmailChange(index, e.target.value)}
                        placeholder={`teammate@${teamSetup.workDomain || "company.com"}`}
                        className={`flex-1 px-4 py-2 border rounded-lg ${
                          darkMode ? "bg-gray-800 border-gray-700 text-white" : "bg-white border-gray-300 text-gray-900"
                        }`}
                      />
                      {teamSetup.inviteEmails.length > 1 && (
                        <button
                          onClick={() => handleRemoveInviteEmail(index)}
                          className={`px-3 py-2 rounded-lg ${
                            darkMode ? "bg-gray-700 hover:bg-gray-600" : "bg-gray-200 hover:bg-gray-300"
                          }`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className={`text-xs mt-2 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                  You can invite more team members later from the Teams page
                </p>
              </div>

              {/* Benefits */}
              <div className={`p-4 rounded-lg ${darkMode ? "bg-gray-800" : "bg-gray-50"}`}>
                <h4 className={`font-semibold mb-3 ${darkMode ? "text-white" : "text-gray-900"}`}>
                  Team Account Benefits
                </h4>
                <ul className={`space-y-2 text-sm ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  <li className="flex items-start gap-2">
                    <span className="text-[#007A5C] mt-0.5">✓</span>
                    <span>Collaborate with team members on subscription management</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#007A5C] mt-0.5">✓</span>
                    <span>Track team spending and set department budgets</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#007A5C] mt-0.5">✓</span>
                    <span>Role-based access control (Admin, Manager, Member, Viewer)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#007A5C] mt-0.5">✓</span>
                    <span>Automatic discovery of team members by work domain</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#007A5C] mt-0.5">✓</span>
                    <span>Centralized billing and payment management</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowTeamUpgrade(false)}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  darkMode ? "bg-gray-700 hover:bg-gray-600 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-900"
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleUpgradeToTeam}
                className="flex-1 px-4 py-2 bg-[#007A5C] text-white rounded-lg font-medium hover:bg-[#007A5C]/90 transition-colors"
              >
                Create Team Workspace
              </button>
            </div>
          </div>
        </div>
      )}

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
