import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, RateLimiters, ApiErrors } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { removeTagFromSubscription } from "@/lib/supabase/tags"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> },
) {
  const { id, tagId } = await params

  return createAuthenticatedApiRoute(
    async (_req, context, user) => {
      try {
        await removeTagFromSubscription(user.id, id, tagId)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to remove tag"
        if (message.includes("not found")) {
          throw ApiErrors.notFound(message.includes("Tag") ? "Tag" : "Subscription")
        }
        if (message.includes("does not belong")) {
          throw ApiErrors.forbidden(message)
        }
        throw err
      }

      return createSuccessResponse({ removed: true }, HttpStatus.OK, context.requestId)
    },
    { rateLimit: RateLimiters.tagMutation },
  )(request)
}
