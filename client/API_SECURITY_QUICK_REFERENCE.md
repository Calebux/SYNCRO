# API Security Quick Reference

> **Quick guide for developers working with Next.js API routes**

## 🔒 Security Checklist for New Routes

Before merging any new API route, ensure:

- [ ] Uses `createAuthenticatedApiRoute` for protected endpoints
- [ ] Explicitly verifies resource ownership (don't rely on implicit checks)
- [ ] Applies appropriate rate limiting (`RateLimiters.standard` or `.strict`)
- [ ] Uses `ApiErrors` for consistent error responses
- [ ] Includes security tests (unauthenticated, cross-user, valid access)
- [ ] Updated `SECURITY_AUDIT_MATRIX.md` with new route

---

## 🚀 Quick Start Templates

### Template 1: Simple Protected Route (No Ownership)
```typescript
import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, RateLimiters } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"

export const GET = createAuthenticatedApiRoute(
  async (request: NextRequest, context, user) => {
    // Your logic here - user is authenticated
    const data = await fetchUserData(user.id)
    
    return createSuccessResponse(
      { data },
      HttpStatus.OK,
      context.requestId
    )
  },
  {
    rateLimit: RateLimiters.standard,
  }
)
```

### Template 2: Resource Route with Ownership Check
```typescript
import { type NextRequest } from "next/server"
import { createAuthenticatedApiRoute, createSuccessResponse, RateLimiters, ApiErrors, checkOwnership } from "@/lib/api/index"
import { HttpStatus } from "@/lib/api/types"
import { createClient } from "@/lib/supabase/server"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  return createAuthenticatedApiRoute(
    async (_req, context, user) => {
      const supabase = await createClient()
      
      // ALWAYS verify ownership first
      const { data: resource, error } = await supabase
        .from("your_table")
        .select("user_id")
        .eq("id", id)
        .single()
      
      if (error || !resource) {
        throw ApiErrors.notFound("Resource")
      }
      
      checkOwnership(user.id, resource.user_id)
      
      // Now safe to proceed with operation
      await deleteResource(id)
      
      return createSuccessResponse(
        { deleted: true },
        HttpStatus.OK,
        context.requestId
      )
    },
    {
      rateLimit: RateLimiters.standard,
    }
  )(request)
}
```

### Template 3: Public Endpoint (Health Check, Webhooks)
```typescript
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  // No auth required for public endpoints
  const data = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
  }
  
  return NextResponse.json({ success: true, data })
}
```

---

## ⚠️ Common Security Mistakes

### ❌ DON'T: Skip Ownership Checks
```typescript
// VULNERABLE - User can access ANY resource
export async function DELETE(request, { params }) {
  const { id } = await params
  await deleteResource(id) // ❌ No ownership check
  return NextResponse.json({ deleted: true })
}
```

### ✅ DO: Always Verify Ownership
```typescript
// SECURE - Verify ownership first
export async function DELETE(request, { params }) {
  const { id } = await params
  const supabase = await createClient()
  
  const { data: resource } = await supabase
    .from("resources")
    .select("user_id")
    .eq("id", id)
    .single()
  
  if (!resource) throw ApiErrors.notFound("Resource")
  checkOwnership(user.id, resource.user_id) // ✅ Explicit check
  
  await deleteResource(id)
  return NextResponse.json({ deleted: true })
}
```

---

### ❌ DON'T: Rely on Implicit Database Filtering
```typescript
// WEAK - Relies on database filtering
export async function PATCH(request, { params }) {
  const { id } = await params
  const { data } = await request.json()
  
  // ⚠️ If this fails silently, user won't know
  await updateResource(id, user.id, data)
  return NextResponse.json({ updated: true })
}
```

### ✅ DO: Explicit Verification Before Operation
```typescript
// SECURE - Explicit verification
export async function PATCH(request, { params }) {
  const { id } = await params
  const { data } = await request.json()
  
  const supabase = await createClient()
  const { data: resource } = await supabase
    .from("resources")
    .select("user_id")
    .eq("id", id)
    .single()
  
  if (!resource) throw ApiErrors.notFound("Resource")
  checkOwnership(user.id, resource.user_id) // ✅ Explicit check
  
  await updateResource(id, user.id, data)
  return NextResponse.json({ updated: true })
}
```

---

### ❌ DON'T: Forget Rate Limiting on Sensitive Operations
```typescript
// VULNERABLE - No rate limiting
export const POST = createAuthenticatedApiRoute(
  async (request, context, user) => {
    await processPayment(user.id, amount)
    return createSuccessResponse({ success: true })
  }
)
```

### ✅ DO: Apply Appropriate Rate Limiting
```typescript
// SECURE - Rate limiting applied
export const POST = createAuthenticatedApiRoute(
  async (request, context, user) => {
    await processPayment(user.id, amount)
    return createSuccessResponse({ success: true })
  },
  {
    rateLimit: RateLimiters.strict, // ✅ Strict for payments
  }
)
```

---

### ❌ DON'T: Use Generic Error Messages
```typescript
// INCONSISTENT
if (!resource) throw new Error("Not found")
```

### ✅ DO: Use ApiErrors for Consistency
```typescript
// CONSISTENT
if (!resource) throw ApiErrors.notFound("Resource")
if (user.id !== resource.user_id) throw ApiErrors.forbidden()
```

---

## 🎯 Rate Limiting Guidelines

| Operation Type | Rate Limiter | Default limit (env override) |
|----------------|--------------|------------------------------|
| Read operations (GET) | `RateLimiters.standard` | 100 / 15 min |
| Tag mutations (POST/DELETE tags, assign/remove) | `RateLimiters.tagMutation` | 30 / 15 min (`RATE_LIMIT_TAG_MUTATION_*`) |
| CSV import (`POST /api/subscriptions/import`) | `RateLimiters.import` | 5 / hour (`RATE_LIMIT_IMPORT_*`) |
| Payments & refunds | `RateLimiters.payment` | 10 / hour (`RATE_LIMIT_PAYMENT_*`) |

Responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` on `429`.
| Public endpoints (health checks) | None | - |

---

## 🧪 Security Test Template

```typescript
describe('POST /api/your-route', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await fetch('/api/your-route', {
      method: 'POST',
      body: JSON.stringify({ data: 'test' })
    })
    expect(response.status).toBe(401)
  })
  
  it('should reject cross-user access', async () => {
    const victimResource = await createResource(victimUser)
    const response = await fetch(`/api/your-route/${victimResource.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: JSON.stringify({ data: 'test' })
    })
    expect(response.status).toBe(403)
  })
  
  it('should allow owner access', async () => {
    const resource = await createResource(ownerUser)
    const response = await fetch(`/api/your-route/${resource.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ data: 'test' })
    })
    expect(response.status).toBe(200)
  })
})
```

---

## 📚 Key Imports

```typescript
// API Infrastructure
import { 
  createApiRoute,
  createSuccessResponse,
  RateLimiters,
  ApiErrors,
  checkOwnership,
  validateRequestBody
} from "@/lib/api/index"

