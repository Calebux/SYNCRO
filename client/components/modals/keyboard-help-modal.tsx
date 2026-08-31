"use client"

import { useEffect } from "react"
import { X, Keyboard } from "lucide-react"

interface ShortcutRow {
  keys: string[]
  description: string
}

const SHORTCUT_GROUPS: { heading: string; shortcuts: ShortcutRow[] }[] = [
  {
    heading: "Navigation",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Open command palette" },
      { keys: ["⌘", "N"], description: "Add new subscription" },
      { keys: ["/"], description: "Focus search" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
    ],
  },
  {
    heading: "Subscription priority",
    shortcuts: [
      { keys: ["Drag"], description: "Reorder cards by personal priority" },
      { keys: ["Space"], description: "Pick up / drop focused card (keyboard drag)" },
      { keys: ["↑", "↓"], description: "Move card while dragging with keyboard" },
    ],
  },
  {
    heading: "Filters",
    shortcuts: [
      { keys: ["Esc"], description: "Clear all filters / close modal" },
    ],
  },
]

interface KeyboardHelpModalProps {
  onClose: () => void
  darkMode?: boolean
}

export function KeyboardHelpModal({ onClose, darkMode }: KeyboardHelpModalProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-help-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={`${
          darkMode ? "bg-[#1E2A35] text-white border-[#374151]" : "bg-white text-gray-900 border-gray-200"
        } border rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200`}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${darkMode ? "bg-[#2D3748]" : "bg-gray-100"}`}>
              <Keyboard className="w-5 h-5" aria-hidden="true" />
            </div>
            <h2 id="keyboard-help-title" className="text-lg font-bold">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? "hover:bg-[#2D3748] text-gray-400 hover:text-white" : "hover:bg-gray-100 text-gray-500 hover:text-gray-900"
            }`}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Shortcut groups */}
        <div className="space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.heading}>
              <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
                {group.heading}
              </p>
              <div className="space-y-1">
                {group.shortcuts.map((row) => (
                  <div key={row.description} className="flex items-center justify-between py-1.5">
                    <span className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                      {row.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {row.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className={`inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 rounded text-xs font-mono font-medium border ${
                            darkMode
                              ? "bg-[#2D3748] border-[#4A5568] text-gray-200"
                              : "bg-gray-100 border-gray-300 text-gray-700"
                          }`}
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <p className={`mt-6 text-xs text-center ${darkMode ? "text-gray-600" : "text-gray-400"}`}>
          Press <kbd className={`inline px-1 py-0.5 rounded text-xs font-mono border ${darkMode ? "bg-[#2D3748] border-[#4A5568]" : "bg-gray-100 border-gray-300"}`}>?</kbd> anytime to show this panel
        </p>
      </div>
    </div>
  )
}
