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

describe("Payments API Route", () => {
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

  it("should create payment intent with valid data", async () => {
    const validBody = {
      amount: 29.99,
      currency: "usd",
      token: "tok_visa",
      planName: "Pro Plan",
      provider: "stripe",
    }

    const request = new NextRequest("http://localhost/api/payments", {
      method: "POST",
      body: JSON.stringify(validBody),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.payment.id).toBe("pi_123")
    expect(mockPaymentService.processPayment).toHaveBeenCalledWith(
      29.99,
      "usd",
      "tok_visa",
      expect.objectContaining({
        planName: "Pro Plan",
        userId: "user_123",
      })
    )
  })

  it("should reject negative amounts", async () => {
    const invalidBody = {
      amount: -10,
      currency: "usd",
      token: "tok_visa",
      planName: "Pro Plan",
    }

    const request = new NextRequest("http://localhost/api/payments", {
      method: "POST",
      body: JSON.stringify(invalidBody),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("VALIDATION_ERROR")
  })

  it("should handle payment processing failures", async () => {
    mockPaymentService.processPayment.mockResolvedValue({
      success: false,
      error: "Card declined",
    })

    const request = new NextRequest("http://localhost/api/payments", {
      method: "POST",
      body: JSON.stringify({
        amount: 10,
        currency: "usd",
        token: "fail",
        planName: "Basic",
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain("Payment processing failed")
  })
})
