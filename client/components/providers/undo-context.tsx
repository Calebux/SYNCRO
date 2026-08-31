"use client"

import { createContext, useContext, useState, useCallback } from "react"
import type { Subscription } from "@/lib/supabase/subscriptions"

interface DeletedSubscription {
  subscription: Subscription
  deletedAt: number
}

interface UndoContextType {
  deletedSubscriptions: DeletedSubscription[]
  addDeletedSubscription: (subscription: Subscription) => void
  removeDeletedSubscription: (id: number) => void
  restoreSubscription: (id: number) => Subscription | null
  clearDeletedSubscriptions: () => void
}

const UndoContext = createContext<UndoContextType | undefined>(undefined)

const MAX_DELETED_ITEMS = 10
const DELETION_EXPIRY_MS = 60000 // 60 seconds

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [deletedSubscriptions, setDeletedSubscriptions] = useState<DeletedSubscription[]>([])

  const addDeletedSubscription = useCallback((subscription: Subscription) => {
    setDeletedSubscriptions((prev) => {
      const newDeleted = [...prev, { subscription, deletedAt: Date.now() }]
      if (newDeleted.length > MAX_DELETED_ITEMS) {
        return newDeleted.slice(-MAX_DELETED_ITEMS)
      }
      return newDeleted
    })
  }, [])

  const removeDeletedSubscription = useCallback((id: number) => {
    setDeletedSubscriptions((prev) => prev.filter((d) => d.subscription.id !== id))
  }, [])

  const restoreSubscription = useCallback((id: number): Subscription | null => {
    let restored: Subscription | null = null
    setDeletedSubscriptions((prev) => {
      const found = prev.find((d) => d.subscription.id === id)
      if (found) {
        restored = found.subscription
        return prev.filter((d) => d.subscription.id !== id)
      }
      return prev
    })
    return restored
  }, [])

  const clearDeletedSubscriptions = useCallback(() => {
    setDeletedSubscriptions([])
  }, [])

  return (
    <UndoContext.Provider
      value={{
        deletedSubscriptions,
        addDeletedSubscription,
        removeDeletedSubscription,
        restoreSubscription,
        clearDeletedSubscriptions,
      }}
    >
      {children}
    </UndoContext.Provider>
  )
}

export function useUndoContext() {
  const context = useContext(UndoContext)
  if (!context) {
    throw new Error("useUndoContext must be used within UndoProvider")
  }
  return context
}