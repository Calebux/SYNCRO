"use client"
import {
  X,
  Plus,
  RefreshCw,
  PauseCircle,
  Clock,
  TrendingUp,
  Calendar,
  AlertTriangle,
  Lightbulb,
  Search,
  Info,
} from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export default function NotificationsPanel({
  notifications,
  onMarkRead,
  onClose,
  onAddSubscription,
  darkMode,
  onResolveAction,
}) {
  const getNotificationIcon = (type) => {
    const iconClass = "w-5 h-5"
    switch (type) {
      case "duplicate":
        return <RefreshCw className={iconClass} />
      case "unused":
        return <PauseCircle className={iconClass} />
      case "trial":
        return <Clock className={iconClass} />
      case "price_change":
        return <TrendingUp className={iconClass} />
      case "renewal":
        return <Calendar className={iconClass} />
      case "budget":
        return <AlertTriangle className={iconClass} />
      case "consolidation":
        return <Lightbulb className={iconClass} />
      case "alert":
        return <Search className={iconClass} />
      default:
        return <Info className={iconClass} />
    }
  }

  if (!notifications || notifications.length === 0) {
    return (
      <div
        className={`fixed right-0 top-0 h-full w-96 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border-l shadow-lg z-40 flex flex-col`}
      >
        <div
          className={`flex items-center justify-between p-6 border-b ${darkMode ? "border-[#374151]" : "border-gray-200"}`}
        >
          <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Notifications</h3>
          <button
            onClick={onClose}
            className={`p-1 ${darkMode ? "hover:bg-[#374151]" : "hover:bg-gray-100"} rounded-lg`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="🔔"
            title="No notifications"
            description="You're all caught up! We'll notify you when there's something new."
            darkMode={darkMode}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`fixed right-0 top-0 h-full w-96 ${darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"} border-l shadow-lg z-40 flex flex-col`}
    >
      <div
        className={`flex items-center justify-between p-6 border-b ${darkMode ? "border-[#374151]" : "border-gray-200"}`}
      >
        <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Notifications</h3>
        <button onClick={onClose} className={`p-1 ${darkMode ? "hover:bg-[#374151]" : "hover:bg-gray-100"} rounded-lg`}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="space-y-2 p-4">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`p-4 rounded-lg border transition-colors ${
                notification.read
                  ? darkMode
                    ? "bg-[#1E2A35] border-[#374151]"
                    : "bg-gray-50 border-gray-200"
                  : darkMode
                    ? "bg-[#FFD166]/10 border-[#FFD166]"
                    : "bg-blue-50 border-blue-200"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 ${darkMode ? "text-[#FFD166]" : "text-[#1E2A35]"}`}>
                  {getNotificationIcon(notification.type)}
                </div>
                {/* </CHANGE> */}
                <div className="flex-1">
                  <h4 className={`font-semibold text-sm ${darkMode ? "text-white" : "text-gray-900"}`}>
                    {notification.title}
                  </h4>
                  <p className={`text-xs mt-1 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                    {notification.description}
                  </p>

                  {notification.type === "alert" && notification.detectedSubscription && (
                    <button
                      onClick={() => {
                        onAddSubscription(notification.detectedSubscription)
                        onMarkRead(notification.id)
                      }}
                      className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-[#FFD166] text-[#1E2A35] rounded-lg text-xs font-semibold hover:bg-[#FFD166]/90 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add to Dashboard
                    </button>
                  )}

                  {notification.type === "duplicate" && notification.duplicateInfo && (
                    <button
                      onClick={() => {
                        onResolveAction?.("resolve_duplicate", notification.duplicateInfo)
                        onMarkRead(notification.id)
                      }}
                      className="mt-3 px-3 py-1.5 bg-[#007A5C] text-white rounded-lg text-xs font-semibold hover:bg-[#007A5C]/90 transition-colors"
                    >
                      Resolve Duplicate
                    </button>
                  )}

                  {notification.type === "unused" && notification.subscriptionId && (
                    <button
                      onClick={() => {
                        onResolveAction?.("cancel_unused", notification.subscriptionId)
                        onMarkRead(notification.id)
                      }}
                      className="mt-3 px-3 py-1.5 bg-[#E86A33] text-white rounded-lg text-xs font-semibold hover:bg-[#E86A33]/90 transition-colors"
                    >
                      Cancel Subscription
                    </button>
                  )}

                  {notification.type === "trial" && notification.subscriptionId && (
                    <button
                      onClick={() => {
                        onResolveAction?.("cancel_trial", notification.subscriptionId)
                        onMarkRead(notification.id)
                      }}
                      className="mt-3 px-3 py-1.5 bg-[#E86A33] text-white rounded-lg text-xs font-semibold hover:bg-[#E86A33]/90 transition-colors"
                    >
                      Cancel Before Charge
                    </button>
                  )}

                  {notification.type === "consolidation" && notification.suggestionId && (
                    <button
                      onClick={() => {
                        onResolveAction?.("view_consolidation", notification.suggestionId)
                        onMarkRead(notification.id)
                      }}
                      className="mt-3 px-3 py-1.5 bg-[#007A5C] text-white rounded-lg text-xs font-semibold hover:bg-[#007A5C]/90 transition-colors"
                    >
                      View Details
                    </button>
                  )}
                </div>
                {!notification.read && (
                  <button
                    onClick={() => onMarkRead(notification.id)}
                    className={`w-2 h-2 ${darkMode ? "bg-[#FFD166]" : "bg-blue-600"} rounded-full mt-1 flex-shrink-0 cursor-pointer hover:scale-110 transition-transform`}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`p-4 border-t ${darkMode ? "border-[#374151]" : "border-gray-200"}`}>
        <button
          onClick={() => notifications.forEach((n) => onMarkRead(n.id))}
          className={`w-full py-2 text-sm font-medium ${darkMode ? "text-gray-300 hover:bg-[#374151]" : "text-gray-700 hover:bg-gray-50"} rounded-lg transition-colors`}
        >
          Mark all as read
        </button>
      </div>
    </div>
  )
}
