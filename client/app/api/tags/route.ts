import { type NextRequest } from "next/server"
import { createApiRoute, createSuccessResponse, validateRequestBody, RateLimiters } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"
import { fetchUserTags, createTag } from "@/lib/supabase/tags"

const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex colour")
    .default("#6366f1"),
})

export const GET = createApiRoute(
  async (_req, context, user) => {
    if (!user) throw new Error("User not authenticated")

    const tags = await fetchUserTags(user.id)
    return createSuccessResponse({ tags }, HttpStatus.OK, context.requestId)
  },
  { requireAuth: true, rateLimit: RateLimiters.standard },
)

export const POST = createApiRoute(
  async (request, context, user) => {
    if (!user) throw new Error("User not authenticated")

    const { name, color } = await validateRequestBody(request as NextRequest, createTagSchema)
    const tag = await createTag(user.id, name, color)

    return createSuccessResponse({ tag }, HttpStatus.CREATED, context.requestId)
  },
  { requireAuth: true, rateLimit: RateLimiters.standard },
)
