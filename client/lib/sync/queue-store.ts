/**
 * IndexedDB persistence layer for durable mutation queue
 * 
 * Stores queued mutations durably so they survive page reloads,
 * browser crashes, and network disconnections.
 */

import type { QueuedMutation } from './mutation-queue'

const DB_NAME = 'syncro-queue'
const DB_VERSION = 1
const STORE_NAME = 'mutations'

export interface QueueStoreResult<T> {
  success: boolean
  data?: T
  error?: string
}

class QueueStore {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null

  async init(): Promise<IDBDatabase> {
    if (typeof window === 'undefined') {
      throw new Error('QueueStore only works in browser')
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

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          
          // Indices for efficient querying
          store.createIndex('status', 'status', { unique: false })
          store.createIndex('operation', ['operation.operation', 'operation.resource'], { unique: false })
          store.createIndex('expiresAt', 'expiresAt', { unique: false })
          store.createIndex('attempts', 'attempts', { unique: false })
        }
      }
    })

    return this.initPromise
  }

  async addMutation(mutation: QueuedMutation): Promise<QueueStoreResult<string>> {
    try {
      const db = await this.init()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      
      await new Promise<void>((resolve, reject) => {
        const request = store.add(mutation)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })

      return { success: true, data: mutation.id }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add mutation',
      }
    }
  }

  async updateMutation(mutation: QueuedMutation): Promise<QueueStoreResult<void>> {
    try {
      const db = await this.init()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      
      await new Promise<void>((resolve, reject) => {
        const request = store.put(mutation)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update mutation',
      }
    }
  }

  async removeMutation(id: string): Promise<QueueStoreResult<void>> {
    try {
      const db = await this.init()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(id)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove mutation',
      }
    }
  }

  async getMutation(id: string): Promise<QueueStoreResult<QueuedMutation>> {
    try {
      const db = await this.init()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      
      const mutation = await new Promise<QueuedMutation | undefined>((resolve, reject) => {
        const request = store.get(id)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })

      if (!mutation) {
        return { success: false, error: 'Mutation not found' }
      }

      return { success: true, data: mutation }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get mutation',
      }
    }
  }

  async getMutationsByStatus(status: string): Promise<QueueStoreResult<QueuedMutation[]>> {
    try {
      const db = await this.init()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const index = store.index('status')
      
      const mutations = await new Promise<QueuedMutation[]>((resolve, reject) => {
        const request = index.getAll(status)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })

      return { success: true, data: mutations }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get mutations',
      }
    }
  }

  async getPendingMutations(): Promise<QueueStoreResult<QueuedMutation[]>> {
    try {
      const db = await this.init()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      
      const mutations = await new Promise<QueuedMutation[]>((resolve, reject) => {
        const request = store.getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const all = request.result as QueuedMutation[]
          // Return non-terminal mutations in order
          const pending = all.filter(m => !['resolved', 'failed', 'expired'].includes(m.status))
          resolve(pending.sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()))
        }
      })

      return { success: true, data: mutations }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get pending mutations',
      }
    }
  }

  async getAllMutations(): Promise<QueueStoreResult<QueuedMutation[]>> {
    try {
      const db = await this.init()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      
      const mutations = await new Promise<QueuedMutation[]>((resolve, reject) => {
        const request = store.getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const all = request.result as QueuedMutation[]
          resolve(all.sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()))
        }
      })

      return { success: true, data: mutations }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get mutations',
      }
    }
  }

  async clearExpired(): Promise<QueueStoreResult<number>> {
    try {
      const db = await this.init()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      
      const mutations = await new Promise<QueuedMutation[]>((resolve, reject) => {
        const request = store.getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })

      const now = new Date()
      let cleared = 0
      for (const mutation of mutations) {
        if (new Date(mutation.expiresAt) < now) {
          await new Promise<void>((resolve, reject) => {
            const request = store.delete(mutation.id)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              cleared++
              resolve()
            }
          })
        }
      }

      return { success: true, data: cleared }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear expired',
      }
    }
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

const store = new QueueStore()

export async function initQueueStore(): Promise<void> {
  await store.init()
}

export async function queueMutation(mutation: QueuedMutation): Promise<QueueStoreResult<string>> {
  return store.addMutation(mutation)
}

export async function updateQueuedMutation(mutation: QueuedMutation): Promise<QueueStoreResult<void>> {
  return store.updateMutation(mutation)
}

export async function removeQueuedMutation(id: string): Promise<QueueStoreResult<void>> {
  return store.removeMutation(id)
}

export async function getQueuedMutation(id: string): Promise<QueueStoreResult<QueuedMutation>> {
  return store.getMutation(id)
}

export async function getPendingMutations(): Promise<QueueStoreResult<QueuedMutation[]>> {
  return store.getPendingMutations()
}

export async function getAllQueuedMutations(): Promise<QueueStoreResult<QueuedMutation[]>> {
  return store.getAllMutations()
}

export async function clearExpiredMutations(): Promise<QueueStoreResult<number>> {
  return store.clearExpired()
}

export function closeQueueStore(): void {
  store.close()
}
