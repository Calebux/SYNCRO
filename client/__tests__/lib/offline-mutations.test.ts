import { describe, expect, it } from "vitest"
import { offlineMutationSchema } from "@/lib/sync/offline-mutations"

describe("offlineMutationSchema", () => {
  it("accepts a create mutation", () => {
    const result = offlineMutationSchema.safeParse({
      type: "create",
      payload: { name: "Netflix", amount: 15.99 },
    })
    expect(result.success).toBe(true)
  })

  it("accepts an update mutation carrying a version", () => {
    const result = offlineMutationSchema.safeParse({
      type: "update",
      payload: { id: "sub-1", version: 3, name: "Netflix" },
    })
    expect(result.success).toBe(true)
  })

  it("rejects an unknown mutation type", () => {
    const result = offlineMutationSchema.safeParse({
      type: "upsert",
      payload: { id: "sub-1" },
    })
    expect(result.success).toBe(false)
  })

  it("rejects a missing payload", () => {
    const result = offlineMutationSchema.safeParse({ type: "delete" })
    expect(result.success).toBe(false)
  })

  it("rejects an update without an id", () => {
    const result = offlineMutationSchema.safeParse({
      type: "update",
      payload: { name: "Netflix" },
    })
    expect(result.success).toBe(false)
  })

  it("rejects unknown top-level fields so new offline fields need a schema change", () => {
    const result = offlineMutationSchema.safeParse({
      type: "delete",
      payload: { id: "sub-1" },
      clientTimestamp: 123,
    })
    expect(result.success).toBe(false)
  })
})
