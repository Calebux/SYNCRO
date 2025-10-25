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

class AuditLogger {
  private logs: AuditLogEntry[] = []
  private maxLogs = 1000

  log(entry: Omit<AuditLogEntry, "id" | "timestamp">): void {
    const logEntry: AuditLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    this.logs.unshift(logEntry)

    // Keep only the most recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs)
    }

    // In production, send to backend
    if (process.env.NODE_ENV === "production") {
      this.sendToBackend(logEntry)
    }
  }

  private async sendToBackend(entry: AuditLogEntry): Promise<void> {
    try {
      // TODO: Implement actual backend logging
      console.log("[Audit Log]", entry)
    } catch (error) {
      console.error("Failed to send audit log:", error)
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
  }
}

export const auditLogger = new AuditLogger()

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

export function logDataExport(userId: string, format: string, recordCount: number): void {
  auditLogger.log({
    userId,
    action: "export",
    resource: "data",
    details: { format, recordCount },
  })
}
