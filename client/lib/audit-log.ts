"use client"

// Audit logging for tracking user actions

export interface AuditLogEntry {
  id: string
  userId: string
  action: string
  resource: string
  resourceId?: string
  details?: Record<string, any>
  timestamp: number
  ipAddress?: string
  userAgent?: string
}

export interface AuditEventForAPI {
  userId?: string
  action: string
  resourceType: string
  resourceId?: string
  metadata?: Record<string, any>
  ipAddress?: string
  userAgent?: string
}

// Configuration
const BATCH_SIZE = 10
const FLUSH_INTERVAL_MS = 5000 // 5 seconds
const API_ENDPOINT = '/api/audit'
const MAX_OFFLINE_STORAGE = 100 // max items to store in localStorage

class AuditLogger {
  private logs: AuditLogEntry[] = []
  private auditQueue: AuditEventForAPI[] = []
  private maxLogs = 1000
  private flushTimer: NodeJS.Timeout | null = null
  private isOnline = typeof window !== 'undefined' ? navigator.onLine : true

  constructor() {
    // Only in browser environment
    if (typeof window !== 'undefined') {
      // Monitor online/offline status
      window.addEventListener('online', () => {
        this.isOnline = true
        this.flushAuditQueue()
      })
      window.addEventListener('offline', () => {
        this.isOnline = false
      })

      // Set up periodic flush
      this.startPeriodicFlush()
    }
  }

  /**
   * Start the periodic flush timer
   */
  private startPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }

    this.flushTimer = setInterval(() => {
      if (this.auditQueue.length > 0) {
        this.flushAuditQueue()
      }
    }, FLUSH_INTERVAL_MS)
  }

  /**
   * Log an audit entry
   */
  log(entry: Omit<AuditLogEntry, "id" | "timestamp">): void {
    const logEntry: AuditLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    // Store in memory for local access
    this.logs.unshift(logEntry)

    // Keep only the most recent logs in memory
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs)
    }

    // Queue for backend
    if (typeof window !== 'undefined') {
      this.queueForBackend({
        userId: entry.userId,
        action: entry.action,
        resourceType: entry.resource,
        resourceId: entry.resourceId,
        metadata: entry.details,
        userAgent: entry.userAgent,
        ipAddress: entry.ipAddress,
      })
    }
  }

  /**
   * Add an event to the queue
   */
  private queueForBackend(event: AuditEventForAPI): void {
    this.auditQueue.push(event)

    // Flush if we reach batch size
    if (this.auditQueue.length >= BATCH_SIZE) {
      this.flushAuditQueue()
    }
  }

  /**
   * Flush queued audit events to backend
   */
  async flushAuditQueue(): Promise<void> {
    if (this.auditQueue.length === 0) {
      return
    }

    // Clear flush timer before flushing
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    // Take all events from queue
    const events = this.auditQueue.splice(0)

    try {
      // Try to send to backend
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      console.log('[Audit Log] Batch sent successfully:', data)
    } catch (error) {
      console.warn('[Audit Log] Failed to send batch to backend:', error)

      // Fallback: store in localStorage for offline scenarios
      if (typeof window !== 'undefined') {
        this.storeOfflineAuditLogs(events)
      }

      // Re-queue events for retry
      this.auditQueue.unshift(...events)
    } finally {
      // Restart the periodic flush timer
      if (typeof window !== 'undefined') {
        this.startPeriodicFlush()
      }
    }
  }

  /**
   * Store audit logs in localStorage as fallback for offline scenarios
   */
  private storeOfflineAuditLogs(events: AuditEventForAPI[]): void {
    try {
      const key = 'audit_offline_logs'
      const stored = localStorage.getItem(key)
      const existingLogs: AuditEventForAPI[] = stored ? JSON.parse(stored) : []

      // Add new events
      const updated = [...existingLogs, ...events]

      // Keep only recent items
      const trimmed = updated.slice(-MAX_OFFLINE_STORAGE)

      localStorage.setItem(key, JSON.stringify(trimmed))
      console.log(`[Audit Log] Stored ${events.length} events in localStorage (offline)`)
    } catch (error) {
      console.error('[Audit Log] Failed to store in localStorage:', error)
    }
  }

  /**
   * Try to flush any offline audit logs when coming back online
   */
  async flushOfflineAuditLogs(): Promise<void> {
    try {
      const key = 'audit_offline_logs'
      const stored = localStorage.getItem(key)

      if (!stored) {
        return
      }

      const events: AuditEventForAPI[] = JSON.parse(stored)

      if (events.length === 0) {
        return
      }

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      // Clear offline logs on success
      localStorage.removeItem(key)
      console.log(`[Audit Log] Synced ${events.length} offline events to backend`)
    } catch (error) {
      console.warn('[Audit Log] Failed to sync offline logs:', error)
    }
  }

  getLogs(filters?: { userId?: string; action?: string; resource?: string }): AuditLogEntry[] {
    let filtered = this.logs

    if (filters?.userId) {
      filtered = filtered.filter((log) => log.userId === filters.userId)
    }

    if (filters?.action) {
      filtered = filtered.filter((log) => log.action === filters.action)
    }

    if (filters?.resource) {
      filtered = filtered.filter((log) => log.resource === filters.resource)
    }

    return filtered
  }

  clear(): void {
    this.logs = []
    this.auditQueue = []
  }

  /**
   * Cleanup on unload
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }
  }
}

export const auditLogger = new AuditLogger()

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    auditLogger.flushAuditQueue()
  })
}

// Helper functions for common actions
export function logSubscriptionAction(
  userId: string,
  action: "create" | "update" | "delete" | "cancel" | "pause" | "resume",
  subscriptionId: string,
  details?: Record<string, any>,
): void {
  auditLogger.log({
    userId,
    action,
    resource: "subscription",
    resourceId: subscriptionId,
    details,
  })
}

export function logAuthAction(
  userId: string,
  action: "login" | "logout" | "signup" | "password_reset",
  details?: Record<string, any>,
): void {
  auditLogger.log({
    userId,
    action,
    resource: "auth",
    details,
  })
}

export function logDataExport(userId: string, format: string, recordCount: number): void {
  auditLogger.log({
    userId,
    action: "export",
    resource: "data",
    details: { format, recordCount },
  })
}

export function logTeamAction(
  userId: string,
  action: "add_member" | "remove_member" | "update_role",
  memberId: string,
  details?: Record<string, any>,
): void {
  auditLogger.log({
    userId,
    action,
    resource: "team",
    resourceId: memberId,
    details,
  })
}
