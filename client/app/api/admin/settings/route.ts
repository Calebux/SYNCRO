import { type NextRequest } from "next/server"
import {
  createApiRoute,
  createSuccessResponse,
  validateRequestBody,
  emitAuditEvent,
  ApiErrors,
} from "@/lib/api/index"
import { updateAdminSettings, getAdminSettings } from "@/lib/admin-settings-store"
import { z } from "zod"

const adminSettingsSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  enableRegistration: z.boolean().optional(),
  rateLimitThreshold: z.number().int().positive().optional(),
})

export const GET = createApiRoute(
  async (_request: NextRequest, context) => {
    const settings = await getAdminSettings()
    return createSuccessResponse({ settings }, undefined, context.requestId)
  },
  {
    requireAuth: true,
    requireRole: ["owner"],
  }
)

export const PUT = createApiRoute(
  async (request: NextRequest, context, user) => {
    if (!user) {
      throw ApiErrors.unauthorized()
    }

    const body = await validateRequestBody(request, adminSettingsSchema)
    const changedFields = Object.keys(body).filter(
      (key) => body[key as keyof typeof body] !== undefined
    )

    if (changedFields.length === 0) {
      throw ApiErrors.validationError("At least one settings field is required")
    }

    let settings
    try {
      settings = await updateAdminSettings(body)
    } catch (error) {
      throw ApiErrors.internalError(
        error instanceof Error ? error.message : "Failed to persist admin settings"
      )
    }

    emitAuditEvent({
      userId: user.id,
      action: "admin.settings_update",
      resourceType: "admin_settings",
      resourceId: "platform",
      metadata: {
        route: "/api/admin/settings",
        requestId: context.requestId,
        changedFields: changedFields.join(","),
        ...Object.fromEntries(
          changedFields.map((field) => [
            field,
            body[field as keyof typeof body] as string | number | boolean,
          ])
        ),
      },
    })

    return createSuccessResponse(
      { updated: true, settings },
      undefined,
      context.requestId
    )
  },
  {
    requireAuth: true,
    requireRole: ["owner"],
  }
)
