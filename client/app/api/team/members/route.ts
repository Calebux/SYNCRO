import { NextRequest } from 'next/server'
import { createApiRoute, createSuccessResponse } from '@/lib/api'

export const GET = createApiRoute(
  async (request: NextRequest) => {
    return createSuccessResponse({ members: [] })
  },
  {
    requireAuth: true,
    requireRole: ['member', 'admin', 'owner'],
  }
)
