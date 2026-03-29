import { NextRequest, NextResponse } from "next/server"

/**
 * CSP Violation Report Endpoint
 * 
 * Receives Content Security Policy violation reports from browsers.
 * These reports help identify policy violations without blocking content (report-only mode).
 * 
 * After 1 week of clean reports, switch to enforcing mode in middleware.ts
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const report = body["csp-report"]

    if (!report) {
      return NextResponse.json(
        { success: false, error: "Invalid report format" },
        { status: 400 }
      )
    }

    // Log the violation for monitoring
    // In production, you might want to send this to a logging service
    console.error("CSP Violation Report:", {
      documentURI: report["document-uri"],
      violatedDirective: report["violated-directive"],
      blockedURI: report["blocked-uri"],
      sourceFile: report["source-file"],
      lineNumber: report["line-number"],
      columnNumber: report["column-number"],
      timeStamp: new Date().toISOString(),
      userAgent: request.headers.get("user-agent"),
    })

    // TODO: In production, consider:
    // - Sending reports to a monitoring service (e.g., Sentry, Datadog)
    // - Storing reports in a database for analysis
    // - Setting up alerts for high-frequency violations

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error processing CSP report:", error)
    return NextResponse.json(
      { success: false, error: "Failed to process report" },
      { status: 500 }
    )
  }
}
