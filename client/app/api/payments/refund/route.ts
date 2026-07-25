import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, validateRequestBody, RateLimiters, ApiErrors, checkOwnership, emitAuditEvent } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"
import { PaymentService } from "@/lib/payment-service"
import { createClient } from "@/lib/supabase/server"

// Validation schema
const refundSchema = z.object({
  transactionId: z.string().min(1, "Transaction ID is required"),
})

export const POST = createAuthenticatedApiRoute(
  async (request: NextRequest, context, user) => {
    // Validate request body
    const body = await validateRequestBody(request, refundSchema)

    const supabase = await createClient()

    // Verify payment ownership before refunding
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("user_id, status")
      .eq("transaction_id", body.transactionId)
      .single()

    if (paymentError || !payment) {
      throw ApiErrors.notFound("Payment")
    }

    // Verify the payment belongs to the requesting user
    checkOwnership(user.id, payment.user_id)

    // Check if payment is already refunded
    if (payment.status === "refunded") {
      throw ApiErrors.validationError("Payment has already been refunded")
    }

    const paymentService = new PaymentService({
      provider: "stripe", // For now, assume Stripe
    })

    const result = await paymentService.refundPayment(body.transactionId)

    if (!result.success) {
      throw ApiErrors.internalError(`Refund failed: ${result.error || "Unknown error"}`)
    }

    emitAuditEvent({
      userId: user.id,
      action: "payment.refund",
      resourceType: "payment",
      resourceId: body.transactionId,
    })

    return createSuccessResponse(
      {
        refundId: result.transactionId,
        status: "refunded",
      },
      HttpStatus.OK,
      context.requestId
    )
  },
  {
    rateLimit: RateLimiters.payment,
    idempotent: true,
  }
)
