import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  assertAuthenticatedUser,
  requireRole,
  requireMinRole,
  withAuth,
  getAuthenticatedUser,
  UserRole,
  ROLE_HIERARCHY,
} from './auth'
import { createAuthenticatedApiRoute, createSuccessResponse } from './index'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

// Helper: build a mock Supabase client
function mockSupabaseWith({
  user = null as any,
  authError = null as any,
  userRoleRow = null as any,
  userRoleError = null as any,
  profileRow = null as any,
} = {}) {
  // user_roles query chain
  const userRolesSingle = vi.fn().mockResolvedValue({ data: userRoleRow, error: userRoleError })
  const userRolesEq = vi.fn().mockReturnValue({ single: userRolesSingle })
  const userRolesSelect = vi.fn().mockReturnValue({ eq: userRolesEq })

  // profiles query chain
  const profilesSingle = vi.fn().mockResolvedValue({ data: profileRow, error: null })
  const profilesEq = vi.fn().mockReturnValue({ single: profilesSingle })
  const profilesSelect = vi.fn().mockReturnValue({ eq: profilesEq })

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: authError }),
    },
    from: vi.fn((table: string) => {
      if (table === 'user_roles') return { select: userRolesSelect }
      if (table === 'profiles') return { select: profilesSelect }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }
    }),
  }
}

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAuthenticatedUser', () => {
    it('returns user when authenticated', async () => {
      const mockUser = { id: '123', email: 'test@example.com' }
      vi.mocked(createClient).mockResolvedValue(mockSupabaseWith({ user: mockUser }) as any)

      const user = await getAuthenticatedUser(new NextRequest('http://localhost'))
      expect(user).toEqual(mockUser)
    })

    it('throws when not authenticated', async () => {
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: null, authError: new Error('Not authenticated') }) as any
      )
      await expect(getAuthenticatedUser(new NextRequest('http://localhost'))).rejects.toThrow(
        'Invalid or expired session'
      )
    })
  })

  describe('assertAuthenticatedUser', () => {
    it('throws the shared unauthorized error when a protected route has no user', () => {
      expect(() => assertAuthenticatedUser(null)).toThrow('Invalid or expired session')
    })
  })

  describe('getUserRole — authoritative source', () => {
    it('reads role from user_roles table (primary source)', async () => {
      const mockUser = { id: '123', email: 'admin@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'admin' } }) as any
      )

      const result = await requireRole(new NextRequest('http://localhost'), ['admin'])
      expect(result.role).toBe('admin')
    })

    it('falls back to profiles.role when user_roles has no row', async () => {
      const mockUser = { id: '123', email: 'member@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({
          user: mockUser,
          userRoleRow: null,
          userRoleError: { code: 'PGRST116' },
          profileRow: { role: 'member' },
        }) as any
      )

      const result = await requireRole(new NextRequest('http://localhost'), ['member'])
      expect(result.role).toBe('member')
    })

    it('defaults to user role when neither table has a row', async () => {
      const mockUser = { id: '123', email: 'new@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({
          user: mockUser,
          userRoleRow: null,
          userRoleError: { code: 'PGRST116' },
          profileRow: null,
        }) as any
      )

      const result = await requireRole(new NextRequest('http://localhost'), ['user'])
      expect(result.role).toBe('user')
    })
  })

  describe('requireRole', () => {
    it('allows user with correct role', async () => {
      const mockUser = { id: '123', email: 'admin@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'admin' } }) as any
      )

      const result = await requireRole(new NextRequest('http://localhost'), ['admin', 'owner'])
      expect(result.user).toEqual(mockUser)
      expect(result.role).toBe('admin')
    })

    it('returns 403 for user with insufficient role', async () => {
      const mockUser = { id: '123', email: 'viewer@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'viewer' } }) as any
      )

      await expect(
        requireRole(new NextRequest('http://localhost'), ['admin', 'owner'])
      ).rejects.toThrow('Requires one of: admin, owner')
    })

    it('supports multiple allowed roles', async () => {
      const mockUser = { id: '123', email: 'member@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'member' } }) as any
      )

      const result = await requireRole(new NextRequest('http://localhost'), ['admin', 'member', 'owner'])
      expect(result.role).toBe('member')
    })
  })

  describe('requireMinRole', () => {
    it('allows user with exact minimum role', async () => {
      const mockUser = { id: '123', email: 'admin@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'admin' } }) as any
      )

      const result = await requireMinRole(new NextRequest('http://localhost'), 'admin')
      expect(result.role).toBe('admin')
    })

    it('allows user with higher role than minimum', async () => {
      const mockUser = { id: '123', email: 'owner@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'owner' } }) as any
      )

      const result = await requireMinRole(new NextRequest('http://localhost'), 'member')
      expect(result.role).toBe('owner')
    })

    it('returns 403 for user below minimum role', async () => {
      const mockUser = { id: '123', email: 'viewer@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'viewer' } }) as any
      )

      await expect(requireMinRole(new NextRequest('http://localhost'), 'admin')).rejects.toThrow(
        'Requires admin role or higher'
      )
    })
  })

  describe('Route type coverage (admin, team, subscription)', () => {
    // Route type 1: admin route — requires owner
    it('admin/settings: allows owner, denies admin', async () => {
      const mockUser = { id: '1', email: 'owner@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'owner' } }) as any
      )
      const result = await requireRole(new NextRequest('http://localhost'), ['owner'])
      expect(result.role).toBe('owner')

      const adminUser = { id: '2', email: 'admin@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: adminUser, userRoleRow: { role: 'admin' } }) as any
      )
      await expect(requireRole(new NextRequest('http://localhost'), ['owner'])).rejects.toThrow()
    })

    // Route type 2: team route — requires member or above
    it('team/members: allows member, denies viewer', async () => {
      const memberUser = { id: '3', email: 'member@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: memberUser, userRoleRow: { role: 'member' } }) as any
      )
      const result = await requireRole(new NextRequest('http://localhost'), ['member', 'admin', 'owner'])
      expect(result.role).toBe('member')

      const viewerUser = { id: '4', email: 'viewer@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: viewerUser, userRoleRow: { role: 'viewer' } }) as any
      )
      await expect(
        requireRole(new NextRequest('http://localhost'), ['member', 'admin', 'owner'])
      ).rejects.toThrow()
    })

    // Route type 3: admin/users — requires admin or owner
    it('admin/users: allows admin, denies member', async () => {
      const adminUser = { id: '5', email: 'admin@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: adminUser, userRoleRow: { role: 'admin' } }) as any
      )
      const result = await requireRole(new NextRequest('http://localhost'), ['admin', 'owner'])
      expect(result.role).toBe('admin')

      const memberUser = { id: '6', email: 'member@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: memberUser, userRoleRow: { role: 'member' } }) as any
      )
      await expect(
        requireRole(new NextRequest('http://localhost'), ['admin', 'owner'])
      ).rejects.toThrow()
    })
  })

  describe('withAuth', () => {
    it('passes user to handler when authenticated', async () => {
      const mockUser = { id: '123', email: 'test@example.com' }
      vi.mocked(createClient).mockResolvedValue(mockSupabaseWith({ user: mockUser }) as any)

      const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }))
      await withAuth(handler)(new NextRequest('http://localhost'))

      expect(handler).toHaveBeenCalledWith(new NextRequest('http://localhost'), mockUser)
    })

    it('enforces role when requireRole option provided', async () => {
      const mockUser = { id: '123', email: 'admin@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'admin' } }) as any
      )

      const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }))
      await withAuth(handler, { requireRole: ['admin'] })(new NextRequest('http://localhost'))
      expect(handler).toHaveBeenCalled()
    })

    it('rejects when role requirement not met', async () => {
      const mockUser = { id: '123', email: 'user@example.com' }
      vi.mocked(createClient).mockResolvedValue(
        mockSupabaseWith({ user: mockUser, userRoleRow: { role: 'user' } }) as any
      )

      const handler = vi.fn()
      await expect(
        withAuth(handler, { requireRole: ['admin'] })(new NextRequest('http://localhost'))
      ).rejects.toThrow('Requires one of: admin')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('createAuthenticatedApiRoute', () => {
    it('passes the authenticated user to the handler', async () => {
      const mockUser = { id: '123', email: 'test@example.com' }
      vi.mocked(createClient).mockResolvedValue(mockSupabaseWith({ user: mockUser }) as any)

      const handler = vi.fn().mockResolvedValue(createSuccessResponse({ ok: true }))
      const route = createAuthenticatedApiRoute(handler)
      const request = new NextRequest('http://localhost')

      const response = await route(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(handler).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ userId: '123', userEmail: 'test@example.com' }),
        mockUser
      )
    })

    it('returns the standard API error response when the session is missing', async () => {
      vi.mocked(createClient).mockResolvedValue(mockSupabaseWith({ user: null }) as any)

      const handler = vi.fn()
      const route = createAuthenticatedApiRoute(handler)
      const response = await route(new NextRequest('http://localhost'))
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('UNAUTHORIZED')
      expect(body.error.message).toBe('Invalid or expired session')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('ROLE_HIERARCHY', () => {
    it('has correct hierarchy order', () => {
      expect(ROLE_HIERARCHY.owner).toBeGreaterThan(ROLE_HIERARCHY.admin)
      expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.member)
      expect(ROLE_HIERARCHY.member).toBeGreaterThan(ROLE_HIERARCHY.viewer)
      expect(ROLE_HIERARCHY.viewer).toBeGreaterThan(ROLE_HIERARCHY.user)
    })
  })
})
