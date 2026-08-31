import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, validateRequestBody, RateLimiters, ApiErrors, checkOwnership } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"
import { updateSubscriptionNotes } from "@/lib/supabase/tags"
import { createClient } from "@/lib/supabase/server"

const notesSchema = z.object({
  notes: z.string().max(5000),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return createAuthenticatedApiRoute(
    async (_req, context, user) => {
      const { notes } = await validateRequestBody(request, notesSchema)

      const supabase = await createClient()

      // Explicitly verify subscription ownership
      const { data: subscription, error: subError } = await supabase
        .from("subscriptions")
        .select("user_id")
        .eq("id", id)
        .single()

      if (subError || !subscription) {
        throw ApiErrors.notFound("Subscription")
      }

      checkOwnership(user.id, subscription.user_id)

      // Proceed with notes update
      await updateSubscriptionNotes(id, user.id, notes)

      return createSuccessResponse({ updated: true }, HttpStatus.OK, context.requestId)
    },
    { rateLimit: RateLimiters.standard },
  )(request)
}
