"use client"

import { useState } from "react"
import ManageIntegrationModal from "@/components/modals/manage-integration-modal"
import type { Integration } from "@/lib/integration-types"
import { IntegrationStatus } from "@/lib/integration-types"

interface IntegrationsPageProps {
  integrations: Integration[]
  onToggle: (id: number) => void
  darkMode?: boolean
}

export default function IntegrationsPage({ integrations, onToggle, darkMode }: IntegrationsPageProps) {
  const [sortBy, setSortBy] = useState<"name" | "recent">("name")
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null)
  const [showManageModal, setShowManageModal] = useState(false)

  const supportedTools = [
    { name: "GitHub", icon: "🐙" },
    { name: "Gemini", icon: "💎" },
    { name: "Nano Banana", icon: "🍌" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
    { name: "Gemini", icon: "💎" },
  ]

  const sortedTools = [...supportedTools].sort((a, b) => {
    if (sortBy === "name") {
      return a.name.localeCompare(b.name)
    }
    return 0
  })

  const handleManageIntegration = (integration: Integration) => {
    setSelectedIntegration(integration)
    setShowManageModal(true)
  }

  return (
    <div>
      {/* Connected Services */}
      <div className="mb-8">
        <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"} mb-4`}>
          Connected Services
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {integrations.map((integration) => (
            <div
              key={integration.id}
              className={`${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border rounded-xl p-6`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h4 className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{integration.name}</h4>
                  <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{integration.type}</p>
                </div>
                <button
                  onClick={() => onToggle(integration.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    integration.status === IntegrationStatus.Connected
                      ? darkMode
                        ? "bg-[#007A5C]/20 text-[#007A5C]"
                        : "bg-green-100 text-green-700"
                      : darkMode
                        ? "bg-[#374151] text-gray-400"
                        : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {integration.status === IntegrationStatus.Connected ? "Connected" : "Disconnected"}
                </button>
              </div>

              <div className={`space-y-2 text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                <p>Last sync: {integration.lastSync}</p>
                {integration.accounts > 0 && <p>{integration.accounts} accounts connected</p>}
              </div>

              <button
                onClick={() => handleManageIntegration(integration)}
                className={`mt-4 w-full py-2 text-sm font-medium rounded-lg ${
                  darkMode ? "text-[#FFD166] hover:bg-[#374151]" : "text-blue-600 hover:bg-blue-50"
                }`}
              >
                {integration.status === IntegrationStatus.Connected ? "Manage" : "Configure"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Supported Tools */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>
              Supported AI Tools & Services
            </h3>
            <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
              Automatically track AI subscription emails and receipts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className={`px-3 py-1 border rounded-lg text-sm ${
                darkMode
                  ? "bg-[#2D3748] border-[#374151] text-gray-300 hover:border-[#4B5563]"
                  : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
              }`}
            >
              <option value="name">Name</option>
              <option value="recent">Recently Added</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-4">
          {sortedTools.map((tool, idx) => (
            <div
              key={idx}
              className={`${darkMode ? "bg-[#2D3748] border-[#374151] hover:border-[#4B5563]" : "bg-white border-gray-200 hover:border-gray-300"} border rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors`}
            >
              <div className="text-4xl mb-2">{tool.icon}</div>
              <p className={`text-sm font-medium ${darkMode ? "text-white" : "text-gray-900"}`}>{tool.name}</p>
            </div>
          ))}
        </div>
      </div>

      {showManageModal && selectedIntegration && (
        <ManageIntegrationModal integration={selectedIntegration} onClose={() => setShowManageModal(false)} />
      )}
    </div>
  )
}
