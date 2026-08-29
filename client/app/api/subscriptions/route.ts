/**
 * Subscriptions API Route
 * 
 * Handles all subscription operations (create, update, delete).
 * Both online mutations and queued offline mutations replay through this endpoint.
 */

import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ApiException,
  ApiErrors,
  RateLimiters,
  createAuthenticatedApiRoute,
  createSuccessResponse,
  validateRequestBody,
} from '@/lib/api/index'
import { ErrorCode, HttpStatus } from '@/lib/api/types'
import { trackError } from '@/lib/telemetry'
import { z } from 'zod'

/**
 * Subscription schema for validation
 */
const subscriptionSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().optional(),
  price: z.number().nonnegative().optional(),
  icon: z.string().optional(),
  renews_in: z.number().optional(),
  color: z.string().optional(),
  renewal_url: z.string().optional(),
  tags: z.array(z.string()).optional(),
  email_account_id: z.string().optional(),
  has_api_key: z.boolean().optional(),
  is_trial: z.boolean().optional(),
  trial_ends_at: z.string().optional(),
  price_after_trial: z.number().optional(),
  source: z.string().optional(),
  manually_edited: z.boolean().optional(),
  edited_fields: z.array(z.string()).optional(),
  pricing_type: z.string().optional(),
  billing_cycle: z.string().optional(),
  active_until: z.string().optional(),
  paused_at: z.string().optional(),
  resumes_at: z.string().optional(),
  price_range: z.object({ min: z.number(), max: z.number() }).optional(),
  price_history: z.array(z.record(z.unknown())).optional(),
})

type Subscription = z.infer<typeof subscriptionSchema>

/**
 * POST /api/subscriptions - Create a new subscription
 */
export const POST = createAuthenticatedApiRoute(
  async (request, context, user) => {
    const supabase = await createClient()

    try {
      const body = await validateRequestBody(request, subscriptionSchema)
      
      const { data, error } = await supabase
        .from('subscriptions')
        .insert([
          {
            ...body,
            user_id: user.id,
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single()

      if (error) {
        trackError('subscription_create_failed', {
          user_id: user.id,
          error: error.message,
        })
        throw ApiErrors.internalError('Failed to create subscription', {
          code: error.code,
          message: error.message,
        })
      }

      return createSuccessResponse(data, HttpStatus.CREATED, context.requestId)
    } catch (error) {
      if (error instanceof ApiException) throw error
      trackError('subscription_create_error', {
        user_id: user.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      throw ApiErrors.internalError('Failed to create subscription')
    }
  },
  {
    rateLimit: () => RateLimiters.standard(request),
    idempotent: true,
  }
)

/**
 * PUT /api/subscriptions/:id - Update a subscription
 */
export const PUT = createAuthenticatedApiRoute(
  async (request, context, user) => {
    const supabase = await createClient()

    try {
      // Extract ID from URL
      const url = new URL(request.url)
      const id = url.pathname.split('/').pop()
      
      if (!id) {
        throw ApiErrors.validationError('Subscription ID is required', 'id')
      }

      const body = await validateRequestBody(
        request,
        subscriptionSchema.partial()
      )

      // Verify subscription exists and belongs to user
      const { data: existing, error: fetchError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          throw ApiErrors.notFound('Subscription')
        }
        throw ApiErrors.internalError('Failed to fetch subscription')
      }

      // Update subscription
      const { data, error } = await supabase
        .from('subscriptions')
        .update(body)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) {
        trackError('subscription_update_failed', {
          user_id: user.id,
          subscription_id: id,
          error: error.message,
        })
        throw ApiErrors.internalError('Failed to update subscription')
      }

      return createSuccessResponse(data, HttpStatus.OK, context.requestId)
    } catch (error) {
      if (error instanceof ApiException) throw error
      trackError('subscription_update_error', {
        user_id: user.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      throw ApiErrors.internalError('Failed to update subscription')
    }
  },
  {
    rateLimit: () => RateLimiters.standard(request),
    idempotent: true,
  }
)

/**
 * DELETE /api/subscriptions/:id - Delete a subscription
 */
export const DELETE = createAuthenticatedApiRoute(
  async (request, context, user) => {
    const supabase = await createClient()

    try {
      // Extract ID from URL
      const url = new URL(request.url)
      const id = url.pathname.split('/').pop()
      
      if (!id) {
        throw ApiErrors.validationError('Subscription ID is required', 'id')
      }

      // Verify subscription exists and belongs to user
      const { error: fetchError } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          throw ApiErrors.notFound('Subscription')
        }
        throw ApiErrors.internalError('Failed to fetch subscription')
      }

      // Delete subscription
      const { error } = await supabase
        .from('subscriptions')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) {
        trackError('subscription_delete_failed', {
          user_id: user.id,
          subscription_id: id,
          error: error.message,
        })
        throw ApiErrors.internalError('Failed to delete subscription')
      }

      return createSuccessResponse({}, HttpStatus.OK, context.requestId)
    } catch (error) {
      if (error instanceof ApiException) throw error
      trackError('subscription_delete_error', {
        user_id: user.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      throw ApiErrors.internalError('Failed to delete subscription')
    }
  },
  {
    rateLimit: () => RateLimiters.standard(request),
    idempotent: true,
  }
)
