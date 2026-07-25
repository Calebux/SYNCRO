import { type NextRequest } from "next/server"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { checkOwnership } from "@/lib/api/auth"
import { ApiErrors, createAuthenticatedApiRoute, createSuccessResponse, RateLimiters, validateRequestBody, emitAuditEvent } from "@/lib/api/index"

// Validation schemas
const updateSubscriptionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.string().min(1).optional(),
  price: z.number().positive().optional(),
  status: z.enum(["active", "cancelled", "expired", "paused"]).optional(),
  renewsIn: z.number().int().min(0).optional(),
  email: z.string().email().optional(),
})

const idParamSchema = z.object({
  id: z.string().uuid("Invalid subscription ID"),
})

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  return createAuthenticatedApiRoute(
    async (req: NextRequest, context, user) => {
      if (!id) {
        throw ApiErrors.notFound("Subscription")
      }

      const supabase = await createClient()

      // First, verify ownership
      const { data: subscription, error: fetchError } = await supabase
        .from("subscriptions")
        .select("user_id")
        .eq("id", id)
        .single()

      if (fetchError || !subscription) {
        throw ApiErrors.notFound("Subscription")
      }

      checkOwnership(user.id, subscription.user_id)

      // Delete the subscription
      const { error } = await supabase
        .from("subscriptions")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id)

      if (error) {
        throw ApiErrors.internalError(`Failed to delete subscription: ${error.message}`)
      }

      emitAuditEvent({ userId: user.id, action: "subscription.delete", resourceType: "subscription", resourceId: id })

      return createSuccessResponse(
        { message: "Subscription deleted successfully" },
        HttpStatus.OK,
        context.requestId
      )
    },
    {
      rateLimit: RateLimiters.standard,
    }
  )(request)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  return createAuthenticatedApiRoute(
    async (req: NextRequest, context, user) => {
      if (!id) {
        throw ApiErrors.notFound("Subscription")
      }

      // Validate request body
      const body = await validateRequestBody(req, updateSubscriptionSchema)

      const supabase = await createClient()

      // First, verify ownership
      const { data: subscription, error: fetchError } = await supabase
        .from("subscriptions")
        .select("user_id")
        .eq("id", id)
        .single()

      if (fetchError || !subscription) {
        throw ApiErrors.notFound("Subscription")
      }

      checkOwnership(user.id, subscription.user_id)

      // Prepare update data
      const updateData: Record<string, unknown> = {}
      if (body.name !== undefined) updateData.name = body.name
      if (body.category !== undefined) updateData.category = body.category
      if (body.price !== undefined) updateData.price = body.price
      if (body.status !== undefined) updateData.status = body.status
      if (body.renewsIn !== undefined) updateData.renews_in = body.renewsIn
      if (body.email !== undefined) updateData.email = body.email

      // Update the subscription
      const { data, error } = await supabase
        .from("subscriptions")
        .update(updateData)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single()

      if (error) {
        throw ApiErrors.internalError(`Failed to update subscription: ${error.message}`)
      }

      return createSuccessResponse(
        { subscription: data },
        HttpStatus.OK,
        context.requestId
      )
    },
    {
      rateLimit: RateLimiters.standard,
    }
  )(request)
}
