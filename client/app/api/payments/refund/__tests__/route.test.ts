import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "../route"
import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/api/auth"
import { NextRequest } from "next/server"
import { mockSupabaseClient } from "@/lib/test-utils/mocks"
import { PaymentService } from "@/lib/payment-service"
import { resetRateLimitStore } from "@/lib/api/rate-limit"

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

vi.mock("@/lib/api/audit", () => ({
  emitAuditEvent: vi.fn(),
}))

describe("POST /api/payments/refund", () => {
  let supabase: ReturnType<typeof mockSupabaseClient>
  let mockPaymentService: { refundPayment: ReturnType<typeof vi.fn> }
  const mockUser = { id: "user_123", email: "test@example.com" }

  beforeEach(() => {
    vi.clearAllMocks()
    resetRateLimitStore()
    supabase = mockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(supabase as never)
    vi.mocked(requireAuth).mockResolvedValue(mockUser as never)

    // Idempotency check: no cached response
    supabase.single.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "No rows found" },
    })

    mockPaymentService = {
      refundPayment: vi.fn().mockResolvedValue({
        success: true,
        transactionId: "re_123",
      }),
    }
    vi.mocked(PaymentService).mockImplementation(function (this: unknown) {
      return mockPaymentService
    } as never)
  })

  function refundRequest(transactionId: string) {
    return new NextRequest("http://localhost/api/payments/refund", {
      method: "POST",
      body: JSON.stringify({ transactionId }),
    })
  }

  function mockPaymentRecord(overrides: {
    user_id?: string
    status?: string
    provider?: string
  } = {}) {
    // First single(): idempotency miss; second: payment lookup
    supabase.single
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST116", message: "No rows found" },
      })
      .mockResolvedValueOnce({
        data: {
          user_id: overrides.user_id ?? "user_123",
          status: overrides.status ?? "succeeded",
          provider: overrides.provider ?? "stripe",
        },
        error: null,
      })
  }

  it("refunds a Stripe payment using the provider from the payment record", async () => {
    mockPaymentRecord({ provider: "stripe" })

    const response = await POST(refundRequest("pi_stripe_1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.refundId).toBe("re_123")
    expect(PaymentService).toHaveBeenCalledWith({ provider: "stripe" })
    expect(mockPaymentService.refundPayment).toHaveBeenCalledWith("pi_stripe_1")
  })

  it("refunds a PayPal payment using the provider from the payment record", async () => {
    mockPaymentRecord({ provider: "paypal" })
    mockPaymentService.refundPayment.mockResolvedValue({
      success: true,
      transactionId: "paypal_refund_1",
    })

    const response = await POST(refundRequest("CAPTURE_1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.refundId).toBe("paypal_refund_1")
    expect(PaymentService).toHaveBeenCalledWith({ provider: "paypal" })
    expect(mockPaymentService.refundPayment).toHaveBeenCalledWith("CAPTURE_1")
  })

  it("rejects Paystack payments that require manual refunds", async () => {
    mockPaymentRecord({ provider: "paystack" })

    const response = await POST(refundRequest("psk_txn_1"))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.error.message).toMatch(/Paystack refunds must be processed manually/i)
    expect(PaymentService).not.toHaveBeenCalled()
  })

  it("rejects unknown payment providers with a validation error", async () => {
    mockPaymentRecord({ provider: "crypto-wallet" })

    const response = await POST(refundRequest("txn_unknown"))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.error.message).toMatch(/not supported for payment provider/i)
    expect(PaymentService).not.toHaveBeenCalled()
  })

  it("rejects refunds for payments owned by another user", async () => {
    mockPaymentRecord({ user_id: "other_user", provider: "stripe" })

    const response = await POST(refundRequest("pi_other"))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(PaymentService).not.toHaveBeenCalled()
    expect(body.error).toBeDefined()
  })

  it("rejects already-refunded payments", async () => {
    mockPaymentRecord({ status: "refunded", provider: "stripe" })

    const response = await POST(refundRequest("pi_refunded"))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toMatch(/already been refunded/i)
    expect(PaymentService).not.toHaveBeenCalled()
  })
})
