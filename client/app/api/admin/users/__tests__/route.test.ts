import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../route"
import { requireAuth, requireRole } from "@/lib/api/auth"
import { NextRequest } from "next/server"
import { ApiErrors } from "@/lib/api/errors"
import { emitAuditEvent } from "@/lib/api/audit"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

vi.mock("@/lib/api/auth", () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
  createRequestContext: vi.fn().mockReturnValue({ requestId: "admin-users-req" }),
}))

vi.mock("@/lib/api/audit", () => ({
  emitAuditEvent: vi.fn(),
}))

describe("Admin Users API Route", () => {
  const mockAdmin = { id: "admin_1", email: "admin@example.com" }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(mockAdmin as any)
    vi.mocked(requireRole).mockResolvedValue(true as any)
  })

  it("emits an audit event on successful privileged user-list access", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/admin/users")
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: mockAdmin.id,
        action: "admin.users_list",
        resourceType: "admin_users",
        metadata: expect.objectContaining({
          route: "/api/admin/users",
          requestId: "admin-users-req",
        }),
      })
    )
  })

  it("rejects unauthenticated users without emitting audit", async () => {
    vi.mocked(requireAuth).mockRejectedValue(ApiErrors.unauthorized())

    const response = await GET(
      new NextRequest("http://localhost/api/admin/users")
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe("UNAUTHORIZED")
    expect(emitAuditEvent).not.toHaveBeenCalled()
  })

  it("rejects forbidden users without emitting audit", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      ApiErrors.forbidden("Requires one of: admin, owner")
    )

    const response = await GET(
      new NextRequest("http://localhost/api/admin/users")
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe("FORBIDDEN")
    expect(emitAuditEvent).not.toHaveBeenCalled()
  })
})
