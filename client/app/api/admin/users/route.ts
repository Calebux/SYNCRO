import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ApiErrors,
  CommonSchemas,
  createApiRoute,
  createPaginatedResponse,
  createSuccessResponse,
  validateQueryParams,
} from '@/lib/api/index'
import { HttpStatus } from '@/lib/api/types'

export const GET = createApiRoute(
  async (request: NextRequest, context) => {
    const { page, limit } = validateQueryParams(request, CommonSchemas.pagination)
    const from = (page - 1) * limit

    const supabase = await createClient()
    const { data, error, count } = await supabase
      .from('profiles')
      // Only safe fields needed by the admin UI — no tokens, settings, or PII
      // beyond the basics.
      .select('id, email, full_name, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1)

    if (error) {
      console.error(
        `[admin/users] user list query failed (requestId=${context.requestId}): ${error.message}`
      )
      throw ApiErrors.internalError('Failed to fetch users', {
        requestId: context.requestId,
      })
    }

    return createSuccessResponse(
      createPaginatedResponse(data ?? [], page, limit, count ?? 0),
      HttpStatus.OK,
      context.requestId
    )
  },
  {
    requireAuth: true,
    requireRole: ['admin', 'owner'],
  }
)
