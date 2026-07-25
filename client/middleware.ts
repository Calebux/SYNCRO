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
 * 
 * Tor Browser Compatibility:
 * - Supports http:// for .onion addresses, so upgrade-insecure-requests is optional
 * - Allows all standard Web APIs and storage mechanisms
 * - Removes upgrade-insecure-requests in development to support .onion testing
 */
function generateCSP(
  nonce: string,
  reportOnly: boolean = false,
): { headerName: string; policy: string } {
  const isDev = process.env.NODE_ENV === 'development';

  const cspHeader = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' ${isDev ? "'unsafe-eval'" : "'strict-dynamic'"}`,
    `style-src 'self' 'unsafe-inline'`, // 'unsafe-inline' is needed for Tailwind/CSS-in-JS, nonce would disable it
    `img-src 'self' blob: data: https://res.cloudinary.com https://*.supabase.co https://ui-avatars.com`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.stellar.org`,
    `frame-src 'self' https://js.stripe.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Note: upgrade-insecure-requests is omitted to support Tor Browser .onion addresses
    // which use http:// by design
  ].join("; ");

  // Enforcing mode by default for strict security
  const headerName = reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

  // Add report-uri for violation reporting
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

  // Generate and set CSRF cookie if it doesn't exist
  let csrfToken = request.cookies.get("csrf-token")?.value;
  let didSetCsrf = false;
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    didSetCsrf = true;
  }

  // Generate CSP policy (enforcing mode)
  const { headerName: cspHeaderName, policy: cspPolicy } = generateCSP(
    nonce,
    false,
  );

  // Update Supabase session and handle auth redirects
  const response = await updateSession(request);

  if (didSetCsrf && csrfToken) {
    response.cookies.set("csrf-token", csrfToken, {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: false, // readable by client-side axios interceptor
    });
  }

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
