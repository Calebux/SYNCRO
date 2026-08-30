import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, RateLimiters } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { deleteTag } from "@/lib/supabase/tags"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return createAuthenticatedApiRoute(
    async (_req, context, user) => {
      await deleteTag(id, user.id)
      return createSuccessResponse({ deleted: true }, HttpStatus.OK, context.requestId)
    },
    { rateLimit: RateLimiters.tagMutation },
  )(request)
}
