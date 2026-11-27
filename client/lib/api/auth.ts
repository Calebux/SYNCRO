/**
 * Authentication & Authorization Middleware
 * Provides utilities for protecting API routes and checking user permissions
 */

import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApiErrors } from './errors'
import { RequestContext } from './types'

/**
 * Get authenticated user from request
 */
export async function getAuthenticatedUser(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw ApiErrors.unauthorized('Invalid or expired session')
  }

  return user
}

export type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>

/**
 * Assert that route infrastructure supplied an authenticated user.
 * This keeps auth failure responses consistent even when route handlers are
 * tested with mocked auth functions.
 */
export function assertAuthenticatedUser(
  user: Awaited<ReturnType<typeof getAuthenticatedUser>> | null | undefined
): asserts user is AuthenticatedUser {
  if (!user) {
    throw ApiErrors.unauthorized('Invalid or expired session')
  }
}

/**
 * Create request context from request
 */
export function createRequestContext(request: NextRequest, userId?: string): RequestContext {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID()
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 
             request.headers.get('x-real-ip') || 
             'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'

  return {
    userId,
    requestId,
    ip,
    userAgent,
    timestamp: new Date(),
  }
}

/**
 * Require authentication middleware
 * Throws if user is not authenticated
 */
export async function requireAuth(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  return user
}

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer' | 'user'

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  owner: 5,
  admin: 4,
  member: 3,
  viewer: 2,
  user: 1,
}

async function getUserRole(userId: string): Promise<UserRole> {
  const supabase = await createClient()

  // Primary: authoritative user_roles table (replaces user_metadata.role)
  const { data: roleRow, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single()

  if (!roleError && roleRow?.role) {
    return roleRow.role as UserRole
  }

  // Fallback: profiles.role for users not yet in user_roles
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  return (profile?.role as UserRole) || 'user'
}

export async function requireRole(
  request: NextRequest,
  allowedRoles: UserRole[]
) {
  const user = await getAuthenticatedUser(request)
  const userRole = await getUserRole(user.id)
  
  if (!allowedRoles.includes(userRole)) {
    throw ApiErrors.forbidden(`Requires one of: ${allowedRoles.join(', ')}`)
  }

  return { user, role: userRole }
}

/**
 * Optional authentication - returns user if authenticated, null otherwise
 */
export async function optionalAuth(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user
  } catch {
    return null
  }
}

/**
 * Check if user owns resource
 * Helper for resource-level authorization
 */
export function checkOwnership(userId: string, resourceUserId: string) {
  if (userId !== resourceUserId) {
    throw ApiErrors.forbidden('You do not have permission to access this resource')
  }
}

export async function requireMinRole(
  request: NextRequest,
  minRole: UserRole
) {
  const user = await getAuthenticatedUser(request)
  const userRole = await getUserRole(user.id)
  
  if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[minRole]) {
    throw ApiErrors.forbidden(`Requires ${minRole} role or higher`)
  }

  return { user, role: userRole }
}

export function withAuth<T extends unknown[]>(
  handler: (request: NextRequest, user: Awaited<ReturnType<typeof getAuthenticatedUser>>, ...args: T) => Promise<Response>,
  options?: {
    requireRole?: UserRole[]
  }
) {
  return async (request: NextRequest, ...args: T): Promise<Response> => {
    let user = await getAuthenticatedUser(request)
    
    if (options?.requireRole) {
      const result = await requireRole(request, options.requireRole)
      user = result.user
    }

    return handler(request, user, ...args)
  }
}
