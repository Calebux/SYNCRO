import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/supabase/server"
import { getStripeInstance } from "@/lib/stripe-config"
import { createErrorResponse, ApiErrors } from "@/lib/api/errors"
import { logger } from "@/lib/logger"

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a standardized 400 response for signature / payload problems.
 * We intentionally keep the message generic to avoid leaking internal details.
 * The caller logs the real reason at warn level before calling this.
 */
function signatureErrorResponse(): NextResponse {
  return createErrorResponse(
    ApiErrors.validationError("Webhook signature verification failed")
  )
}

/**
 * Build a standardized 500 response for database failures.
 * Returning 5xx tells Stripe to retry the event.
 */
function dbErrorResponse(detail: string): NextResponse {
  return createErrorResponse(ApiErrors.internalError(`Database error: ${detail}`))
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Verify Stripe is configured
  const stripe = getStripeInstance()
  if (!stripe) {
    return createErrorResponse(
      ApiErrors.serviceUnavailable("Stripe is not configured")
    )
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  // 2. Read raw body — must happen before any JSON parsing
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  // 3. Verify signature
  // Missing header or secret → 400 (not a Stripe request or misconfiguration)
  if (!signature || !webhookSecret) {
    logger.warn("[Webhook] Missing stripe-signature header or STRIPE_WEBHOOK_SECRET")
    return signatureErrorResponse()
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    // constructEvent throws for: invalid signature, malformed payload, replayed
    // events (timestamp tolerance exceeded). All are expected noise — log at warn,
    // not error, to avoid alert fatigue.
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn("[Webhook] Signature verification failed", { reason })
    return signatureErrorResponse()
  }

  // 4. Process the verified event
  const supabase = await createClient()

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent

        const { error: paymentErr } = await supabase
          .from("payments")
          .update({ status: "succeeded" })
          .eq("transaction_id", pi.id)

        if (paymentErr) {
          logger.error("[Webhook] Failed to update payment status", {
            eventId: event.id,
            paymentIntentId: pi.id,
            error: paymentErr.message,
          })
          return dbErrorResponse("payment update failed")
        }

        if (pi.metadata?.userId) {
          const { error: profileErr } = await supabase
            .from("profiles")
            .update({ subscription_tier: pi.metadata.planName })
            .eq("id", pi.metadata.userId)

          if (profileErr) {
            logger.error("[Webhook] Failed to update user profile", {
              eventId: event.id,
              userId: pi.metadata.userId,
              error: profileErr.message,
            })
            return dbErrorResponse("profile update failed")
          }
        }
        break
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent

        const { error: failErr } = await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("transaction_id", pi.id)

        if (failErr) {
          logger.error("[Webhook] Failed to update payment failure status", {
            eventId: event.id,
            paymentIntentId: pi.id,
            error: failErr.message,
          })
          return dbErrorResponse("payment failure update failed")
        }
        break
      }

      default:
        // Stripe sends many event types. Silently acknowledge unhandled ones
        // so Stripe does not retry them. No log needed — this is expected.
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    logger.error("[Webhook] Unexpected error processing event", {
      eventId: event.id,
      eventType: event.type,
      error: err instanceof Error ? err.message : String(err),
    })
    return createErrorResponse(ApiErrors.internalError("Unexpected error processing webhook"))
  }
}
