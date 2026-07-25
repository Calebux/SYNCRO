import { describe, it, expect, vi, beforeEach } from "vitest"
import { PaymentService } from "../payment-service"
import { mockSupabaseClient, mockStripeClient } from "../test-utils/mocks"
import { createClient } from "../supabase/server"
import { getStripeInstance } from "../stripe-config"

// Mock the dependencies
vi.mock("../supabase/server", () => ({
  createClient: vi.fn(),
}))

vi.mock("../stripe-config", () => ({
  getStripeInstance: vi.fn(),
  stripeConfig: {},
}))

vi.mock("../paystack-service", () => ({
  getPaystackService: vi.fn(),
}))

vi.mock("../paypal-service", () => ({
  getPayPalService: vi.fn(),
}))

describe("PaymentService", () => {
  let supabase: any
  let stripe: any

  beforeEach(() => {
    vi.clearAllMocks()
    supabase = mockSupabaseClient()
    stripe = mockStripeClient()

    vi.mocked(createClient).mockResolvedValue(supabase as any)
    vi.mocked(getStripeInstance).mockReturnValue(stripe as any)
  })

  // ─── Stripe ────────────────────────────────────────────────────────────────

  describe("Stripe Provider", () => {
    it("should process a successful Stripe payment and save to DB", async () => {
      const service = new PaymentService({ provider: "stripe", apiKey: "test_key" })
      const amount = 100
      const metadata = { userId: "user_123", planName: "Premium" }

      stripe.paymentIntents.create.mockResolvedValue({
        id: "pi_123",
        status: "succeeded",
      })

      const result = await service.processPayment(amount, "usd", "pm_123", metadata)

      expect(result.success).toBe(true)
      expect(result.transactionId).toBe("pi_123")
      expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10000,
          currency: "usd",
          payment_method: "pm_123",
        })
      )

      expect(supabase.from).toHaveBeenCalledWith("payments")
      expect(supabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          amount,
          transaction_id: "pi_123",
          provider: "stripe",
          user_id: "user_123",
        })
      )
    })

    it("should handle Stripe payment failure and NOT save to DB", async () => {
      const service = new PaymentService({ provider: "stripe" })

      stripe.paymentIntents.create.mockRejectedValue(new Error("Card declined"))

      const result = await service.processPayment(100, "usd", "pm_fail")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Card declined")
      expect(supabase.insert).not.toHaveBeenCalled()
    })

    it("should return error if Stripe is not configured", async () => {
      vi.mocked(getStripeInstance).mockReturnValue(null as any)
      const service = new PaymentService({ provider: "stripe" })

      const result = await service.processPayment(100, "usd", "pm_123")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Stripe not configured")
    })
  })

  // ─── PayPal ────────────────────────────────────────────────────────────────

  describe("PayPal Provider", () => {
    it("should create a new PayPal order and return requiresAction", async () => {
      const { getPayPalService } = await import("../paypal-service")
      vi.mocked(getPayPalService).mockReturnValue({
        createOrder: vi.fn().mockResolvedValue({
          id: "ORDER_ABC",
          status: "CREATED",
          links: [{ rel: "approve", href: "https://paypal.com/approve/ORDER_ABC", method: "GET" }],
        }),
        captureOrder: vi.fn(),
        refundCapture: vi.fn(),
        getOrder: vi.fn(),
      } as any)

      const service = new PaymentService({ provider: "paypal" })
      const result = await service.processPayment(
        50,
        "usd",
        "pm_any",
        { userId: "user_1", userEmail: "test@example.com", planName: "Pro" }
      )

      expect(result.success).toBe(true)
      expect(result.requiresAction).toBe(true)
      expect(result.actionUrl).toContain("paypal.com")
      expect(result.transactionId).toBe("ORDER_ABC")
    })

    it("should capture an existing PayPal order using order_ prefix", async () => {
      const { getPayPalService } = await import("../paypal-service")
      vi.mocked(getPayPalService).mockReturnValue({
        captureOrder: vi.fn().mockResolvedValue({
          id: "ORDER_ABC",
          status: "COMPLETED",
          purchase_units: [{
            payments: {
              captures: [{ id: "CAPTURE_XYZ", status: "COMPLETED" }],
            },
          }],
        }),
        createOrder: vi.fn(),
        refundCapture: vi.fn(),
        getOrder: vi.fn(),
      } as any)

      const service = new PaymentService({ provider: "paypal" })
      const result = await service.processPayment(0, "usd", "order_ORDER_ABC")

      expect(result.success).toBe(true)
      expect(result.transactionId).toBe("CAPTURE_XYZ")
      expect(result.requiresAction).toBeUndefined()
    })

    it("should surface a DECLINED capture as an explicit failure", async () => {
      const { getPayPalService } = await import("../paypal-service")
      vi.mocked(getPayPalService).mockReturnValue({
        captureOrder: vi.fn().mockResolvedValue({
          id: "ORDER_ABC",
          status: "COMPLETED",
          purchase_units: [{
            payments: {
              captures: [{
                id: "CAPTURE_DECLINED",
                status: "DECLINED",
                status_details: { reason: "INSTRUMENT_DECLINED" },
              }],
            },
          }],
        }),
        createOrder: vi.fn(),
        refundCapture: vi.fn(),
        getOrder: vi.fn(),
      } as any)

      const service = new PaymentService({ provider: "paypal" })
      const result = await service.processPayment(0, "usd", "order_ORDER_ABC")

      expect(result.success).toBe(false)
      expect(result.error).toContain("declined")
      expect(result.error).toContain("INSTRUMENT_DECLINED")
      // Falls back to the capture ID so callers can reconcile the attempt.
      expect(result.transactionId).toBe("CAPTURE_DECLINED")
    })

    it("should surface a FAILED capture as an explicit failure", async () => {
      const { getPayPalService } = await import("../paypal-service")
      vi.mocked(getPayPalService).mockReturnValue({
        captureOrder: vi.fn().mockResolvedValue({
          id: "ORDER_ABC",
          status: "COMPLETED",
          purchase_units: [{
            payments: { captures: [{ id: "CAPTURE_FAILED", status: "FAILED" }] },
          }],
        }),
        createOrder: vi.fn(),
        refundCapture: vi.fn(),
        getOrder: vi.fn(),
      } as any)

      const service = new PaymentService({ provider: "paypal" })
      const result = await service.processPayment(0, "usd", "order_ORDER_ABC")

      expect(result.success).toBe(false)
      expect(result.error).toContain("failed")
    })

    it("should treat a PENDING capture as pending (requiresAction), not success", async () => {
      const { getPayPalService } = await import("../paypal-service")
      vi.mocked(getPayPalService).mockReturnValue({
        captureOrder: vi.fn().mockResolvedValue({
          id: "ORDER_ABC",
          status: "COMPLETED",
          purchase_units: [{
            payments: {
              captures: [{
                id: "CAPTURE_PENDING",
                status: "PENDING",
                status_details: { reason: "PENDING_REVIEW" },
              }],
            },
          }],
        }),
        createOrder: vi.fn(),
        refundCapture: vi.fn(),
        getOrder: vi.fn(),
      } as any)

      const service = new PaymentService({ provider: "paypal" })
      const result = await service.processPayment(0, "usd", "order_ORDER_ABC")

      expect(result.success).toBe(false)
      expect(result.requiresAction).toBe(true)
      expect(result.error).toContain("pending")
      expect(result.transactionId).toBe("CAPTURE_PENDING")
    })

    it("should return error when PayPal is not configured", async () => {
      const { getPayPalService } = await import("../paypal-service")
      vi.mocked(getPayPalService).mockReturnValue(null)

      const service = new PaymentService({ provider: "paypal" })
      const result = await service.processPayment(50, "usd", "pm_any")

      expect(result.success).toBe(false)
      expect(result.error).toContain("PAYPAL_CLIENT_ID")
    })
  })

  // ─── Paystack ──────────────────────────────────────────────────────────────

  describe("Paystack Provider", () => {
    it("should initialize a new Paystack transaction and return requiresAction", async () => {
      const { getPaystackService } = await import("../paystack-service")
      vi.mocked(getPaystackService).mockReturnValue({
        initializeTransaction: vi.fn().mockResolvedValue({
          authorization_url: "https://checkout.paystack.com/abc123",
          access_code: "abc123",
          reference: "syncro_user_123_1700000000000",
        }),
        verifyTransaction: vi.fn(),
      } as any)

      const service = new PaymentService({ provider: "paystack" })
      const result = await service.processPayment(
        5000,
        "ngn",
        "pm_any",
        { userId: "user_123", userEmail: "test@example.com", planName: "Pro" }
      )

      expect(result.success).toBe(true)
      expect(result.requiresAction).toBe(true)
      expect(result.actionUrl).toContain("paystack.com")
    })

    it("should verify a completed Paystack transaction using ref_ prefix", async () => {
      const { getPaystackService } = await import("../paystack-service")
      vi.mocked(getPaystackService).mockReturnValue({
        initializeTransaction: vi.fn(),
        verifyTransaction: vi.fn().mockResolvedValue({
          status: "success",
          reference: "syncro_user_123_1700000000000",
          amount: 500000,
          currency: "NGN",
          paid_at: "2024-01-01T00:00:00Z",
          customer: { email: "test@example.com" },
        }),
      } as any)

      const service = new PaymentService({ provider: "paystack" })
      const result = await service.processPayment(
        5000,
        "ngn",
        "ref_syncro_user_123_1700000000000",
        { userId: "user_123" }
      )

      expect(result.success).toBe(true)
      expect(result.transactionId).toBe("syncro_user_123_1700000000000")
      expect(result.requiresAction).toBeUndefined()
    })

    it("should return error when Paystack verification status is not success", async () => {
      const { getPaystackService } = await import("../paystack-service")
      vi.mocked(getPaystackService).mockReturnValue({
        initializeTransaction: vi.fn(),
        verifyTransaction: vi.fn().mockResolvedValue({
          status: "failed",
          reference: "syncro_user_123_1700000000000",
          amount: 500000,
          currency: "NGN",
          paid_at: "2024-01-01T00:00:00Z",
          customer: { email: "test@example.com" },
        }),
      } as any)

      const service = new PaymentService({ provider: "paystack" })
      const result = await service.processPayment(
        5000,
        "ngn",
        "ref_syncro_user_123_1700000000000"
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain("failed")
    })

    it("should return error when PAYSTACK_SECRET_KEY is not set", async () => {
      const { getPaystackService } = await import("../paystack-service")
      vi.mocked(getPaystackService).mockReturnValue(null)

      const service = new PaymentService({ provider: "paystack" })
      const result = await service.processPayment(5000, "ngn", "pm_any")

      expect(result.success).toBe(false)
      expect(result.error).toContain("PAYSTACK_SECRET_KEY")
    })

    it("should return a clear manual-refund message for Paystack refunds", async () => {
      const service = new PaymentService({ provider: "paystack" })
      const result = await service.refundPayment("syncro_ref_123")

      expect(result.success).toBe(false)
      expect(result.error).toContain("manually")
      expect(result.error).toContain("Paystack dashboard")
    })
  })

  // ─── Mock ──────────────────────────────────────────────────────────────────

  describe("Mock Provider", () => {
    it("should process a successful mock payment and save to DB", async () => {
      const service = new PaymentService({ provider: "mock" })

      const result = await service.processPayment(10, "usd", "none")

      expect(result.success).toBe(true)
      expect(result.transactionId).toContain("mock_")
      expect(supabase.insert).toHaveBeenCalled()
    })
  })

  // ─── Refunds ───────────────────────────────────────────────────────────────

  describe("Refunds", () => {
    it("should refund a Stripe payment and update DB", async () => {
      const service = new PaymentService({ provider: "stripe" })
      stripe.refunds.create.mockResolvedValue({ id: "re_123" })

      const result = await service.refundPayment("pi_123")

      expect(result.success).toBe(true)
      expect(result.transactionId).toBe("re_123")
      expect(stripe.refunds.create).toHaveBeenCalledWith({
        payment_intent: "pi_123",
      })
      expect(supabase.update).toHaveBeenCalledWith({ status: "refunded" })
      expect(supabase.eq).toHaveBeenCalledWith("transaction_id", "pi_123")
    })

    it("should handle Stripe refund failure", async () => {
      const service = new PaymentService({ provider: "stripe" })
      stripe.refunds.create.mockRejectedValue(new Error("Refund failed"))

      const result = await service.refundPayment("pi_123")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Refund failed")
      expect(supabase.update).not.toHaveBeenCalled()
    })

    it("should successfully refund for mock provider", async () => {
      const service = new PaymentService({ provider: "mock" })

      const result = await service.refundPayment("some_id")

      expect(result.success).toBe(true)
      expect(result.transactionId).toContain("refund_")
    })
  })

  // ─── DB error handling ─────────────────────────────────────────────────────

  describe("Database Error Handling", () => {
    it("should catch and log DB errors but still return a successful payment result", async () => {
      const service = new PaymentService({ provider: "mock" })
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      supabase.insert.mockRejectedValue(new Error("DB Connection Error"))

      const result = await service.processPayment(100, "usd", "pm_123")

      expect(result.success).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to save payment to database:",
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })
})