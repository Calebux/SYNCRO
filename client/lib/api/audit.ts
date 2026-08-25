/**
 * Server-side structured audit logger for sensitive API mutations.
 *
 * Writes structured JSON entries to stdout (captured by the observability
 * pipeline) and, when the backend audit endpoint is reachable, POSTs a batch
 * for durable storage.
 *
 * Rules:
 *  - No PII in log fields (userId is an opaque UUID; email/IP are excluded).
 *  - Errors in this logger must never propagate to callers — audit must be
 *    best-effort and never block a request.
 */

export type AuditAction =
  | "payment.create"
  | "payment.refund"
  | "payment.persistence_failed"
  | "subscription.import"
  | "subscription.delete"
  | "subscription.bulk_delete"
  | "subscription.pause"
  | "subscription.resume"
  | "mfa.enroll"
  | "mfa.verify"
  | "mfa.disable"
  | "privacy.settings_update"
  | "account.delete_request"
  | "invoice.upload"
  | "admin.settings_update"
  | "admin.users_list"

export interface AuditEvent {
  /** Opaque user UUID — never email or username */
  userId: string
  action: AuditAction
  resourceType: string
  resourceId?: string
  /** Non-PII metadata (counts, status, provider names, etc.) */
  metadata?: Record<string, string | number | boolean | null>
  /** ISO timestamp; set automatically if omitted */
  timestamp?: string
}

/**
 * Emit a structured audit log entry.
 *
 * Call this after a sensitive mutation succeeds. It is fire-and-forget:
 * errors are swallowed so the caller is never affected.
 */
export function emitAuditEvent(event: AuditEvent): void {
  try {
    const entry = {
      audit: true,
      timestamp: event.timestamp ?? new Date().toISOString(),
      userId: event.userId,
      action: event.action,
      resourceType: event.resourceType,
      ...(event.resourceId ? { resourceId: event.resourceId } : {}),
      ...(event.metadata ? { metadata: event.metadata } : {}),
    }
    // Structured stdout — captured by log aggregation (Datadog, CloudWatch, etc.)
    console.log(JSON.stringify(entry))
  } catch {
    // Intentionally swallowed — audit must not break request handling
  }
}
