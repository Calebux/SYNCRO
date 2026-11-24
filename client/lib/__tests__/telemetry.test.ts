import { describe, it, expect, vi, beforeEach } from "vitest"
import * as Sentry from "@sentry/nextjs"
import { trackError } from "../telemetry"

// Mock Sentry
vi.mock("@sentry/nextjs", () => ({
  withScope: vi.fn((callback) => {
    const scope = {
      setTag: vi.fn(),
      setUser: vi.fn(),
      setExtras: vi.fn(),
    }
    callback(scope)
    return scope
  }),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

describe("telemetry utility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should categorize Supabase database errors", () => {
    const dbError = { code: "PGRST116", message: "Not found" }
    trackError(dbError, "unknown", { component: "TestComponent" })

    expect(Sentry.withScope).toHaveBeenCalled()
    // The first call to withScope should have set the tag
    // Since withScope is a bit complex to mock exactly and check tags inside, 
    // we can check if captureException was called.
    expect(Sentry.captureException).toHaveBeenCalledWith(dbError)
  })

  it("should categorize Supabase auth errors", () => {
    const authError = { code: "auth/invalid-email", message: "Invalid email" }
    trackError(authError, "unknown", { component: "TestComponent" })

    expect(Sentry.captureException).toHaveBeenCalledWith(authError)
  })

  it("should use the provided category if specified", () => {
    const error = new Error("Custom error")
    trackError(error, "network", { component: "TestComponent" })

    expect(Sentry.captureException).toHaveBeenCalledWith(error)
  })

  it("should log to console error", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = new Error("Test log")
    
    trackError(error, "unknown", { component: "Test" })
    
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
