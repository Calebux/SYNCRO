/**
 * DEPRECATED: Legacy Offline Sync Route
 * 
 * This route is deprecated and kept only for backward compatibility.
 * New offline mutations should be queued using useOfflineQueue() hook,
 * which replays them through the normal API (/api/subscriptions).
 * 
 * Migration: The offline queue system now goes through the same write path
 * as online mutations, ensuring all auth, validation, and middleware apply.
 * This eliminates the security bugs that came from bypassing the normal API.
 * 
 * Old path: POST /api/sync/offline (shortcut with duplicated validation)
 * New path: Queued mutations replay through POST/PUT/DELETE /api/subscriptions
 */

import { type NextRequest } from "next/server"
import {
  ApiErrors,
  createAuthenticatedApiRoute,
  createSuccessResponse,
} from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"

export const POST = createAuthenticatedApiRoute(
  async (request: NextRequest, context, user) => {
    // This endpoint is deprecated. Return a clear error message.
    throw ApiErrors.internalError(
      'Offline sync endpoint is deprecated. Use useOfflineQueue() hook instead. ' +
      'Mutations are now queued durably and replayed through the normal API.',
      { deprecated: true, replacement: 'useOfflineQueue() hook' }
    )
  },
  {
    skipCsrf: true, // Legacy compatibility
  }
)
