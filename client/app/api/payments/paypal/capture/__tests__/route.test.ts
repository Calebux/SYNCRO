import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "../route"
import { requireAuth } from "@/lib/api/auth"
import { NextRequest } from "next/server"
import { PaymentService } from "@/lib/payment-service"

vi.mock("@/lib/api/auth", () => ({
  requireAuth: vi.fn(),
  createRequestContext: vi.fn().mockReturnValue({ requestId: "test-capture-id" }),
}))

vi.mock("@/lib/payment-service", () => ({
  PaymentService: vi.fn(),
}))

describe("PayPal Capture API Route", () => {
  let mockPaymentService: any
  const mockUser = { id: "user_paypal_123", email: "paypal@example.com" }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(mockUser as any)

    mockPaymentService = {
      processPayment: vi.fn().mockResolvedValue({
        success: true,
        transactionId: "capture_paypal_123",
      }),
    }
    vi.mocked(PaymentService).mockImplementation(function (this: any) {
      return mockPaymentService
    } as any)
  })

  it("should capture PayPal payment successfully with valid data", async () => {
    const validBody = {
      orderId: "ORDER-12345",
      planName: "Pro Plan",
    }

    const request = new NextRequest("http://localhost/api/payments/paypal/capture", {
      method: "POST",
      body: JSON.stringify(validBody),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.payment.id).toBe("capture_paypal_123")
    expect(mockPaymentService.processPayment).toHaveBeenCalledWith(
      0,
      "USD",
      "order_ORDER-12345",
      expect.objectContaining({
        planName: "Pro Plan",
        userId: "user_paypal_123",
      })
    )
  })

  it("should reject capture if orderId is missing", async () => {
    const invalidBody = {
      planName: "Pro Plan",
    }

    const request = new NextRequest("http://localhost/api/payments/paypal/capture", {
      method: "POST",
      body: JSON.stringify(invalidBody),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.error.field).toBe("orderId")
  })

  it("should reject capture if planName is missing", async () => {
    const invalidBody = {
      orderId: "ORDER-12345",
    }

    const request = new NextRequest("http://localhost/api/payments/paypal/capture", {
      method: "POST",
      body: JSON.stringify(invalidBody),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.error.field).toBe("planName")
  })
})
