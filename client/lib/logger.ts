/**
 * Structured logger for server-side code (Next.js route handlers, server
 * actions). Emits single-line JSON so log aggregators can parse it, and
 * forwards `error`-level entries to Sentry.
 *
 * This exists to keep raw `console.*` calls out of `app/api/**`, where
 * unstructured logging risks leaking PII into stdout and bypasses our
 * observability pipeline. Prefer this over `console.*` in server code.
 *
 * Usage:
 *   import { logger } from "@/lib/logger"
 *   logger.info("PayPal webhook received", { eventType, eventId })
 *   logger.error("Signature verification failed", { err })
 */

import * as Sentry from "@sentry/nextjs"

type LogLevel = "debug" | "info" | "warn" | "error"

type LogContext = Record<string, unknown>

/** Keys whose values must never be written to logs verbatim. */
const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|authorization|api[-_]?key|cookie|signature|card|cvv)/i

function redact(context: LogContext): LogContext {
  const out: LogContext = {}
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]"
    } else if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message, stack: value.stack }
    } else {
      out[key] = value
    }
  }
  return out
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...redact(context),
  }

  // A single JSON line per entry keeps output machine-parseable.
  const line = JSON.stringify(entry)

  // Route to the matching console method so log-level filtering in the
  // hosting platform still works. This is the one sanctioned place in the
  // client codebase where `console` is used directly.
  switch (level) {
    case "error":
      // eslint-disable-next-line no-console
      console.error(line)
      break
    case "warn":
      // eslint-disable-next-line no-console
      console.warn(line)
      break
    default:
      // eslint-disable-next-line no-console
      console.log(line)
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => {
    emit("error", message, context)
    // Forward the failure to Sentry for alerting/aggregation.
    const err = context?.["err"] ?? context?.["error"]
    if (err instanceof Error) {
      Sentry.captureException(err, { extra: redact(context ?? {}) })
    } else {
      Sentry.captureMessage(message, { level: "error", extra: redact(context ?? {}) })
    }
  },
}

export default logger
