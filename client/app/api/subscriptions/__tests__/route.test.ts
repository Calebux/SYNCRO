import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "../route"
import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/api/auth"
import { NextRequest } from "next/server"
import { mockSupabaseClient } from "@/lib/test-utils/mocks"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>()
  return {
    ...actual,
    requireAuth: vi.fn(),
    createRequestContext: vi.fn().mockReturnValue({ requestId: "test-id" }),
  }
})

describe("Subscriptions API Route", () => {
  let supabase: any
  const mockUser = { id: "user_123", email: "test@example.com" }

  beforeEach(() => {
    vi.clearAllMocks()
    supabase = mockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(supabase as any)
    vi.mocked(requireAuth).mockResolvedValue(mockUser as any)
  })

  describe("GET", () => {
    it("should return subscriptions for the authenticated user", async () => {
      const mockSubscriptions = [
        { id: "sub_1", name: "Netflix", price: 15.99 },
        { id: "sub_2", name: "Spotify", price: 9.99 },
      ]

      supabase.from.mockReturnThis()
      supabase.select.mockReturnThis()
      supabase.eq.mockReturnThis()
      supabase.order.mockReturnThis()
      supabase.range.mockResolvedValue({ 
        data: mockSubscriptions, 
        error: null, 
        count: 2 
      })

      const request = new NextRequest("http://localhost/api/subscriptions?page=1&limit=10")
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.items).toHaveLength(2)
      expect(body.data.items[0].name).toBe("Netflix")
      expect(supabase.from).toHaveBeenCalledWith("subscriptions")
      expect(supabase.eq).toHaveBeenCalledWith("user_id", "user_123")
    })

    it("should return 401 for unauthenticated requests", async () => {
      vi.mocked(requireAuth).mockResolvedValue(null as any)

      const request = new NextRequest("http://localhost/api/subscriptions")
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.success).toBe(false)
      expect(body.error.code).toBe("UNAUTHORIZED")
    })

    it("should handle database errors", async () => {
      supabase.from.mockReturnThis()
      supabase.select.mockReturnThis()
      supabase.eq.mockReturnThis()
      supabase.order.mockReturnThis()
      supabase.range.mockResolvedValue({ 
        data: null, 
        error: { message: "Database failure" }, 
        count: 0 
      })

      const request = new NextRequest("http://localhost/api/subscriptions")
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain("Database failure")
    })
  })

  describe("POST", () => {
    it("should create a new subscription", async () => {
      const newSub = {
        name: "Disney+",
        category: "Entertainment",
        price: 7.99,
        status: "active",
      }

      supabase.from.mockReturnThis()
      supabase.insert.mockReturnThis()
      supabase.select.mockReturnThis()
      supabase.single.mockResolvedValue({ 
        data: { id: "new_sub_id", ...newSub }, 
        error: null 
      })

      const request = new NextRequest("http://localhost/api/subscriptions", {
        method: "POST",
        body: JSON.stringify(newSub),
      })
      
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.data.subscription.name).toBe("Disney+")
      expect(supabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user_123",
          name: "Disney+",
        })
      )
    })

    it("should return 401 for unauthenticated requests", async () => {
      vi.mocked(requireAuth).mockResolvedValue(null as any)

      const newSub = {
        name: "Disney+",
        category: "Entertainment",
        price: 7.99,
        status: "active",
      }

      const request = new NextRequest("http://localhost/api/subscriptions", {
        method: "POST",
        body: JSON.stringify(newSub),
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.success).toBe(false)
      expect(body.error.code).toBe("UNAUTHORIZED")
    })

    it("should validate the request body", async () => {
      const invalidSub = {
        name: "", // Too short
        price: -10, // Must be positive
      }

      const request = new NextRequest("http://localhost/api/subscriptions", {
        method: "POST",
        body: JSON.stringify(invalidSub),
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe("VALIDATION_ERROR")
      expect(body.error.message).toBeDefined()
    })
  })
})
