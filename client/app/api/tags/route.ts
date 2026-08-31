import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, validateRequestBody, RateLimiters } from "@/lib/api/index"
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

export const GET = createAuthenticatedApiRoute(
  async (_req, context, user) => {
    const tags = await fetchUserTags(user.id)
    return createSuccessResponse({ tags }, HttpStatus.OK, context.requestId)
  },
  { rateLimit: RateLimiters.standard },
)

export const POST = createAuthenticatedApiRoute(
  async (request, context, user) => {
    const { name, color } = await validateRequestBody(request as NextRequest, createTagSchema)
    const tag = await createTag(user.id, name, color)

    return createSuccessResponse({ tag }, HttpStatus.CREATED, context.requestId)
  },
  { rateLimit: RateLimiters.tagMutation },
)
