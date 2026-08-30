import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "../route"
import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/api/auth"
import { NextRequest } from "next/server"
import { mockSupabaseClient } from "@/lib/test-utils/mocks"
import { PaymentService } from "@/lib/payment-service"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

vi.mock("@/lib/api/auth", () => ({
  requireAuth: vi.fn(),
  createRequestContext: vi.fn().mockReturnValue({ requestId: "test-id" }),
}))

vi.mock("@/lib/payment-service", () => ({
  PaymentService: vi.fn(),
}))

describe("Payments API Idempotency & Replay Protection", () => {
  let supabase: any
  let mockPaymentService: any
  const mockUser = { id: "user_123", email: "test@example.com" }

  beforeEach(() => {
    vi.clearAllMocks()
    supabase = mockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(supabase as any)
    vi.mocked(requireAuth).mockResolvedValue(mockUser as any)

    mockPaymentService = {
      processPayment: vi.fn().mockResolvedValue({
        success: true,
        transactionId: "pi_123",
      }),
    }
    vi.mocked(PaymentService).mockImplementation(function (this: any) {
      return mockPaymentService
    } as any)
  })

  it("should process the payment and store response on first request", async () => {
    // Mock no existing record in DB
    supabase.single.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "No rows found" },
    })

    const body = {
      amount: 29.99,
      currency: "usd",
      token: "tok_visa",
      planName: "Pro Plan",
      provider: "stripe",
    }

    const request = new NextRequest("http://localhost/api/payments", {
      method: "POST",
      headers: {
        "idempotency-key": "unique-key-1",
      },
      body: JSON.stringify(body),
    })

    const response = await POST(request)
    const resBody = await response.json()

    // Status is 201 Created (since it processed)
    expect(response.status).toBe(201)
    expect(resBody.success).toBe(true)
    expect(response.headers.get("X-Idempotency-Hit")).toBeNull()
    expect(response.headers.get("X-Idempotency-Key")).toBe("unique-key-1")

    // The payment processing should be triggered
    expect(mockPaymentService.processPayment).toHaveBeenCalledTimes(1)

    // The response should be saved to supabase
    expect(supabase.from).toHaveBeenCalledWith("idempotency_keys")
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "unique-key-1",
        user_id: mockUser.id,
        response_status: 201,
      })
    )
  })

  it("should return cached response and bypass payment processing on duplicate request", async () => {
    // Mock existing record in DB for the same key
    supabase.single.mockResolvedValueOnce({
      data: {
        response_status: 201,
        response_body: {
          success: true,
          data: {
            payment: {
              id: "pi_cached_123",
              amount: 29.99,
              currency: "usd",
              status: "succeeded",
            },
          },
        },
      },
      error: null,
    })

    const body = {
      amount: 29.99,
      currency: "usd",
      token: "tok_visa",
      planName: "Pro Plan",
      provider: "stripe",
    }

    const request = new NextRequest("http://localhost/api/payments", {
      method: "POST",
      headers: {
        "idempotency-key": "duplicate-key",
      },
      body: JSON.stringify(body),
    })

    const response = await POST(request)
    const resBody = await response.json()

    // Assert it bypassed payment processing
    expect(mockPaymentService.processPayment).not.toHaveBeenCalled()

    // Response should match cached details
    expect(response.status).toBe(201)
    expect(resBody.success).toBe(true)
    expect(resBody.data.payment.id).toBe("pi_cached_123")
    expect(response.headers.get("X-Idempotency-Hit")).toBe("true")
    expect(response.headers.get("X-Idempotency-Key")).toBe("duplicate-key")
  })

  it("should execute the route normally if same key is sent with a different payload", async () => {
    // If the payload is different, the query to the DB (which matches key AND request_hash) returns nothing
    supabase.single.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "No rows found" },
    })

    const body = {
      amount: 49.99, // Different amount
      currency: "usd",
      token: "tok_visa",
      planName: "Enterprise Plan",
      provider: "stripe",
    }

    const request = new NextRequest("http://localhost/api/payments", {
      method: "POST",
      headers: {
        "idempotency-key": "duplicate-key", // same key as previous
      },
      body: JSON.stringify(body),
    })

    const response = await POST(request)
    const resBody = await response.json()

    // Since the payload was different, the request processed instead of hit cache
    expect(mockPaymentService.processPayment).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(201)
    expect(response.headers.get("X-Idempotency-Hit")).toBeNull()
  })

  it("should generate a deterministic server-side key and handle idempotency when client key is omitted", async () => {
    // First request: No record in DB, generates server key, processes payment
    supabase.single.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "No rows found" },
    })

    const body = {
      amount: 29.99,
      currency: "usd",
      token: "tok_visa",
      planName: "Pro Plan",
      provider: "stripe",
    }

    const request1 = new NextRequest("http://localhost/api/payments", {
      method: "POST",
      body: JSON.stringify(body),
    })

    const response1 = await POST(request1)
    const resBody1 = await response1.json()

    expect(response1.status).toBe(201)
    expect(response1.headers.get("X-Idempotency-Hit")).toBeNull()
    const generatedKey = response1.headers.get("X-Idempotency-Key")
    expect(generatedKey).toContain("server:user_123:/api/payments")

    expect(mockPaymentService.processPayment).toHaveBeenCalledTimes(1)

    // Second request: Mock DB to return cached response for the generated key
    vi.clearAllMocks()
    supabase.single.mockResolvedValueOnce({
      data: {
        response_status: 201,
        response_body: {
          success: true,
          data: {
            payment: {
              id: "pi_123",
              amount: 29.99,
              currency: "usd",
              status: "succeeded",
            },
          },
        },
      },
      error: null,
    })

    const request2 = new NextRequest("http://localhost/api/payments", {
      method: "POST",
      body: JSON.stringify(body),
    })

    const response2 = await POST(request2)
    const resBody2 = await response2.json()

    expect(response2.status).toBe(201)
    expect(response2.headers.get("X-Idempotency-Hit")).toBe("true")
    expect(response2.headers.get("X-Idempotency-Key")).toBe(generatedKey)
    expect(mockPaymentService.processPayment).not.toHaveBeenCalled()
  })
})
