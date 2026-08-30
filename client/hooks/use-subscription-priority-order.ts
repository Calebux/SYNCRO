"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  fetchUserPreferences,
  updateUserPreferences,
} from "@/lib/api/user-preferences"
import { normalizePriorityOrder } from "@/lib/subscription-priority-order"

interface UseSubscriptionPriorityOrderOptions {
  subscriptionIds: string[]
}

interface UseSubscriptionPriorityOrderReturn {
  priorityOrder: string[]
  isLoading: boolean
  isSaving: boolean
  reorder: (fromIndex: number, toIndex: number, contextIds: string[]) => void
  moveByKeyboard: (index: number, direction: "up" | "down", contextIds: string[]) => void
}

export function useSubscriptionPriorityOrder({
  subscriptionIds,
}: UseSubscriptionPriorityOrderOptions): UseSubscriptionPriorityOrderReturn {
  const [priorityOrder, setPriorityOrder] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadOrder() {
      setIsLoading(true)
      try {
        const prefs = await fetchUserPreferences()
        if (cancelled) return
        const saved = prefs.subscription_priority_order ?? []
        const normalized = normalizePriorityOrder(saved, subscriptionIds)
        setPriorityOrder(normalized)
      } catch (error) {
        console.error("Failed to load subscription priority order:", error)
        if (!cancelled) {
          setPriorityOrder(normalizePriorityOrder([], subscriptionIds))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadOrder()
    return () => {
      cancelled = true
    }
  }, [subscriptionIds.join(",")])

  const persistOrder = useCallback((order: string[]) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(async () => {
      setIsSaving(true)
      try {
        await updateUserPreferences({ subscription_priority_order: order })
      } catch (error) {
        console.error("Failed to save subscription priority order:", error)
      } finally {
        setIsSaving(false)
      }
    }, 400)
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const applyReorder = useCallback(
    (fromIndex: number, toIndex: number, contextIds: string[]) => {
      setPriorityOrder((current) => {
        const normalized = normalizePriorityOrder(current, subscriptionIds)
        const contextOrder = contextIds.filter((id) => normalized.includes(id))
        const fromId = contextOrder[fromIndex]
        const toId = contextOrder[toIndex]

        if (!fromId || !toId) {
          return normalized
        }

        const fromGlobal = normalized.indexOf(fromId)
        const toGlobal = normalized.indexOf(toId)
        const next = [...normalized]
        next.splice(fromGlobal, 1)
        next.splice(toGlobal, 0, fromId)

        persistOrder(next)
        return next
      })
    },
    [persistOrder, subscriptionIds],
  )

  const moveByKeyboard = useCallback(
    (index: number, direction: "up" | "down", contextIds: string[]) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= contextIds.length) {
        return
      }
      applyReorder(index, targetIndex, contextIds)
    },
    [applyReorder],
  )

  return {
    priorityOrder,
    isLoading,
    isSaving,
    reorder: applyReorder,
    moveByKeyboard,
  }
}
