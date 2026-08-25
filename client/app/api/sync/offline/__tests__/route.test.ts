import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockUserId = "user-123"
const createClient = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient,
}))

vi.mock("@/lib/telemetry", () => ({
  trackError: vi.fn(),
}))

vi.mock("@/lib/api/index", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/index")>(
    "@/lib/api/index"
  )

  return {
    ...actual,
    createAuthenticatedApiRoute: (handler: any) => {
      return (request: NextRequest) =>
        handler(
          request,
          { requestId: "req-1", path: "/api/sync/offline", method: "POST" },
          { id: mockUserId, email: "user@example.com" }
        )
    },
  }
})

import { POST } from "../route"

describe("Offline Sync API", () => {
  let mockSupabase: any

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    }

    createClient.mockResolvedValue(mockSupabase)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("rejects updates containing protected fields: user_id", async () => {
    const request = new NextRequest("http://localhost/api/sync/offline", {
      method: "POST",
      body: JSON.stringify({
        type: "update",
        payload: {
          id: "sub-123",
          user_id: "tampered-user-id",
          name: "Updated Name",
        },
      }),
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.success).toBe(false)
    expect(json.error.message).toBe("Cannot update protected fields")
    expect(mockSupabase.update).not.toHaveBeenCalled()
  })

  it("rejects updates containing protected fields: created_at", async () => {
    const request = new NextRequest("http://localhost/api/sync/offline", {
      method: "POST",
      body: JSON.stringify({
        type: "update",
        payload: {
          id: "sub-123",
          created_at: "2026-01-01T00:00:00.000Z",
          name: "Updated Name",
        },
      }),
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toBe("Cannot update protected fields")
  })

  it("rejects updates containing protected fields: deleted_at", async () => {
    const request = new NextRequest("http://localhost/api/sync/offline", {
      method: "POST",
      body: JSON.stringify({
        type: "update",
        payload: {
          id: "sub-123",
          deleted_at: "2026-01-01T00:00:00.000Z",
        },
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it("rejects updates containing protected fields: status", async () => {
    const request = new NextRequest("http://localhost/api/sync/offline", {
      method: "POST",
      body: JSON.stringify({
        type: "update",
        payload: {
          id: "sub-123",
          status: "cancelled",
        },
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it("rejects version tampering when the client version is artificially high", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: "sub-123", version: 5 },
      error: null,
    })

    const request = new NextRequest("http://localhost/api/sync/offline", {
      method: "POST",
      body: JSON.stringify({
        type: "update",
        payload: {
          id: "sub-123",
          version: 999,
          name: "Hacked Subscription",
        },
      }),
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.success).toBe(false)
    expect(json.error.message).toBe("Invalid version for update")
    expect(mockSupabase.update).not.toHaveBeenCalled()
  })

  it("allows valid updates and strips unrecognized fields", async () => {
    mockSupabase.single
      .mockResolvedValueOnce({
        data: { id: "sub-123", version: 5 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "sub-123", version: 6, name: "Valid Update" },
        error: null,
      })

    const request = new NextRequest("http://localhost/api/sync/offline", {
      method: "POST",
      body: JSON.stringify({
        type: "update",
        payload: {
          id: "sub-123",
          name: "Valid Update",
          version: 5,
          unknown_field: "should_be_stripped",
        },
      }),
    })

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(mockSupabase.update).toHaveBeenCalledWith({
      name: "Valid Update",
      version: 6,
    })
  })
})
