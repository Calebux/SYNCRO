import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, validateRequestBody, RateLimiters, ApiErrors } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"
import { addTagToSubscription } from "@/lib/supabase/tags"

const bodySchema = z.object({
  tag_id: z.string().uuid(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return createAuthenticatedApiRoute(
    async (_req, context, user) => {
      const { tag_id } = await validateRequestBody(request, bodySchema)

      try {
        await addTagToSubscription(user.id, id, tag_id)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to assign tag"
        if (message.includes("not found")) {
          throw ApiErrors.notFound(message.includes("Tag") ? "Tag" : "Subscription")
        }
        if (message.includes("does not belong")) {
          throw ApiErrors.forbidden(message)
        }
        throw err
      }

      return createSuccessResponse({ assigned: true }, HttpStatus.OK, context.requestId)
    },
    { rateLimit: RateLimiters.tagMutation },
  )(request)
}
