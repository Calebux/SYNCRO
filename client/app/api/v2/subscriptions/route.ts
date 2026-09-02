import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAuthenticatedApiRoute } from '@/lib/api/index'
import { v2Problem, v2RequestId, v2Success } from '@/lib/api/v2-envelope'
import { CursorError, decodeV2Cursor, encodeV2Cursor } from '@/lib/api/v2-cursor'
import { HttpStatus } from '@/lib/api/types'

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
})

/**
 * v2 list: opaque cursor pagination + success envelope.
 * Legacy offset pagination remains on /api/subscriptions.
 */
export const GET = createAuthenticatedApiRoute(async (request, context, user) => {
  const requestId = context.requestId || v2RequestId(request)
  const url = new URL(request.url)
  const parsed = listQuery.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  })

  if (!parsed.success) {
    return v2Problem({
      type: 'https://syncro.app/problems/validation',
      title: 'Validation Error',
      status: 400,
      detail: 'The request input failed validation.',
      instance: '/api/v2/subscriptions',
      requestId,
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'query',
        message: issue.message,
      })),
    })
  }

  let keyset: { createdAt: string; id: string } | null
  try {
    keyset = decodeV2Cursor(parsed.data.cursor)
  } catch (error) {
    if (error instanceof CursorError) {
      return v2Problem({
        type: 'https://syncro.app/problems/invalid-cursor',
        title: 'Invalid Cursor',
        status: 400,
        detail: error.message,
        instance: '/api/v2/subscriptions',
        requestId,
      })
    }
    throw error
  }

  const { limit } = parsed.data
  const supabase = await createClient()
  let query = supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (keyset) {
    query = query.or(
      `created_at.lt.${keyset.createdAt},and(created_at.eq.${keyset.createdAt},id.lt.${keyset.id})`,
    )
  }

  const { data, error } = await query
  if (error) {
    return v2Problem({
      type: 'https://syncro.app/problems/internal',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'Failed to fetch subscriptions',
      instance: '/api/v2/subscriptions',
      requestId,
    })
  }

  const rows = data || []
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  const nextCursor =
    hasMore && last ? encodeV2Cursor({ createdAt: last.created_at, id: String(last.id) }) : null

  return v2Success(items, requestId, {
    pagination: { next_cursor: nextCursor, has_more: hasMore, limit },
  })
})
