import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logger } from "@/lib/logger"

/**
 * CSP Violation Report Schema
 */
const CspReportSchema = z.object({
  "csp-report": z.object({
    "document-uri": z.string().url(),
    "violated-directive": z.string(),
    "blocked-uri": z.string().optional(),
    "source-file": z.string().optional(),
    "line-number": z.number().optional(),
    "column-number": z.number().optional(),
    "disposition": z.enum(["enforce", "report"]).optional(),
    "status-code": z.number().optional(),
    "script-sample": z.string().optional(),
  }),
})

/**
 * CSP Violation Report Endpoint
 *
 * Receives Content Security Policy violation reports from browsers.
 * These reports help identify policy violations without blocking content (report-only mode).
 *
 * Violations are:
 * 1. Persisted to the database for historical analysis
 * 2. Sent to Sentry for real-time monitoring and alerting
 * 3. Aggregated for trend detection and policy tuning
 *
 * After 1 week of clean reports, switch to enforcing mode in middleware.ts
 * See: docs/CSP_POLICY_TUNING.md for the complete workflow
 */

// Simple in-memory rate limiter for CSP reports
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REPORTS_PER_WINDOW = 50;
let reportCount = 0;
let windowStart = Date.now();

export async function POST(request: NextRequest) {
  // Rate limiting check
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    reportCount = 0;
  }

  if (reportCount >= MAX_REPORTS_PER_WINDOW) {
    return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  reportCount++;

  try {
    const rawBody = await request.json()
    const result = CspReportSchema.safeParse(rawBody)

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid report format",
          details: result.error.format()
        },
        { status: 400 }
      )
    }

    const report = result.data["csp-report"]

    // Redact IP address for privacy
    const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip");

    // Simple redaction: only keep the first half of the IP or use a static string
    const redactedIp = rawIp ? '[REDACTED]' : undefined;

    const context = {
      userAgent: request.headers.get("user-agent") || undefined,
      ipAddress: redactedIp,
      referer: request.headers.get("referer") || undefined,
    }

    // Strip query parameters from document-uri to prevent PII leakage
    let sanitizedUri = report["document-uri"];
    try {
      const parsedUrl = new URL(sanitizedUri);
      sanitizedUri = `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch (e) {
      // If parsing fails, just use the raw string (might be a relative path)
    }
    report["document-uri"] = sanitizedUri;

    // Log the violation (structured logging)
    logger.error("CSP Violation Report", {
      documentURI: report["document-uri"],
      violatedDirective: report["violated-directive"],
      blockedURI: report["blocked-uri"],
      sourceFile: report["source-file"],
      lineNumber: report["line-number"],
      columnNumber: report["column-number"],
      disposition: report["disposition"],
      timeStamp: new Date().toISOString(),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    })

    // Persist to database and send to Sentry in parallel
    // We don't await these to avoid blocking the response
    // The browser doesn't need to wait for our processing
    Promise.all([
      // Call backend service to persist violation
      fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/csp-violations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Request': 'true',
        },
        body: JSON.stringify({ report, context }),
      }).catch(error => {
        logger.error("Failed to persist CSP violation", { err: error })
      }),

      // Send to Sentry (if configured)
      process.env.NEXT_PUBLIC_SENTRY_DSN ?
        import('@sentry/nextjs').then(Sentry => {
          const message = `CSP Violation: ${report["violated-directive"]} blocked ${report["blocked-uri"] || 'inline/eval'}`

          Sentry.captureMessage(message, {
            level: report["disposition"] === 'enforce' ? 'error' : 'warning',
            tags: {
              csp_directive: report["violated-directive"],
              csp_disposition: report["disposition"] || 'unknown',
              csp_blocked_uri: report["blocked-uri"] || 'none',
            },
            contexts: {
              csp: {
                document_uri: report["document-uri"],
                violated_directive: report["violated-directive"],
                blocked_uri: report["blocked-uri"],
                source_file: report["source-file"],
                line_number: report["line-number"],
                column_number: report["column-number"],
                disposition: report["disposition"],
                status_code: report["status-code"],
              },
              request: {
                user_agent: context.userAgent,
                ip_address: context.ipAddress,
                referer: context.referer,
              },
            },
          })
        }).catch(error => {
          logger.error("Failed to send CSP violation to Sentry", { err: error })
        })
        : Promise.resolve(),
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error("Error processing CSP report", { err: error })
    return NextResponse.json(
      { success: false, error: "Failed to process report" },
      { status: 500 }
    )
  }
}
