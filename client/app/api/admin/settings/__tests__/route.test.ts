import { describe, it, expect, vi, beforeEach } from "vitest"
import { PUT, GET } from "../route"
import { requireAuth, requireRole } from "@/lib/api/auth"
import { NextRequest } from "next/server"
import { ApiErrors } from "@/lib/api/errors"
import {
  getAdminSettings,
  updateAdminSettings,
} from "@/lib/admin-settings-store"
import { emitAuditEvent } from "@/lib/api/audit"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

vi.mock("@/lib/api/auth", () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
  createRequestContext: vi.fn().mockReturnValue({ requestId: "test-admin-id" }),
}))

vi.mock("@/lib/admin-settings-store", () => ({
  getAdminSettings: vi.fn(),
  updateAdminSettings: vi.fn(),
  resetAdminSettingsStore: vi.fn(),
  getCachedAdminSettings: vi.fn(),
}))

vi.mock("@/lib/api/audit", () => ({
  emitAuditEvent: vi.fn(),
}))

describe("Admin Settings API Route", () => {
  const mockOwner = { id: "user_owner_123", email: "owner@example.com" }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(mockOwner as any)
    vi.mocked(requireRole).mockResolvedValue(true as any)
    vi.mocked(getAdminSettings).mockResolvedValue({
      maintenanceMode: false,
      enableRegistration: true,
      rateLimitThreshold: 100,
    })
  })

  it("persists settings and returns the saved state", async () => {
    const validBody = {
      maintenanceMode: true,
      enableRegistration: false,
      rateLimitThreshold: 100,
    }
    const saved = { ...validBody }
    vi.mocked(updateAdminSettings).mockResolvedValue(saved)

    const request = new NextRequest("http://localhost/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(validBody),
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.updated).toBe(true)
    expect(body.data.settings).toEqual(saved)
    expect(updateAdminSettings).toHaveBeenCalledWith(validBody)
  })

  it("returns merged saved state for partial updates, not only the submitted body", async () => {
    const partialBody = { maintenanceMode: false }
    const saved = {
      maintenanceMode: false,
      enableRegistration: true,
      rateLimitThreshold: 100,
    }
    vi.mocked(updateAdminSettings).mockResolvedValue(saved)

    const request = new NextRequest("http://localhost/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(partialBody),
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.settings).toEqual(saved)
    expect(body.data.settings).not.toEqual(partialBody)
  })

  it("emits an audit event for privileged settings changes", async () => {
    const validBody = { maintenanceMode: true }
    vi.mocked(updateAdminSettings).mockResolvedValue({
      maintenanceMode: true,
      enableRegistration: true,
      rateLimitThreshold: 100,
    })

    const request = new NextRequest("http://localhost/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(validBody),
    })

    await PUT(request)

    expect(emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: mockOwner.id,
        action: "admin.settings_update",
        resourceType: "admin_settings",
        metadata: expect.objectContaining({
          route: "/api/admin/settings",
          requestId: "test-admin-id",
          changedFields: "maintenanceMode",
          maintenanceMode: true,
        }),
      })
    )
  })

  it("rejects unauthenticated users", async () => {
    vi.mocked(requireAuth).mockRejectedValue(ApiErrors.unauthorized())

    const request = new NextRequest("http://localhost/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ maintenanceMode: true }),
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe("UNAUTHORIZED")
    expect(updateAdminSettings).not.toHaveBeenCalled()
  })

  it("rejects non-owner users", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      ApiErrors.forbidden("Requires one of: owner")
    )

    const request = new NextRequest("http://localhost/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ maintenanceMode: true }),
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe("FORBIDDEN")
    expect(updateAdminSettings).not.toHaveBeenCalled()
  })

  it("should reject setting a negative rateLimitThreshold", async () => {
    const request = new NextRequest("http://localhost/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ rateLimitThreshold: -10 }),
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.error.field).toBe("rateLimitThreshold")
  })

  it("should reject setting rateLimitThreshold to 0", async () => {
    const request = new NextRequest("http://localhost/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ rateLimitThreshold: 0 }),
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("VALIDATION_ERROR")
  })

  it("should reject invalid data types", async () => {
    const request = new NextRequest("http://localhost/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ maintenanceMode: "yes" }),
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.error.field).toBe("maintenanceMode")
  })

  it("GET returns persisted settings for owners", async () => {
    const settings = {
      maintenanceMode: true,
      enableRegistration: false,
      rateLimitThreshold: 50,
    }
    vi.mocked(getAdminSettings).mockResolvedValue(settings)

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings")
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.settings).toEqual(settings)
  })
})
