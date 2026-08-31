import { describe, it, expect, vi } from "vitest"
import { GET } from "../route"

describe("Health API Route", () => {
  it("should return a healthy status", async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.status).toBe("healthy")
    expect(body.data.timestamp).toBeDefined()
    expect(body.data.uptime).toBeDefined()
  })
})
