"use client"

import { useState, useEffect, useCallback } from "react"

interface Mutation {
  id: string
  type: "create" | "update" | "delete"
  entity: "subscription"
  payload: Record<string, unknown>
  timestamp: string
  attempts: number
}

interface UseMutationQueueResult {
  isOnline: boolean
  pendingMutations: Mutation[]
  queueMutation: (
    type: "create" | "update" | "delete",
    payload: Record<string, unknown>
  ) => Promise<void>
  processQueue: () => Promise<void>
}

export function useMutationQueue(): UseMutationQueueResult {
  const [isOnline, setIsOnline] = useState(() => 
    typeof navigator !== "undefined" ? navigator.onLine : true
  )
  const [pendingMutations, setPendingMutations] = useState<Mutation[]>([])

  useEffect(() => {
    const updateOnlineStatus = () => {
      const online = navigator.onLine
      setIsOnline(online)
      if (online) {
        processQueue()
      }
    }

    const loadMutations = async () => {
      try {
        const db = await openIndexedDB()
        const tx = db.transaction('pending-mutations', 'readonly')
        const store = tx.objectStore('pending-mutations')
        const request = store.getAll()
        
        request.onsuccess = () => {
          setPendingMutations(request.result)
        }
      } catch {
        // Ignore errors
      }
    }

    window.addEventListener("online", updateOnlineStatus)
    window.addEventListener("offline", updateOnlineStatus)
    
    loadMutations()

    return () => {
      window.removeEventListener("online", updateOnlineStatus)
      window.removeEventListener("offline", updateOnlineStatus)
    }
  }, [])

  const openIndexedDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('syncro-offline', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  const queueMutation = useCallback(
    async (
      type: "create" | "update" | "delete",
      payload: Record<string, unknown>
    ) => {
      const mutation: Mutation = {
        id: crypto.randomUUID(),
        type,
        entity: "subscription",
        payload,
        timestamp: new Date().toISOString(),
        attempts: 0,
      }
      
      try {
        const db = await openIndexedDB()
        const tx = db.transaction('pending-mutations', 'readwrite')
        const store = tx.objectStore('pending-mutations')
        await store.add(mutation)
        setPendingMutations(prev => [...prev, mutation])
      } catch {
        // Ignore errors - localStorage fallback in offline-cache.ts
      }

      // If online, trigger sync
      if (isOnline && "serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller?.postMessage({ type: "SYNCRO_TRIGGER_SYNC" })
      }
    },
    [isOnline]
  )

  const processQueue = useCallback(async () => {
    try {
      const mutations = [...pendingMutations]
      
      for (const mutation of mutations) {
        try {
          let response: Response
          
          if (mutation.type === "create") {
            response = await fetch("/api/subscriptions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(mutation.payload),
            })
          } else if (mutation.type === "update") {
            const id = mutation.payload.id as string
            response = await fetch(`/api/subscriptions/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(mutation.payload),
            })
          } else if (mutation.type === "delete") {
            const id = mutation.payload.id as string
            response = await fetch(`/api/subscriptions/${id}`, {
              method: "DELETE",
            })
          } else {
            continue
          }

          if (response.ok) {
            // Remove successfully processed mutation from IndexedDB
            try {
              const db = await openIndexedDB()
              const tx = db.transaction('pending-mutations', 'readwrite')
              const store = tx.objectStore('pending-mutations')
              await store.delete(mutation.id)
            } catch {
              // Ignore IndexedDB errors
            }
            setPendingMutations(prev => prev.filter(m => m.id !== mutation.id))
          } else if (response.status === 409) {
            // Conflict detected - handle conflict
            const data = await response.json()
            setPendingMutations(prev => {
              const index = prev.findIndex(m => m.id === mutation.id)
              if (index > -1) {
                prev[index].attempts += 1
                if (prev[index].attempts >= 3) {
                  // Remove after 3 failed attempts
                  return prev.filter(m => m.id !== mutation.id)
                }
              }
              return [...prev]
            })
          }
        } catch {
          // Network error, will retry later
        }
      }
    } catch {
      // Ignore errors
    }
  }, [pendingMutations])

  return {
    isOnline,
    pendingMutations,
    queueMutation,
    processQueue,
  }
}