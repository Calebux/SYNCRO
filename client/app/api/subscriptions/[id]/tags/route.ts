import { type NextRequest } from "next/server"
import { createApiRoute, createSuccessResponse, validateRequestBody, RateLimiters } from "@/lib/api/index"
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

  return createApiRoute(
    async (_req, context, user) => {
      if (!user) throw new Error("User not authenticated")

      const { tag_id } = await validateRequestBody(request, bodySchema)
      await addTagToSubscription(id, tag_id)

      return createSuccessResponse({ assigned: true }, HttpStatus.OK, context.requestId)
    },
    { requireAuth: true, rateLimit: RateLimiters.standard },
  )(request, { params: { id } })
}
