import { type NextRequest } from "next/server"
import { z } from "zod"
import { HttpStatus } from "@/lib/api/types"
import { createClient } from "@/lib/supabase/server"
import {
  ApiErrors,
  createAuthenticatedApiRoute,
  createSuccessResponse,
  RateLimiters,
} from "@/lib/api/index"
import { getSignedInvoiceUrl, InvoiceError } from "@/lib/invoices/invoice-service"

const idParamSchema = z.object({
  id: z.string().uuid("Invalid invoice ID"),
})

/**
 * GET /api/invoices/[id]/signed-url
 *
 * Returns a short-lived signed URL for viewing the authenticated user's invoice
 * PDF. Powers the "View Invoice PDF" action on payment-history entries.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return createAuthenticatedApiRoute(
    async (_req: NextRequest, context, user) => {
      const parsed = idParamSchema.safeParse({ id })
      if (!parsed.success) {
        throw ApiErrors.validationError("Invalid invoice ID", "id")
      }

      const supabase = await createClient()

      try {
        const signed = await getSignedInvoiceUrl(supabase, user.id, parsed.data.id)
        return createSuccessResponse(signed, HttpStatus.OK, context.requestId)
      } catch (error) {
        if (error instanceof InvoiceError) {
          throw mapInvoiceError(error)
        }
        throw error
      }
    },
    {
      rateLimit: RateLimiters.standard,
    },
  )(request)
}

function mapInvoiceError(error: InvoiceError) {
  switch (error.code) {
    case "not_found":
      return ApiErrors.notFound("Invoice")
    case "forbidden":
      return ApiErrors.forbidden(error.message)
    case "invalid_file":
      return ApiErrors.validationError(error.message)
    default:
      return ApiErrors.internalError(error.message)
  }
}
