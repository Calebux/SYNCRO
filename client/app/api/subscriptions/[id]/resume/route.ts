import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, RateLimiters, ApiErrors, emitAuditEvent } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { createClient } from "@/lib/supabase/server"
import { checkOwnership } from "@/lib/api/auth"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  return createAuthenticatedApiRoute(
    async (req: NextRequest, context, user) => {
      if (!id) throw ApiErrors.notFound("Subscription")

      const supabase = await createClient()

      const { data: existing, error: fetchError } = await supabase
        .from("subscriptions")
        .select("user_id, status")
        .eq("id", id)
        .single()

      if (fetchError || !existing) throw ApiErrors.notFound("Subscription")
      checkOwnership(user.id, existing.user_id)

      if (existing.status !== "paused") {
        throw ApiErrors.conflict("Subscription is not paused")
      }

      const { data, error } = await supabase
        .from("subscriptions")
        .update({
          status: "active",
          paused_at: null,
          resumes_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single()

      if (error) throw ApiErrors.internalError(`Failed to resume subscription: ${error.message}`)

      emitAuditEvent({ userId: user.id, action: "subscription.resume", resourceType: "subscription", resourceId: id })

      return createSuccessResponse({ subscription: data }, HttpStatus.OK, context.requestId)
    },
    { rateLimit: RateLimiters.standard }
  )(request)
}
