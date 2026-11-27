import { describe, it, expect } from "vitest"
import { validateCsrfToken } from "../csrf"
import { NextRequest } from "next/server"
import { ApiException } from "../errors"

describe("CSRF Protection Token Validation", () => {
  it("should bypass CSRF validation in test environment if force header is missing", () => {
    // Missing both header and cookie, but shouldn't throw since we bypass test env by default
    const request = new NextRequest("http://localhost/api/test-csrf", {
      method: "POST",
    })

    expect(() => validateCsrfToken(request)).not.toThrow()
  })

  it("should reject request when CSRF token is completely missing", () => {
    const request = new NextRequest("http://localhost/api/test-csrf", {
      method: "POST",
      headers: {
        "x-force-csrf-check": "true",
      },
    })

    expect(() => validateCsrfToken(request)).toThrow(ApiException)
    try {
      validateCsrfToken(request)
    } catch (error: any) {
      expect(error.statusCode).toBe(403)
      expect(error.message).toContain("CSRF token missing")
    }
  })

  it("should reject request when x-csrf-token header is missing but cookie is present", () => {
    const request = new NextRequest("http://localhost/api/test-csrf", {
      method: "POST",
      headers: {
        "x-force-csrf-check": "true",
        "cookie": "csrf-token=my-secure-token",
      },
    })

    expect(() => validateCsrfToken(request)).toThrow(ApiException)
    try {
      validateCsrfToken(request)
    } catch (error: any) {
      expect(error.statusCode).toBe(403)
      expect(error.message).toContain("CSRF token missing")
    }
  })

  it("should reject request when x-csrf-token header does not match csrf-token cookie", () => {
    const request = new NextRequest("http://localhost/api/test-csrf", {
      method: "POST",
      headers: {
        "x-force-csrf-check": "true",
        "x-csrf-token": "attacker-forged-token",
        "cookie": "csrf-token=real-legitimate-token",
      },
    })

    expect(() => validateCsrfToken(request)).toThrow(ApiException)
    try {
      validateCsrfToken(request)
    } catch (error: any) {
      expect(error.statusCode).toBe(403)
      expect(error.message).toContain("CSRF token mismatch")
    }
  })

  it("should allow request when x-csrf-token header matches csrf-token cookie exactly", () => {
    const request = new NextRequest("http://localhost/api/test-csrf", {
      method: "POST",
      headers: {
        "x-force-csrf-check": "true",
        "x-csrf-token": "matched-secure-token",
        "cookie": "csrf-token=matched-secure-token",
      },
    })

    expect(() => validateCsrfToken(request)).not.toThrow()
  })
})