// Types
import { HttpStatus } from "@/lib/api/types"
import { type NextRequest } from "next/server"

// Supabase
import { createClient } from "@/lib/supabase/server"

// Validation
import { z } from "zod"
```

---

## 🔍 Debugging Security Issues

### Check Authentication
```typescript
console.log('User:', user?.id, user?.email)
console.log('Request ID:', context.requestId)
```

### Check Ownership
```typescript
console.log('Resource owner:', resource.user_id)
console.log('Requesting user:', user.id)
console.log('Match:', resource.user_id === user.id)
```

### Check Rate Limiting
```typescript
// Rate limit errors will be thrown automatically
// Check response headers for rate limit info
console.log('X-RateLimit-Limit:', response.headers.get('X-RateLimit-Limit'))
console.log('X-RateLimit-Remaining:', response.headers.get('X-RateLimit-Remaining'))
```

---

## 📖 Further Reading

- **Full Security Audit:** `client/SECURITY_AUDIT_MATRIX.md`
- **Implementation Details:** `ISSUE_493_IMPLEMENTATION_SUMMARY.md`
- **Auth Helpers:** `client/lib/api/auth.ts`
- **Error Handling:** `client/lib/api/errors.ts`
- **Rate Limiting:** `client/lib/api/rate-limit.ts`

---

## 🆘 Need Help?

1. **Review the security matrix** for your route type
2. **Check existing routes** for similar patterns
3. **Run security tests** before merging
4. **Ask for security review** if unsure

---

**Remember:** Security is not optional. Every route must be secure by default.
