# API Infrastructure Documentation

This directory contains the core infrastructure for the Next.js API routes, providing authentication, authorization, validation, error handling, rate limiting, and more.

## Structure

```
lib/api/
├── index.ts          # Main exports and route handler factory
├── types.ts          # TypeScript types and enums
├── errors.ts         # Error handling and response utilities
├── auth.ts           # Authentication and authorization
├── validation.ts     # Request validation with Zod
├── rate-limit.ts     # Rate limiting middleware
├── env.ts            # Environment configuration
└── README.md         # This file
```

## Quick Start

### Basic Protected Route

```typescript
import { createAuthenticatedApiRoute, createSuccessResponse, RateLimiters } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { type NextRequest } from "next/server"

export const GET = createAuthenticatedApiRoute(
  async (request: NextRequest, context, user) => {
    // user is guaranteed to be authenticated
    // Your route logic here
    
    return createSuccessResponse(
      { data: "your data" },
      HttpStatus.OK,
      context.requestId
    )
  },
  {
    rateLimit: RateLimiters.standard,
  }
)
```

### Route with Validation

```typescript
import { createAuthenticatedApiRoute, validateRequestBody, RateLimiters } from "@/lib/api/index"
import { z } from "zod"
import { type NextRequest } from "next/server"

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

export const POST = createAuthenticatedApiRoute(
  async (request: NextRequest, context, user) => {
    const body = await validateRequestBody(request, createSchema)
    
    // body is fully validated and typed
    // Your logic here
    
    return createSuccessResponse({ success: true })
  },
  {
    rateLimit: RateLimiters.standard,
  }
)
```

### Dynamic Route with Parameters

```typescript
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  return createAuthenticatedApiRoute(
    async (req, context, user) => {
      // Use id here
      return createSuccessResponse({ deleted: id })
    },
    {
      rateLimit: RateLimiters.standard,
    }
  )(request)
}
```

## Features

### 1. Authentication & Authorization

- **Automatic authentication**: Use `createAuthenticatedApiRoute` for protected endpoints
- **Role-based access**: Use `requireRole: ['admin', 'moderator']`
- **User context**: Access authenticated user in route handler

```typescript
import { requireAuth, requireRole, checkOwnership } from "@/lib/api/auth"

// In route handler
const user = await requireAuth(request)
const admin = await requireRole(request, ['admin'])
checkOwnership(user.id, resourceUserId)
```

### 2. Request Validation

- **Zod schemas**: Type-safe validation
- **Automatic error responses**: Invalid requests return 400 with details
- **Body, query, and params validation**

```typescript
import { validateRequestBody, validateQueryParams, CommonSchemas } from "@/lib/api/index"

// Validate body
const body = await validateRequestBody(request, schema)

// Validate query params
const query = validateQueryParams(request, CommonSchemas.pagination)
```

### 3. Error Handling

- **Standardized error responses**: Consistent error format
- **Automatic error conversion**: Zod errors → API errors
- **Error codes**: Predefined error codes for common scenarios

```typescript
import { ApiErrors } from "@/lib/api/errors"

throw ApiErrors.notFound("User")
throw ApiErrors.unauthorized("Invalid token")
throw ApiErrors.validationError("Invalid email", "email")
```

### 4. Rate Limiting

- **Route policies**: `import`, `payment`, `tagMutation` (env-configurable)
- **General limiters**: `strict`, `standard`, `generous`, `auth`
- **Response headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` (429)

```typescript
import { RateLimiters } from "@/lib/api/index"

// High-risk mutations
rateLimit: RateLimiters.payment
rateLimit: RateLimiters.tagMutation
rateLimit: RateLimiters.import
```

Environment variables (defaults in parentheses):

| Variable | Default |
|----------|---------|
| `RATE_LIMIT_ENABLED` | `true` |
| `RATE_LIMIT_IMPORT_MAX` | `5` |
| `RATE_LIMIT_IMPORT_WINDOW_MINUTES` | `60` |
| `RATE_LIMIT_PAYMENT_MAX` | `10` |
| `RATE_LIMIT_PAYMENT_WINDOW_MINUTES` | `60` |
| `RATE_LIMIT_TAG_MUTATION_MAX` | `30` |
| `RATE_LIMIT_TAG_MUTATION_WINDOW_MINUTES` | `15` |
```

### 5. Environment Management

- **Validated environment**: Type-safe environment variables
- **Runtime validation**: Fails fast on missing/invalid vars

```typescript
import { getEnv, isProduction, isMaintenanceMode } from "@/lib/api/env"

const env = getEnv()
if (isMaintenanceMode()) {
  // Handle maintenance
}
```

## Response Format

All API responses follow a standard format:

### Success Response

```json
{
  "success": true,
  "data": { /* your data */ },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "requestId": "uuid-here"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "field": "email",
    "details": { /* additional details */ }
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "requestId": "uuid-here"
  }
}
```

## Health Check Endpoints

- `GET /api/health` - Basic health check
- `GET /api/health/live` - Liveness probe (Kubernetes)
- `GET /api/health/ready` - Readiness probe (checks dependencies)

## Error Codes

- `UNAUTHORIZED` - Authentication required
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Request validation failed
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `INTERNAL_ERROR` - Server error
- `SERVICE_UNAVAILABLE` - Service temporarily unavailable

## Best Practices

1. **Always use `createApiRoute`** for public endpoints and `createAuthenticatedApiRoute` for protected endpoints
2. **Validate all inputs** with Zod schemas
3. **Use appropriate rate limits** based on endpoint sensitivity
4. **Check ownership** for resource operations
5. **Use typed responses** with TypeScript
6. **Handle errors gracefully** - let the infrastructure handle formatting
7. **Never throw generic `Error` objects** - always use `ApiErrors` for proper HTTP status codes and to avoid exposing stack traces
8. **Use `ApiErrors.unauthorized()` for auth failures** instead of generic errors

## Testing

The infrastructure is designed to be testable:

```typescript
import { createApiRoute } from "@/lib/api/index"
import { createMocks } from "node-mocks-http"

// Mock request
const { req, res } = createMocks({
  method: "GET",
  url: "/api/test",
})

// Test route
const handler = createApiRoute(async (request) => {
  return createSuccessResponse({ test: true })
})
```

## Migration Guide

### Before

```typescript
export async function GET(request: NextRequest) {
  try {
    const user = await getAuth(request)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // ... logic
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
```

### After

```typescript
export const GET = createAuthenticatedApiRoute(
  async (request, context, user) => {
    // user is guaranteed, errors handled automatically
    // ... logic
    return createSuccessResponse({ data })
  }
)
```

## Production Considerations

1. **Rate Limiting**: Consider Redis-based rate limiting for production
2. **Error Logging**: Integrate with Sentry or similar
3. **Monitoring**: Add metrics collection
4. **Caching**: Implement response caching where appropriate
5. **Database**: Use connection pooling and query optimization
