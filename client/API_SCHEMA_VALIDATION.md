# API Schema Validation Guidelines

> **Status**: Completed  
> **Last Updated**: 2026-05-27  
> **Backlog ID**: #27

---

## 1. Overview
All mutating API routes (POST, PUT, PATCH, DELETE) in SYNCRO must enforce request schema validation. Validation failures must yield a consistent, user-friendly, and secure standard response format. 

By leveraging the application's central validation utilities, we prevent malformed payloads, enforce data integrity, and guarantee that API consumers receive actionable validation errors in the exact same format across all endpoints.

---

## 2. Standard Error Response Format
When a validation check fails, the API returns a `400 Bad Request` with a JSON payload in this exact format:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Name is required",
    "field": "name",
    "details": {
      "errors": [
        {
          "field": "name",
          "message": "Name is required",
          "code": "too_small"
        }
      ]
    }
  },
  "meta": {
    "timestamp": "2026-05-27T12:28:00.000Z",
    "requestId": "some-unique-uuid-here"
  }
}
```

This structural uniformity is governed centrally by `zodErrorToApiError` and `createErrorResponse` in `client/lib/api/errors.ts`.

---

## 3. API Route Validation Checklist
When creating or modifying an API endpoint:
1. **Always use Zod** to declare your request shape schema.
2. **Never parse raw requests manually** with `request.json()` followed by custom parsing logic.
3. **Always use `validateRequestBody(request, schema)`** for parsing request bodies.
4. **Always wrap route handlers using `createApiRoute`** (which automatically handles thrown errors, including Zod's `ValidationError`, returning the correct `400 Bad Request`).
5. **Always add invalid input path tests** verifying that invalid parameters trigger `VALIDATION_ERROR` responses with correct field tracking.

---

## 4. Example Mutating Route Pattern

Below is the standard, production-ready design pattern for a mutating endpoint:

```typescript
import { type NextRequest } from "next/server"
import { createApiRoute, createSuccessResponse, validateRequestBody, ApiErrors, RateLimiters } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { z } from "zod"

// 1. Declare payload schema
const customFeatureSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  limit: z.number().int().positive("Limit must be positive"),
  enabled: z.boolean().default(true),
})

// 2. Wrap route with createApiRoute
export const POST = createApiRoute(
  async (request: NextRequest, context, user) => {
    if (!user) {
      throw ApiErrors.unauthorized()
    }

    // 3. Enforce schema validation
    const payload = await validateRequestBody(request, customFeatureSchema)

    // 4. Proceed with logic and return createSuccessResponse
    return createSuccessResponse(
      { feature: payload },
      HttpStatus.CREATED,
      context.requestId
    )
  },
  {
    requireAuth: true,
    rateLimit: RateLimiters.standard,
  }
)
```

---

## 5. Audit & Compliance Matrix

| Mutating Route | Method | Payload Scheme | Compliance Status |
|---|---|---|---|
| `/api/payments` | POST | `paymentSchema` | ✅ Compliant |
| `/api/payments/paypal/capture` | POST | `captureSchema` | ✅ Refactored |
| `/api/payments/refund` | POST | `refundSchema` | ✅ Compliant |
| `/api/admin/settings` | PUT | `adminSettingsSchema` | ✅ Added Validation |
| `/api/subscriptions` | POST | `createSubscriptionSchema` | ✅ Compliant |
| `/api/subscriptions/[id]` | PUT | `updateSubscriptionSchema` | ✅ Compliant |
| `/api/subscriptions/[id]/pause` | POST | `pauseSchema` | ✅ Compliant |
| `/api/subscriptions/[id]/notes` | POST | `notesSchema` | ✅ Compliant |
| `/api/subscriptions/[id]/tags` | POST | `bodySchema` | ✅ Compliant |
| `/api/subscriptions/import` | POST | `rowSchema` (per row parsing) | ✅ Compliant |
| `/api/tags` | POST | `createTagSchema` | ✅ Compliant |
| `/api/csp-report` | POST | `CspReportSchema` | ✅ Compliant |
