import { type NextRequest } from "next/server"
import { ApiErrors } from "./errors"

/**
 * Validate Double Submit Cookie CSRF token
 * 
 * Checks that the csrf-token cookie matches the x-csrf-token header.
 */
export function validateCsrfToken(request: NextRequest): void {
  // Always skip validation in test environment unless explicitly forced (for testing CSRF logic)
  if (process.env.NODE_ENV === "test" && !request.headers.get("x-force-csrf-check")) {
    return
  }

  const csrfCookie = request.cookies.get("csrf-token")?.value
  const csrfHeader = request.headers.get("x-csrf-token")

  if (!csrfCookie || !csrfHeader) {
    throw ApiErrors.forbidden("CSRF token missing")
  }

  if (csrfCookie !== csrfHeader) {
    throw ApiErrors.forbidden("CSRF token mismatch")
  }
}
