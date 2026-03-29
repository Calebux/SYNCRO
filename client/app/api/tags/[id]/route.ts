import { type NextRequest } from "next/server"
import { createApiRoute, createSuccessResponse, RateLimiters } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { deleteTag } from "@/lib/supabase/tags"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return createApiRoute(
    async (_req, context, user) => {
      if (!user) throw new Error("User not authenticated")

      await deleteTag(id, user.id)
      return createSuccessResponse({ deleted: true }, HttpStatus.OK, context.requestId)
    },
    { requireAuth: true, rateLimit: RateLimiters.standard },
  )(request, { params: { id } })
}
