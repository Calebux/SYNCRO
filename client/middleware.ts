import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isMaintenanceMode } from "@/lib/api/env";

// Security headers
const securityHeaders = {
  "X-DNS-Prefetch-Control": "on",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Generate Content Security Policy with nonce for script/style inline execution
 * Uses report-only mode for safe rollout - switch to enforcing after 1 week clean
 */
function generateCSP(
  nonce: string,
  reportOnly: boolean = true,
): { headerName: string; policy: string } {
  const cspHeader = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' blob: data: https:`,
    `font-src 'self'`,
    `connect-src 'self' https://*.supabase.co https://api.stripe.com wss://*.supabase.co`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  // Report-only mode for safe rollout - catches violations without blocking
  // After 1 week of clean reports, switch to enforcing mode
  const headerName = reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

  // Add report-uri for violation reporting (only in report-only mode)
  const policy = reportOnly
    ? `${cspHeader}; report-uri /api/csp-report`
    : cspHeader;

  return { headerName, policy };
}

export async function middleware(request: NextRequest) {
  // Check maintenance mode (skip for health checks)
  if (
    isMaintenanceMode() &&
    !request.nextUrl.pathname.startsWith("/api/health")
  ) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Service is currently under maintenance",
        },
      },
      { status: 503 },
    );
  }

  // Generate nonce for CSP
  const nonce = crypto.randomUUID();

  // Generate CSP policy (report-only mode for safe rollout)
  const { headerName: cspHeaderName, policy: cspPolicy } = generateCSP(
    nonce,
    true,
  );

  // Update Supabase session and handle auth redirects
  const response = await updateSession(request);

  // Add security headers to all responses
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Add Content Security Policy
  response.headers.set(cspHeaderName, cspPolicy);

  // Add nonce to request headers for use in components
  response.headers.set("x-nonce", nonce);

  // Add request ID for tracing
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  response.headers.set("x-request-id", requestId);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
