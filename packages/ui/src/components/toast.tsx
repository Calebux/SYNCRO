"use client"

import type * as React from "react"
import { X } from "lucide-react"
import { createContext, useContext, useState, useCallback } from "react"

interface ToastProps {
  title: string
  description?: string
  variant?: "default" | "success" | "error" | "warning"
  onClose: () => void
  action?: {
    label: string
    onClick: () => void
  }
}

export function Toast({ title, description, variant = "default", onClose, action }: ToastProps) {
  const variantStyles = {
    default: "bg-gray-900 text-white",
    success: "bg-[#007A5C] text-white",
    error: "bg-[#E86A33] text-white",
    warning: "bg-[#FFD166] text-[#1E2A35]",
  }

  return (
    <div className={`${variantStyles[variant]} rounded-lg shadow-lg p-4 min-w-80 max-w-md`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="font-semibold text-sm">{title}</p>
          {description && <p className="text-xs opacity-90 mt-1">{description}</p>}
          {action && (
            <button onClick={action.onClick} className="text-xs font-semibold underline mt-2 hover:opacity-80">
              {action.label}
            </button>
          )}
        </div>
        <button onClick={onClose} className="hover:opacity-80">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export function ToastContainer({ children }: { children: React.ReactNode }) {
  return <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">{children}</div>
}

interface ToastData {
  id: string
  title: string
  description?: string
  variant?: "default" | "success" | "error" | "warning"
  action?: {
    label: string
    onClick: () => void
  }
}

interface ToastContextType {
  toasts: ToastData[]
  addToast: (toast: Omit<ToastData, "id">) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const addToast = useCallback((toast: Omit<ToastData, "id">) => {
    const id = Math.random().toString(36).substring(7)
    setToasts((prev) => [...prev, { ...toast, id }])

    // Auto-remove toast after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            title={toast.title}
            description={toast.description}
            variant={toast.variant}
            action={toast.action}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </ToastContainer>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return context
}

// Helper function for direct toast usage without context
let globalAddToast: ((toast: Omit<ToastData, "id">) => void) | null = null

export function setGlobalToastHandler(handler: (toast: Omit<ToastData, "id">) => void) {
  globalAddToast = handler
}

export function showToast(toast: Omit<ToastData, "id">) {
  if (globalAddToast) {
    globalAddToast(toast)
  } else {
    console.warn("Toast system not initialized. Wrap your app with ToastProvider.")
  }
}
