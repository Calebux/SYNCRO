import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { emitAuditEvent } from "../audit"

describe("emitAuditEvent", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it("logs a structured JSON entry to stdout", () => {
    emitAuditEvent({ userId: "user-1", action: "payment.create", resourceType: "payment", resourceId: "pay-99" })

    expect(consoleSpy).toHaveBeenCalledOnce()
    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string)
    expect(logged.audit).toBe(true)
    expect(logged.userId).toBe("user-1")
    expect(logged.action).toBe("payment.create")
    expect(logged.resourceId).toBe("pay-99")
    expect(logged.timestamp).toBeDefined()
  })

  it("includes optional metadata when provided", () => {
    emitAuditEvent({
      userId: "user-2",
      action: "subscription.import",
      resourceType: "subscription",
      metadata: { imported: 5, errors: 0 },
    })

    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string)
    expect(logged.metadata).toEqual({ imported: 5, errors: 0 })
  })

  it("omits resourceId and metadata keys when not provided", () => {
    emitAuditEvent({ userId: "user-3", action: "subscription.delete", resourceType: "subscription" })
    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string)
    expect(Object.keys(logged)).not.toContain("resourceId")
    expect(Object.keys(logged)).not.toContain("metadata")
  })

  it("does not throw when console.log itself throws", () => {
    consoleSpy.mockImplementation(() => { throw new Error("logging failed") })
    expect(() =>
      emitAuditEvent({ userId: "u", action: "payment.refund", resourceType: "payment" })
    ).not.toThrow()
  })
})
