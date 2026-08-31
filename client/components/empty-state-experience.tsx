"use client"

import { useState } from "react"
import { Sparkles, Plus, ArrowRight, Zap, Shield, TrendingUp } from "lucide-react"
import AddSubscriptionModal from "./modals/add-subscription-modal"

interface PopularApp {
  name: string
  category: string
  price: string
  icon: string
  color: string
  description: string
  billingCycle: string
  difficulty?: "easy" | "medium" | "hard"
}

const POPULAR_APPS: PopularApp[] = [
  {
    name: "Netflix",
    category: "Entertainment",
    price: "15.49",
    icon: "📺",
    color: "#E50914",
    description: "Streaming movies and TV shows",
    billingCycle: "monthly",
    difficulty: "easy"
  },
  {
    name: "Spotify",
    category: "Entertainment",
    price: "10.99",
    icon: "🎵",
    color: "#1DB954",
    description: "Music streaming service",
    billingCycle: "monthly",
    difficulty: "easy"
  },
  {
    name: "ChatGPT Plus",
    category: "AI Tools",
    price: "20.00",
    icon: "🤖",
    color: "#10A37F",
    description: "AI-powered conversations",
    billingCycle: "monthly",
    difficulty: "easy"
  },
  {
    name: "Adobe Creative Cloud",
    category: "Productivity",
    price: "54.99",
    icon: "🎨",
    color: "#FF0000",
    description: "Creative software suite",
    billingCycle: "monthly",
    difficulty: "medium"
  },
  {
    name: "Microsoft 365",
    category: "Productivity",
    price: "12.99",
    icon: "📊",
    color: "#0078D4",
    description: "Office apps and cloud storage",
    billingCycle: "monthly",
    difficulty: "easy"
  },
  {
    name: "Disney+",
    category: "Entertainment",
    price: "13.99",
    icon: "🏰",
    color: "#113CCF",
    description: "Disney content streaming",
    billingCycle: "monthly",
    difficulty: "easy"
  }
]

interface EmptyStateExperienceProps {
  onAddSubscription: (subscription: any) => void
  darkMode?: boolean
}

export default function EmptyStateExperience({ 
  onAddSubscription, 
  darkMode = false 
}: EmptyStateExperienceProps) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedApp, setSelectedApp] = useState<PopularApp | null>(null)

  const handleQuickAdd = (app: PopularApp) => {
    setSelectedApp(app)
    setShowAddModal(true)
  }

  const handleAddSubscription = (subscription: any) => {
    onAddSubscription(subscription)
    setShowAddModal(false)
    setSelectedApp(null)
  }

  const baseClasses = darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"
  const cardClasses = darkMode 
    ? "bg-[#2D3748] border-[#374151] hover:border-[#FFD166]/60" 
    : "bg-white border-gray-200 hover:border-[#FFD166]/60"
  const mutedClasses = darkMode ? "text-gray-400" : "text-gray-600"

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-[#FFD166] to-[#FFA500] rounded-3xl mb-6">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
          <h1 className={`text-4xl md:text-5xl font-bold ${baseClasses} mb-4`}>
            Welcome to Syncro
          </h1>
          <p className={`text-xl ${mutedClasses} max-w-2xl mx-auto mb-8`}>
            Start tracking your subscriptions in seconds. Add your first apps and take control of your monthly spending.
          </p>
          
          {/* Stats Pills */}
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${darkMode ? "bg-[#1E2A35]" : "bg-gray-100"}`}>
              <Zap className="w-4 h-4 text-[#FFD166]" />
              <span className={`text-sm font-medium ${baseClasses}`}>10-Second Setup</span>
            </div>
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${darkMode ? "bg-[#1E2A35]" : "bg-gray-100"}`}>
              <Shield className="w-4 h-4 text-[#007A5C]" />
              <span className={`text-sm font-medium ${baseClasses}`}>Secure Tracking</span>
            </div>
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${darkMode ? "bg-[#1E2A35]" : "bg-gray-100"}`}>
              <TrendingUp className="w-4 h-4 text-[#E86A33]" />
              <span className={`text-sm font-medium ${baseClasses}`}>Spending Insights</span>
            </div>
          </div>

          <div className={`inline-flex items-center gap-2 px-6 py-3 bg-[#FFD166] text-[#1E2A35] rounded-full font-semibold mb-8`}>
            <span className="text-sm">Goal: Add 3 subscriptions in 10 seconds ⚡</span>
          </div>
        </div>

        {/* Popular Apps Grid */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className={`text-2xl font-bold ${baseClasses}`}>Popular Apps</h2>
            <button
              onClick={() => setShowAddModal(true)}
              className={`flex items-center gap-2 px-4 py-2 border-2 ${
                darkMode ? "border-[#374151] hover:border-[#FFD166]" : "border-gray-300 hover:border-[#1E2A35]"
              } rounded-lg transition-colors`}
            >
              <Plus className="w-4 h-4" />
              <span className={`text-sm font-medium ${baseClasses}`}>Browse All</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {POPULAR_APPS.map((app) => (
              <button
                key={app.name}
                onClick={() => handleQuickAdd(app)}
                className={`p-6 rounded-xl border-2 transition-all text-left ${cardClasses} group hover:shadow-lg`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                    style={{ backgroundColor: `${app.color}20` }}
                  >
                    {app.icon}
                  </div>
                  <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                    app.difficulty === "easy" ? "bg-green-100 text-green-700" :
                    app.difficulty === "medium" ? "bg-yellow-100 text-yellow-700" :
                    "bg-red-100 text-red-700"
                  }`}>
                    {app.difficulty === "easy" ? "Easy to cancel" :
                     app.difficulty === "medium" ? "Moderate" : "Hard to cancel"}
                  </div>
                </div>
                
                <h3 className={`font-semibold text-lg mb-1 ${baseClasses}`}>{app.name}</h3>
                <p className={`text-sm ${mutedClasses} mb-3`}>{app.description}</p>
                
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-lg font-bold ${baseClasses}`}>${app.price}</span>
                    <span className={`text-sm ${mutedClasses}`}>/{app.billingCycle === "monthly" ? "mo" : "yr"}</span>
                  </div>
                  <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
                    <span className={`text-sm font-medium text-[#FFD166]`}>Quick Add</span>
                    <ArrowRight className="w-4 h-4 text-[#FFD166]" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Call to Action */}
        <div className={`text-center p-8 rounded-2xl ${darkMode ? "bg-[#2D3748]" : "bg-white"} border-2 border-dashed ${
          darkMode ? "border-[#374151]" : "border-gray-300"
        }`}>
          <h3 className={`text-xl font-semibold ${baseClasses} mb-2`}>
            Don't see your subscription?
          </h3>
          <p className={`${mutedClasses} mb-4`}>
            Browse our full catalog of 100+ services or add custom subscriptions manually.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add Custom Subscription
          </button>
        </div>
      </div>

      {/* Add Subscription Modal */}
      {showAddModal && (
        <AddSubscriptionModal
          onAdd={handleAddSubscription}
          onClose={() => {
            setShowAddModal(false)
            setSelectedApp(null)
          }}
          darkMode={darkMode}
        />
      )}
    </div>
  )
}
