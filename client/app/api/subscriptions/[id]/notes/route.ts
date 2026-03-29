import { type NextRequest } from "next/server"
import { createApiRoute, createSuccessResponse, validateRequestBody, RateLimiters } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"
import { updateSubscriptionNotes } from "@/lib/supabase/tags"

const notesSchema = z.object({
  notes: z.string().max(5000),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return createApiRoute(
    async (_req, context, user) => {
      if (!user) throw new Error("User not authenticated")

      const { notes } = await validateRequestBody(request, notesSchema)
      await updateSubscriptionNotes(id, user.id, notes)

      return createSuccessResponse({ updated: true }, HttpStatus.OK, context.requestId)
    },
    { requireAuth: true, rateLimit: RateLimiters.standard },
  )(request, { params: { id } })
}
