import { type NextRequest } from "next/server"
import { HttpStatus } from "@/lib/api/types"
import { createClient } from "@/lib/supabase/server"
import {
  ApiErrors,
  createAuthenticatedApiRoute,
  createSuccessResponse,
  RateLimiters,
  emitAuditEvent,
} from "@/lib/api/index"
import {
  InvoiceError,
  listInvoices,
  uploadInvoice,
  MAX_INVOICE_BYTES,
  INVOICE_CONTENT_TYPE,
} from "@/lib/invoices/invoice-service"

/**
 * GET /api/invoices?subscriptionId=...
 *
 * List the authenticated user's invoices, most recent first.
 */
export const GET = createAuthenticatedApiRoute(
  async (request: NextRequest, context, user) => {
    const supabase = await createClient()
    const subscriptionId = new URL(request.url).searchParams.get("subscriptionId") ?? undefined

    try {
      const invoices = await listInvoices(supabase, user.id, { subscriptionId })
      return createSuccessResponse({ invoices }, HttpStatus.OK, context.requestId)
    } catch (error) {
      if (error instanceof InvoiceError) throw mapInvoiceError(error)
      throw error
    }
  },
  { rateLimit: RateLimiters.standard },
)

/**
 * POST /api/invoices
 *
 * Direct upload of a PDF invoice via multipart form data (`file`, optional
 * `subscriptionId` / `paymentId`). Stores the object in the private bucket and
 * records its metadata.
 */
export const POST = createAuthenticatedApiRoute(
  async (request: NextRequest, context, user) => {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw ApiErrors.validationError("Expected multipart form data with a 'file' field")
    }

    const file = form.get("file")
    if (!(file instanceof File)) {
      throw ApiErrors.validationError("Missing 'file' upload", "file")
    }
    if (file.type !== INVOICE_CONTENT_TYPE) {
      throw ApiErrors.validationError("Only PDF invoices are supported", "file")
    }
    if (file.size > MAX_INVOICE_BYTES) {
      throw ApiErrors.validationError("Invoice exceeds the 10 MB size limit", "file")
    }

    const supabase = await createClient()

    try {
      const invoice = await uploadInvoice(supabase, user.id, {
        body: await file.arrayBuffer(),
        fileName: file.name || "invoice.pdf",
        contentType: file.type,
        sizeBytes: file.size,
        subscriptionId: (form.get("subscriptionId") as string) || null,
        paymentId: (form.get("paymentId") as string) || null,
        source: "upload",
      })

      emitAuditEvent({
        userId: user.id,
        action: "invoice.upload",
        resourceType: "invoice",
        resourceId: invoice.id,
      })

      return createSuccessResponse({ invoice }, HttpStatus.CREATED, context.requestId)
    } catch (error) {
      if (error instanceof InvoiceError) throw mapInvoiceError(error)
      throw error
    }
  },
  { rateLimit: RateLimiters.standard },
)

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
