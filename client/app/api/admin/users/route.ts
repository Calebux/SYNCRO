import { type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  ApiErrors,
  CommonSchemas,
  createApiRoute,
  createPaginatedResponse,
  createSuccessResponse,
  emitAuditEvent,
  validateQueryParams,
} from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"

export const GET = createApiRoute(
  async (request: NextRequest, context, user) => {
    if (!user) {
      throw ApiErrors.unauthorized()
    }

    const { page, limit } = validateQueryParams(request, CommonSchemas.pagination)
    const from = (page - 1) * limit

    const supabase = await createClient()
    const { data, error, count } = await supabase
      .from('profiles')
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

    const usersList = data ?? []

    // Privileged user listing — emit audit event
    emitAuditEvent({
      userId: user.id,
      action: "admin.users_list",
      resourceType: "admin_users",
      metadata: {
        route: "/api/admin/users",
        requestId: context.requestId,
        resultCount: usersList.length,
      },
    })

    return createSuccessResponse(
      createPaginatedResponse(usersList, page, limit, count ?? 0),
      HttpStatus.OK,
      context.requestId
    )
  },
  {
    requireAuth: true,
    requireRole: ["admin", "owner"],
  }
)

