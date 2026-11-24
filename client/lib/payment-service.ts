import Stripe from "stripe"
import { createClient } from "./supabase/server"
import { getStripeInstance } from "./stripe-config"
import { getPayPalService } from "./paypal-service"
import { getPaystackService } from "./paystack-service"
import { isPaymentProviderEnabled, type PaymentProvider } from "./feature-flags"
import { randomUUID } from "crypto"
import { emitAuditEvent } from "./api/audit"
import { logger } from "./logger"

export interface PaymentConfig {
  provider: PaymentProvider
  apiKey?: string
}

/**
 * Failure contract (provider success / database failure):
 *
 * When the payment provider reports success (or requiresAction) but the local
 * `payments` row cannot be inserted/updated, we do **not** flip `success` to
 * false — the charge already happened. Instead we return a degraded result:
 *   - `success: true` (provider outcome)
 *   - `persistenceDegraded: true`
 *   - `needsReconciliation: true`
 *   - `error` describing the persistence failure
 *
 * Callers must surface this to operators/clients and must not treat the
 * response as fully reconciled. Structured logs + `payment.persistence_failed`
 * audit events are emitted with `transactionId` and `requestId` so webhooks
 * or a reconciliation job can repair state.
 */
export interface PaymentResult {
  success: boolean
  transactionId: string
  error?: string
  requiresAction?: boolean
  actionUrl?: string
  clientSecret?: string
  /** Provider succeeded but local DB write failed */
  persistenceDegraded?: boolean
  /** Caller/ops should enqueue or await webhook reconciliation */
  needsReconciliation?: boolean
}

/** Metadata attached to payment processing and persisted with the payment row. */
export interface PaymentMetadata {
  userId?: string
  userEmail?: string
  planName?: string
  [key: string]: string | number | boolean | null | undefined
}

export interface PaymentRecord {
  amount: number
  currency: string
  status: "succeeded" | "pending" | "refunded" | "failed"
  provider: PaymentProvider | string
  transaction_id: string
  metadata?: PaymentMetadata
  user_id?: string
  plan_name?: string
  updated_at?: string
}

export type PaymentPersistenceResult =
  | { ok: true }
  | { ok: false; error: string }

export class PaymentService {
  private provider: PaymentProvider
  private stripe: Stripe | null = null

  constructor(config: PaymentConfig) {
    this.provider = config.provider
    if (this.provider === "stripe") {
      this.stripe = getStripeInstance(config.apiKey)
    }
  }

  async processPayment(
    amount: number,
    currency: string = "usd",
    paymentMethodId: string,
    metadata: PaymentMetadata = {}
  ): Promise<PaymentResult> {
    // Validate provider is enabled
    if (!isPaymentProviderEnabled(this.provider)) {
      return {
        success: false,
        transactionId: "",
        error: `Payment provider '${this.provider}' is not enabled. Please configure the required credentials.`,
      }
    }

    let result: PaymentResult

    try {
      if (this.provider === "stripe") {
        result = await this.processStripePayment(amount, currency, paymentMethodId, metadata)
      } else if (this.provider === "paypal") {
        result = await this.processPayPalPayment(amount, currency, paymentMethodId, metadata)
      } else if (this.provider === "paystack") {
        result = await this.processPaystackPayment(amount, currency, paymentMethodId, metadata)
      } else if (this.provider === "mock") {
        result = await this.processMockPayment(amount, currency)
      } else {
        return {
          success: false,
          transactionId: "",
          error: `Unknown payment provider: ${this.provider}`,
        }
      }

      if (result.success || result.requiresAction) {
        // requiresAction (PayPal/Paystack redirect or pending review) → pending
        const dbStatus = result.requiresAction ? "pending" : "succeeded"

        const persistence = await this.savePaymentToDatabase({
          amount,
          currency,
          status: dbStatus,
          provider: this.provider,
          transaction_id: result.transactionId,
          metadata,
          user_id: metadata.userId,
          plan_name: metadata.planName,
        })

        if (!persistence.ok) {
          const requestId =
            typeof metadata.requestId === "string"
              ? metadata.requestId
              : undefined

          logger.error("Payment persistence failed after provider success", {
            provider: this.provider,
            transactionId: result.transactionId,
            requestId: requestId ?? null,
            userId: metadata.userId ?? null,
            persistenceError: persistence.error,
            reconciliation: "enqueued",
          })

          emitAuditEvent({
            userId: metadata.userId || "unknown",
            action: "payment.persistence_failed",
            resourceType: "payment",
            resourceId: result.transactionId,
            metadata: {
              provider: this.provider,
              requestId: requestId ?? null,
              persistenceError: persistence.error,
              needsReconciliation: true,
            },
          })

          // Soft-enqueue: structured log is the reconciliation signal until a
          // dedicated job worker exists. Webhooks remain the backup path.
          this.enqueuePaymentReconciliation({
            transactionId: result.transactionId,
            provider: this.provider,
            requestId,
            userId: metadata.userId,
            reason: persistence.error,
          })

          return {
            ...result,
            persistenceDegraded: true,
            needsReconciliation: true,
            error:
              persistence.error ||
              "Payment succeeded with provider but failed to save locally; reconciliation required",
          }
        }
      }

      return result
    } catch (error) {
      logger.error("Payment processing error", { err: error })
      return {
        success: false,
        transactionId: "",
        error: error instanceof Error ? error.message : "Payment processing failed",
      }
    }
  }

