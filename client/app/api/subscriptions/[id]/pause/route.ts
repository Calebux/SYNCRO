import { type NextRequest } from "next/server"
import { z } from "zod"
import { createAuthenticatedApiRoute, createSuccessResponse, validateRequestBody, RateLimiters, ApiErrors, emitAuditEvent } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { createClient } from "@/lib/supabase/server"
import { checkOwnership } from "@/lib/api/auth"

const pauseSchema = z.object({
  resumeAt: z.string().datetime({ offset: true }).optional(),
  reason: z.string().max(500).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  return createAuthenticatedApiRoute(
    async (req: NextRequest, context, user) => {
      if (!id) throw ApiErrors.notFound("Subscription")

      const body = await validateRequestBody(req, pauseSchema)

      if (body.resumeAt && new Date(body.resumeAt) <= new Date()) {
        throw ApiErrors.validationError("resumeAt must be a future date", "resumeAt")
      }

      const supabase = await createClient()

      const { data: existing, error: fetchError } = await supabase
        .from("subscriptions")
        .select("user_id, status")
        .eq("id", id)
        .single()

      if (fetchError || !existing) throw ApiErrors.notFound("Subscription")
      checkOwnership(user.id, existing.user_id)

      if (existing.status === "paused") {
        throw ApiErrors.conflict("Subscription is already paused")
      }
      if (existing.status === "cancelled") {
        throw ApiErrors.validationError("Cannot pause a cancelled subscription")
      }

      const { data, error } = await supabase
        .from("subscriptions")
        .update({
          status: "paused",
          paused_at: new Date().toISOString(),
          resumes_at: body.resumeAt ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single()

      if (error) throw ApiErrors.internalError(`Failed to pause subscription: ${error.message}`)

      emitAuditEvent({ userId: user.id, action: "subscription.pause", resourceType: "subscription", resourceId: id })

      return createSuccessResponse({ subscription: data }, HttpStatus.OK, context.requestId)
    },
    { rateLimit: RateLimiters.standard }
  )(request)
}
