import Stripe from "stripe"
import { createClient } from "./supabase/server"
import { getStripeInstance } from "./stripe-config"
import { getPayPalService } from "./paypal-service"
import { getPaystackService } from "./paystack-service"
import { isPaymentProviderEnabled } from "./feature-flags"

export interface PaymentConfig {
  provider: "stripe" | "paypal" | "mock" | "paystack"
  apiKey?: string
}

export interface PaymentResult {
  success: boolean
  transactionId: string
  error?: string
  requiresAction?: boolean
  actionUrl?: string
}

export class PaymentService {
  private provider: string
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
    metadata: any = {}
  ): Promise<PaymentResult> {
    // Validate provider is enabled
    if (!isPaymentProviderEnabled(this.provider as any)) {
      return {
        success: false,
        transactionId: "",
        error: `Payment provider '${this.provider}' is not enabled. Please configure the required credentials.`,
      }
    }

    let result: PaymentResult

    try {
      if (this.provider === "stripe") {
        result = await this.processStripePayment(amount, currency, paymentMethodId)
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

      if (result.success && !result.requiresAction) {
        await this.savePaymentToDatabase({
          amount,
          currency,
          status: "succeeded",
          provider: this.provider,
          transaction_id: result.transactionId,
          metadata,
          user_id: metadata.userId,
          plan_name: metadata.planName,
        })
      } else if (result.requiresAction) {
        // Save as pending — user still needs to complete the redirect flow
        await this.savePaymentToDatabase({
          amount,
          currency,
          status: "pending",
          provider: this.provider,
          transaction_id: result.transactionId,
          metadata,
          user_id: metadata.userId,
          plan_name: metadata.planName,
        })
      }

      return result
    } catch (error) {
      console.error('[PaymentService] Payment processing error:', error)
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
    paymentMethodId: string
  ): Promise<PaymentResult> {
    if (!this.stripe) {
      return { success: false, transactionId: "", error: "Stripe not configured" }
    }

    try {
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
      })

      return {
        success: paymentIntent.status === "succeeded",
        transactionId: paymentIntent.id,
      }
    } catch (error: any) {
      return {
        success: false,
        transactionId: "",
        error: error.message,
      }
    }
  }

  private async processPayPalPayment(
    amount: number,
    currency: string,
    paymentMethodId: string,
    metadata: any = {}
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
    metadata: any = {}
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
        email: metadata.userEmail,
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

  private async savePaymentToDatabase(paymentData: any) {
    try {
      const supabase = await createClient()
      
      // Check if payment already exists (idempotency)
      const { data: existing } = await supabase
        .from("payments")
        .select("id")
        .eq("transaction_id", paymentData.transaction_id)
        .single()

      if (existing) {
        console.log('[PaymentService] Payment already exists, updating:', paymentData.transaction_id)
        const { error } = await supabase
          .from("payments")
          .update({
            ...paymentData,
            updated_at: new Date().toISOString(),
          })
          .eq("transaction_id", paymentData.transaction_id)
        
        if (error) throw error
      } else {
        console.log('[PaymentService] Creating new payment record:', paymentData.transaction_id)
        const { error } = await supabase.from("payments").insert(paymentData)
        if (error) throw error
      }
    } catch (error) {
      console.error("[PaymentService] Failed to save payment to database:", error)
      // We don't want to fail the whole payment if only the logging fails.
      // Webhooks are the reliable source of truth for payment status.
    }
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