  private async processStripePayment(
    amount: number,
    currency: string,
    paymentMethodId: string,
    metadata: any = {}
  ): Promise<PaymentResult> {
    if (!this.stripe) {
      return { success: false, transactionId: "", error: "Stripe not configured" }
    }

    try {
      // Sanitize metadata to only allowed non-sensitive fields
      const allowedKeys = ["userId", "planName", "requestId"]
      const sanitized: any = {}
      for (const key of allowedKeys) {
        if (metadata[key]) sanitized[key] = metadata[key]
      }
      // Ensure a correlation requestId exists
      if (!sanitized.requestId) sanitized.requestId = randomUUID()
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        payment_method: paymentMethodId,
        confirm: true,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        metadata: sanitized,
      })

      switch (paymentIntent.status) {
        case "succeeded":
          return {
            success: true,
            transactionId: paymentIntent.id,
          }

        case "requires_action":
        case "requires_confirmation":
          return {
            success: true,
            transactionId: paymentIntent.id,
            requiresAction: true,
            clientSecret: paymentIntent.client_secret ?? undefined,
          }

        default:
          return {
            success: false,
            transactionId: paymentIntent.id,
            error: `Payment ${paymentIntent.status}`,
          }
      }
    } catch (error: unknown) {
      return {
        success: false,
        transactionId: "",
        error: error instanceof Error ? error.message : "Stripe payment failed",
      }
    }
  }

  private async processPayPalPayment(
    amount: number,
    currency: string,
    paymentMethodId: string,
    metadata: PaymentMetadata = {}
  ): Promise<PaymentResult> {
    const paypalService = getPayPalService()

    if (!paypalService) {
      return {
        success: false,
        transactionId: "",
        error: "PayPal is not configured. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables.",
      }
    }

    try {
      // If paymentMethodId is an order ID (starts with order_), capture it
      if (paymentMethodId.startsWith('order_')) {
        const orderId = paymentMethodId.replace('order_', '')
        const capture = await paypalService.captureOrder(orderId)

        const captureDetails = capture.purchase_units[0]?.payments?.captures[0]
        const captureId = captureDetails?.id
        const status = captureDetails?.status
        const reason = captureDetails?.status_details?.reason

        // Handle every documented PayPal capture status explicitly so callers
        // can distinguish a completed payment from a declined, failed, or
        // pending-review one rather than collapsing them into one error.
        // @see https://developer.paypal.com/docs/api/orders/v2/#definition-capture_status
        switch (status) {
          case 'COMPLETED':
            if (!captureId) {
              return {
                success: false,
                transactionId: orderId,
                error: 'PayPal reported a completed capture but returned no capture ID',
              }
            }
            return {
              success: true,
              transactionId: captureId,
            }

          case 'PENDING':
            // Authorized but held for review (e.g. risk/AVS). Not yet a success —
            // surface it and persist as pending so the webhook can finalize it.
            return {
              success: false,
              transactionId: captureId || orderId,
              requiresAction: true,
              error: `PayPal capture is pending review${reason ? `: ${reason}` : ''}`,
            }

          case 'DECLINED':
          case 'FAILED':
            return {
              success: false,
              transactionId: captureId || orderId,
              error: `PayPal capture ${status.toLowerCase()}${reason ? `: ${reason}` : ''}`,
            }

          default:
            return {
              success: false,
              transactionId: orderId,
              error: `Payment capture failed with status: ${status ?? 'UNKNOWN'}`,
            }
        }
      }

      // Otherwise, create a new order
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const order = await paypalService.createOrder(amount, currency, {
        userId: metadata.userId,
        planName: metadata.planName,
        returnUrl: `${appUrl}/payments/paypal/success`,
        cancelUrl: `${appUrl}/payments/paypal/cancel`,
      })

      // Find the approval URL
      const approvalUrl = order.links.find(link => link.rel === 'approve')?.href

      if (!approvalUrl) {
        return {
          success: false,
          transactionId: order.id,
          error: "PayPal approval URL not found",
        }
      }

      // Return with requiresAction flag for client-side redirect
      return {
        success: true,
        transactionId: order.id,
        requiresAction: true,
        actionUrl: approvalUrl,
      }
    } catch (error) {
      console.error('[PaymentService] PayPal payment error:', error)
      return {
        success: false,
        transactionId: "",
        error: error instanceof Error ? error.message : "PayPal payment failed",
      }
    }
  }

  private async processPaystackPayment(
    amount: number,
    _currency: string,
    paymentMethodId: string,
    metadata: PaymentMetadata = {}
  ): Promise<PaymentResult> {
    const paystackService = getPaystackService()

    if (!paystackService) {
      return {
        success: false,
        transactionId: "",
        error: "Paystack is not configured. Please set PAYSTACK_SECRET_KEY.",
      }
    }

    try {
      // If paymentMethodId starts with "ref_", this is a verification call
      // after the user returns from the Paystack-hosted checkout page
      if (paymentMethodId.startsWith('ref_')) {
        const reference = paymentMethodId.replace('ref_', '')
        const verification = await paystackService.verifyTransaction(reference)

        if (verification.status === 'success') {
          return { success: true, transactionId: reference }
        }

        return {
          success: false,
          transactionId: reference,
          error: `Payment verification failed with status: ${verification.status}`,
        }
      }

      // Otherwise initialize a new transaction — user will be redirected to
      // the Paystack-hosted checkout page
      const reference = `syncro_${metadata.userId}_${Date.now()}`
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

      const init = await paystackService.initializeTransaction({
        email: metadata.userEmail ?? "",
        amountKobo: Math.round(amount * 100), // convert to kobo (100 kobo = ₦1)
        reference,
        metadata: {
          userId: metadata.userId,
          planName: metadata.planName,
          callbackUrl: `${appUrl}/payments/paystack/callback`,
        },
      })

      return {
        success: true,
        transactionId: reference,
        requiresAction: true,
        actionUrl: init.authorization_url,
      }
    } catch (error) {
      console.error('[PaymentService] Paystack payment error:', error)
      return {
        success: false,
        transactionId: "",
        error: error instanceof Error ? error.message : "Paystack payment failed",
      }
    }
  }

  private async processMockPayment(amount: number, currency: string): Promise<PaymentResult> {
    // Mock payments only allowed in development or if explicitly enabled
    if (!isPaymentProviderEnabled('mock')) {
      return {
        success: false,
        transactionId: "",
        error: "Mock payments are not enabled in production",
      }
    }

    console.warn('[PaymentService] Using mock payment - not for production use')

    return {
      success: true,
      transactionId: `mock_${Date.now()}`,
    }
  }

  private async savePaymentToDatabase(
    paymentData: PaymentRecord
  ): Promise<PaymentPersistenceResult> {
    try {
      const supabase = await createClient()

      // Check if payment already exists (idempotency)
      const { data: existing } = await supabase
        .from("payments")
        .select("id")
        .eq("transaction_id", paymentData.transaction_id)
        .single()

      if (existing) {
        logger.info("Payment already exists, updating", {
          transactionId: paymentData.transaction_id,
        })
        const { error } = await supabase
          .from("payments")
          .update({
            ...paymentData,
            updated_at: new Date().toISOString(),
          })
          .eq("transaction_id", paymentData.transaction_id)

        if (error) {
          return { ok: false, error: `Payment update failed: ${error.message}` }
        }
      } else {
        logger.info("Creating new payment record", {
          transactionId: paymentData.transaction_id,
        })
        const { error } = await supabase.from("payments").insert(paymentData)
        if (error) {
          return { ok: false, error: `Payment insert failed: ${error.message}` }
        }
      }

      return { ok: true }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown persistence error"
      logger.error("Failed to save payment to database", {
        err: error,
        transactionId: paymentData.transaction_id,
      })
      return { ok: false, error: message }
    }
  }

  /**
   * Soft-enqueue reconciliation work. Until a durable queue exists, this emits
   * a structured log line that ops/alerting can pick up; webhooks remain the
   * primary repair path.
   */
  private enqueuePaymentReconciliation(job: {
    transactionId: string
    provider: string
    requestId?: string
    userId?: string
    reason: string
  }): void {
    logger.warn("payment.reconciliation_enqueued", {
      queue: "payment_reconciliation",
      transactionId: job.transactionId,
      provider: job.provider,
      requestId: job.requestId ?? null,
      userId: job.userId ?? null,
      reason: job.reason,
    })
  }

  async refundPayment(transactionId: string): Promise<PaymentResult> {
    try {
      if (this.provider === "stripe" && this.stripe) {
        const refund = await this.stripe.refunds.create({
          payment_intent: transactionId,
        })

        // Update database status
        const supabase = await createClient()
        await supabase
          .from("payments")
          .update({ status: "refunded" })
          .eq("transaction_id", transactionId)

        return { success: true, transactionId: refund.id }
      } else if (this.provider === "paypal") {
        const paypalService = getPayPalService()

        if (!paypalService) {
          return {
            success: false,
            transactionId: "",
            error: "PayPal is not configured",
          }
        }

        // For PayPal, transactionId is the capture ID
        const refund = await paypalService.refundCapture(transactionId)

        // Update database status
        const supabase = await createClient()
        await supabase
          .from("payments")
          .update({ status: "refunded" })
          .eq("transaction_id", transactionId)

        return { success: true, transactionId: refund.id }
      } else if (this.provider === "paystack") {
        // Paystack does not support programmatic refunds for NGN wallet-funding
        // transactions. Refunds must be processed manually via the Paystack
        // dashboard at https://dashboard.paystack.com
        return {
          success: false,
          transactionId: "",
          error:
            "Paystack refunds must be processed manually via the Paystack dashboard.",
        }
      } else if (this.provider === "mock") {
        // Mock refund
        if (!isPaymentProviderEnabled('mock')) {
          return {
            success: false,
            transactionId: "",
            error: "Mock payments are not enabled",
          }
        }

        const supabase = await createClient()
        await supabase
          .from("payments")
          .update({ status: "refunded" })
          .eq("transaction_id", transactionId)

        return { success: true, transactionId: `refund_${Date.now()}` }
      }

      return {
        success: false,
        transactionId: "",
        error: `Refunds not supported for provider: ${this.provider}`,
      }
    } catch (error) {
      console.error('[PaymentService] Refund error:', error)
      return {
        success: false,
        transactionId: "",
        error: error instanceof Error ? error.message : "Refund failed",
      }
    }
  }
}
