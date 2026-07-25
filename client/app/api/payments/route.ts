import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, validateRequestBody, RateLimiters, ApiErrors, emitAuditEvent } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"
import { PaymentService } from "@/lib/payment-service"
import { getAvailablePaymentProviders, isPaymentProviderEnabled } from "@/lib/feature-flags"

// Validation schema - dynamically validate provider based on what's enabled
const paymentSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  currency: z
    .string()
    .length(3, "Currency must be 3 characters")
    .default("usd"),
  token: z.string().min(1, "Payment token is required"),
  planName: z.string().min(1, "Plan name is required"),
  provider: z.enum(["stripe", "paypal", "mock", "paystack"]).default("stripe"),
}).refine(
  (data) => isPaymentProviderEnabled(data.provider),
  (data) => ({
    message: `Payment provider '${data.provider}' is not enabled. Available providers: ${getAvailablePaymentProviders().join(', ')}`,
    path: ['provider'],
  })
);

export const POST = createAuthenticatedApiRoute(
  async (request: NextRequest, context, user) => {
    const body = await validateRequestBody(request, paymentSchema);

    const paymentService = new PaymentService({
      provider: body.provider,
    });

    const result = await paymentService.processPayment(
      body.amount,
      body.currency,
      body.token,
      {
        planName: body.planName,
        userId: user.id,
        userEmail: user.email || "",
      },
    );

    if (!result.success) {
      throw ApiErrors.internalError(
        `Payment processing failed: ${result.error || "Unknown error"}`,
      );
    }

    emitAuditEvent({
      userId: user.id,
      action: "payment.create",
      resourceType: "payment",
      resourceId: result.transactionId,
      metadata: { provider: body.provider, currency: body.currency },
    })

    return createSuccessResponse(
      {
        payment: {
          id: result.transactionId,
          amount: body.amount,
          currency: body.currency,
          status: "succeeded",
          createdAt: new Date(),
        },
      },
      HttpStatus.CREATED,
      context.requestId,
    );
  },
  {
    rateLimit: RateLimiters.payment,
    idempotent: true,
  },
);