"use client"

import { X, RotateCcw, Trash2 } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface DeletedSubscription {
  subscription: {
    id: number
    name: string
    icon?: string
  }
  deletedAt: number
}

interface UndoPanelProps {
  deletedSubscriptions: DeletedSubscription[]
  onRestore: (id: number) => void
  onClose: () => void
  onClear: () => void
  darkMode?: boolean
}

export default function UndoPanel({
  deletedSubscriptions,
  onRestore,
  onClose,
  onClear,
  darkMode,
}: UndoPanelProps) {
  return (
    <div
      className={`fixed right-0 top-0 h-full w-80 ${
        darkMode ? "bg-[#2D3748] border-[#374151]" : "bg-white border-gray-200"
      } border-l shadow-lg z-40 flex flex-col`}
    >
      <div
        className={`flex items-center justify-between p-6 border-b ${
          darkMode ? "border-[#374151]" : "border-gray-200"
        }`}
      >
        <h3
          className={`text-lg font-semibold ${
            darkMode ? "text-white" : "text-gray-900"
          }`}
        >
          Recently Deleted
        </h3>
        <button
          onClick={onClose}
          className={`p-1 ${
            darkMode ? "hover:bg-[#374151]" : "hover:bg-gray-100"
          } rounded-lg`}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {deletedSubscriptions.length > 0 && (
        <div className="p-4 border-b border-gray-200 dark:border-[#374151]">
          <button
            onClick={onClear}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm ${
              darkMode
                ? "bg-[#374151] text-gray-300 hover:bg-[#4A5568]"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <Trash2 className="w-4 h-4" />
            Clear All
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {deletedSubscriptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div
              className={`text-4xl mb-4 ${
                darkMode ? "text-gray-500" : "text-gray-400"
              }`}
            >
              🗑️
            </div>
            <p
              className={`text-sm ${
                darkMode ? "text-gray-400" : "text-gray-500"
              }`}
            >
              No recently deleted items
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {deletedSubscriptions.map((item) => (
              <div
                key={item.subscription.id}
                className={`p-3 rounded-lg border ${
                  darkMode
                    ? "bg-[#1E2A35] border-[#374151]"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">{item.subscription.icon || "📦"}</span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium truncate ${
                        darkMode ? "text-white" : "text-gray-900"
                      }`}
                    >
                      {item.subscription.name}
                    </p>
                    <p
                      className={`text-xs ${
                        darkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      Deleted{" "}
                      {formatDistanceToNow(item.deletedAt, { addSuffix: true })}
                    </p>
                  </div>
                  <button
                    onClick={() => onRestore(item.subscription.id)}
                    className={`p-2 rounded-lg text-sm font-medium ${
                      darkMode
                        ? "bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"
                        : "bg-[#1E2A35] text-white hover:bg-[#2D3748]"
                    }`}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}