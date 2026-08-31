const DB_NAME = "syncro-offline"
const DB_VERSION = 2
const SUBSCRIPTIONS_STORE = "subscriptions"
const PENDING_MUTATIONS_STORE = "pending-mutations"

interface Subscription {
  id: string
  name: string
  status: string
  billing_cycle: string
  next_renewal: string | null
  price: number
  category: string | null
  updated_at: string
}

interface PendingMutation {
  id: string
  type: "create" | "update" | "delete"
  entity: "subscription"
  payload: Record<string, unknown>
  timestamp: string
  attempts: number
}

class IndexedDBManager {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null

  async init(): Promise<IDBDatabase> {
    if (typeof window === "undefined") {
      throw new Error("IndexedDB is only available in browser environment")
    }
    if (this.db) return this.db
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        if (!db.objectStoreNames.contains(SUBSCRIPTIONS_STORE)) {
          const subStore = db.createObjectStore(SUBSCRIPTIONS_STORE, { keyPath: "id" })
          subStore.createIndex("status", "status", { unique: false })
          subStore.createIndex("updated_at", "updated_at", { unique: false })
        }

        if (!db.objectStoreNames.contains(PENDING_MUTATIONS_STORE)) {
          const mutationStore = db.createObjectStore(PENDING_MUTATIONS_STORE, { keyPath: "id" })
          mutationStore.createIndex("timestamp", "timestamp", { unique: false })
        }
      }
    })

    return this.initPromise
  }

  async putSubscription(sub: Subscription): Promise<void> {
    const db = await this.init()
    const tx = db.transaction(SUBSCRIPTIONS_STORE, "readwrite")
    const store = tx.objectStore(SUBSCRIPTIONS_STORE)
    await store.put(sub)
  }

  async getAllSubscriptions(): Promise<Subscription[]> {
    const db = await this.init()
    const tx = db.transaction(SUBSCRIPTIONS_STORE, "readonly")
    const store = tx.objectStore(SUBSCRIPTIONS_STORE)
    return await new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async clearSubscriptions(): Promise<void> {
    const db = await this.init()
    const tx = db.transaction(SUBSCRIPTIONS_STORE, "readwrite")
    const store = tx.objectStore(SUBSCRIPTIONS_STORE)
    await store.clear()
  }

  async addPendingMutation(mutation: Omit<PendingMutation, "id" | "timestamp" | "attempts">): Promise<void> {
    const db = await this.init()
    const tx = db.transaction(PENDING_MUTATIONS_STORE, "readwrite")
    const store = tx.objectStore(PENDING_MUTATIONS_STORE)
    const fullMutation: PendingMutation = {
      ...mutation,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      attempts: 0,
    }
    await store.add(fullMutation)
  }

  async getPendingMutations(): Promise<PendingMutation[]> {
    const db = await this.init()
    const tx = db.transaction(PENDING_MUTATIONS_STORE, "readonly")
    const store = tx.objectStore(PENDING_MUTATIONS_STORE)
    return await new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async removePendingMutation(id: string): Promise<void> {
    const db = await this.init()
    const tx = db.transaction(PENDING_MUTATIONS_STORE, "readwrite")
    const store = tx.objectStore(PENDING_MUTATIONS_STORE)
    await store.delete(id)
  }

  async clearPendingMutations(): Promise<void> {
    const db = await this.init()
    const tx = db.transaction(PENDING_MUTATIONS_STORE, "readwrite")
    const store = tx.objectStore(PENDING_MUTATIONS_STORE)
    await store.clear()
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

const dbManager = new IndexedDBManager()

export async function initIndexedDB(): Promise<IDBDatabase> {
  return dbManager.init()
}

export async function cacheSubscriptions(subscriptions: Subscription[]): Promise<void> {
  await dbManager.clearSubscriptions()
  for (const sub of subscriptions) {
    await dbManager.putSubscription({ ...sub, updated_at: new Date().toISOString() })
  }
}

export async function getCachedSubscriptions(): Promise<Subscription[]> {
  return dbManager.getAllSubscriptions()
}

export async function addOfflineMutation(
  type: "create" | "update" | "delete",
  payload: Record<string, unknown>
): Promise<void> {
  await dbManager.addPendingMutation({
    type,
    entity: "subscription",
    payload,
  })
}

export async function getOfflineMutations(): Promise<PendingMutation[]> {
  return dbManager.getPendingMutations()
}

export async function clearOfflineMutations(): Promise<void> {
  await dbManager.clearPendingMutations()
}

export async function removeOfflineMutation(id: string): Promise<void> {
  await dbManager.removePendingMutation(id)
}

export type { Subscription, PendingMutation }