"use client"

import { AlertTriangle } from "lucide-react"

interface ConfirmationDialogProps {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "danger" | "warning" | "default"
  onConfirm: () => void
  onCancel: () => void
  darkMode?: boolean
}

export function ConfirmationDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
  darkMode,
}: ConfirmationDialogProps) {
  const confirmButtonStyles = {
    danger: "bg-[#E86A33] hover:bg-[#E86A33]/90 text-white",
    warning: "bg-[#FFD166] hover:bg-[#FFD166]/90 text-[#1E2A35]",
    default: darkMode
      ? "bg-[#FFD166] hover:bg-[#FFD166]/90 text-[#1E2A35]"
      : "bg-[#1E2A35] hover:bg-[#2D3748] text-white",
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} rounded-xl p-6 max-w-md w-full shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 mb-4">
          {variant !== "default" && (
            <div className={`${variant === "danger" ? "text-[#E86A33]" : "text-[#FFD166]"}`}>
              <AlertTriangle className="w-6 h-6" />
            </div>
          )}
          <div className="flex-1">
            <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"} mb-2`}>{title}</h3>
            <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>{description}</p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              darkMode ? "bg-[#374151] text-gray-300 hover:bg-[#4B5563]" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${confirmButtonStyles[variant]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
