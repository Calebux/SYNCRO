# API Route Security Audit Matrix - Issue #493

## Executive Summary

**Audit Date:** 2026-04-27  
**Total Routes Audited:** 18  
**Critical Issues:** 4  
**High Priority Issues:** 3  
**Medium Priority Issues:** 2  
**Status:** ⚠️ **ACTION REQUIRED**

---

## Security Matrix

| Route | Method | Auth Required | Ownership Check | Rate Limit | Status | Priority |
|-------|--------|---------------|-----------------|------------|--------|----------|
| `/api/health` | GET | ❌ No | N/A | ❌ No | ✅ OK | - |
| `/api/health/live` | GET | ❌ No | N/A | ❌ No | ✅ OK | - |
| `/api/health/ready` | GET | ❌ No | N/A | ❌ No | ✅ OK | - |
| `/api/csp-report` | POST | ❌ No | N/A | ❌ No | ✅ OK | - |
| `/api/webhooks/stripe` | POST | ⚠️ Signature | N/A | ❌ No | ⚠️ PARTIAL | HIGH |
| `/api/subscriptions` | GET | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK | - |
| `/api/subscriptions` | POST | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK | - |
| `/api/subscriptions/[id]` | DELETE | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK | - |
| `/api/subscriptions/[id]` | PATCH | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK | - |
| `/api/subscriptions/[id]/notes` | PATCH | ✅ Yes | ⚠️ PARTIAL | ✅ Yes | ⚠️ ISSUE | CRITICAL |
| `/api/subscriptions/[id]/tags` | POST | ✅ Yes | ❌ NO | ✅ Yes | ❌ ISSUE | CRITICAL |
| `/api/subscriptions/[id]/tags/[tagId]` | DELETE | ✅ Yes | ❌ NO | ✅ Yes | ❌ ISSUE | CRITICAL |
| `/api/subscriptions/import` | GET | ❌ No | N/A | ❌ No | ✅ OK | - |
| `/api/subscriptions/import` | POST | ✅ Yes | ✅ Yes | ❌ No | ⚠️ ISSUE | HIGH |
| `/api/tags` | GET | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK | - |
| `/api/tags` | POST | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK | - |
| `/api/tags/[id]` | DELETE | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK | - |
| `/api/analytics` | GET | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK | - |
| `/api/payments` | POST | ✅ Yes | ✅ Yes | ✅ Yes | ✅ OK | - |
| `/api/payments/refund` | POST | ✅ Yes | ⚠️ PARTIAL | ✅ Yes | ⚠️ ISSUE | HIGH |

---

## Critical Issues

### 🔴 CRITICAL #1: Missing Ownership Check in Tag Assignment
**Route:** `POST /api/subscriptions/[id]/tags`  
**File:** `client/app/api/subscriptions/[id]/tags/route.ts`

**Issue:**
- No verification that the subscription belongs to the authenticated user
- User can assign tags to ANY subscription by guessing IDs
- Potential for cross-user data manipulation

**Attack Vector:**
```bash
# Attacker can tag other users' subscriptions
curl -X POST /api/subscriptions/[victim-sub-id]/tags \
  -H "Authorization: Bearer [attacker-token]" \
  -d '{"tag_id": "attacker-tag-id"}'
```

**Impact:** HIGH - Cross-user data manipulation

---

### 🔴 CRITICAL #2: Missing Ownership Check in Tag Removal
**Route:** `DELETE /api/subscriptions/[id]/tags/[tagId]`  
**File:** `client/app/api/subscriptions/[id]/tags/[tagId]/route.ts`

**Issue:**
- No verification that the subscription belongs to the authenticated user
- User can remove tags from ANY subscription
- Potential for cross-user data manipulation

**Attack Vector:**
```bash
# Attacker can remove tags from other users' subscriptions
curl -X DELETE /api/subscriptions/[victim-sub-id]/tags/[tag-id] \
  -H "Authorization: Bearer [attacker-token]"
```

**Impact:** HIGH - Cross-user data manipulation

---

### 🔴 CRITICAL #3: Incomplete Ownership Check in Notes Update
**Route:** `PATCH /api/subscriptions/[id]/notes`  
**File:** `client/app/api/subscriptions/[id]/notes/route.ts`

**Issue:**
- Ownership check is in the helper function (`updateSubscriptionNotes`)
- No explicit verification in the route handler
- Relies on database-level filtering which may fail silently

**Current Implementation:**
```typescript
// Route handler - no ownership check
export async function PATCH(request, { params }) {
  const { id } = await params
  return createApiRoute(async (_req, context, user) => {
    if (!user) throw new Error("User not authenticated")
    const { notes } = await validateRequestBody(request, notesSchema)
    await updateSubscriptionNotes(id, user.id, notes) // Ownership check here
    return createSuccessResponse({ updated: true }, HttpStatus.OK, context.requestId)
  }, { requireAuth: true, rateLimit: RateLimiters.standard })(request)
}
```

**Risk:** MEDIUM - Relies on implicit database filtering

---

### 🔴 CRITICAL #4: Missing Ownership Check in Refund
**Route:** `POST /api/payments/refund`  
**File:** `client/app/api/payments/refund/route.ts`

**Issue:**
- No verification that the payment belongs to the authenticated user
- User can potentially refund ANY transaction by knowing the transaction ID
- Critical financial security vulnerability

**Attack Vector:**
```bash
# Attacker can refund other users' payments
curl -X POST /api/payments/refund \
  -H "Authorization: Bearer [attacker-token]" \
  -d '{"transactionId": "victim-transaction-id"}'
```

**Impact:** CRITICAL - Financial fraud potential

---

## High Priority Issues

### ✅ RESOLVED: Route-Level Rate Limiting (Issue #29)
**Routes:** `POST /api/subscriptions/import`, payment mutations, tag mutations

**Status:** Env-configurable `RateLimiters.import`, `RateLimiters.payment`, and `RateLimiters.tagMutation` with `X-RateLimit-*` and `Retry-After` headers.

---

### 🟠 HIGH #2: Webhook Signature Verification Only
**Route:** `POST /api/webhooks/stripe`  
**File:** `client/app/api/webhooks/stripe/route.ts`

**Issue:**
- Relies solely on Stripe signature verification
- No additional IP allowlisting or request validation
- Webhook secret exposure could allow replay attacks

**Current Implementation:**
```typescript
export async function POST(request: NextRequest) {
  const stripe = getStripeInstance()
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  let event: Stripe.Event
  try {
    if (!signature || !webhookSecret) {
      throw new Error("Missing stripe-signature or webhook secret")
    }
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`)
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 })
  }
  // ... rest of handler
}
```

**Recommendation:** Add IP allowlisting and idempotency checks

---

### 🟠 HIGH #3: Tag Assignment Helper Missing Ownership Validation
**File:** `client/lib/supabase/tags.ts`  
**Functions:** `addTagToSubscription`, `removeTagFromSubscription`

**Issue:**
- Helper functions don't verify subscription ownership
- Rely on caller to perform ownership checks
- Easy to misuse in new routes

**Recommendation:** Add ownership verification to helper functions

---

## Medium Priority Issues

### 🟡 MEDIUM #1: Inconsistent Error Messages
**Multiple Routes**

**Issue:**
- Some routes throw generic `Error("User not authenticated")`
- Others use `ApiErrors.unauthorized()`
- Inconsistent error handling patterns

**Recommendation:** Standardize on `ApiErrors` throughout

---

### 🟡 MEDIUM #2: Missing Request ID Propagation
**Multiple Routes**

**Issue:**
- Some routes don't use `context.requestId` in responses
- Makes debugging and tracing difficult

**Recommendation:** Ensure all responses include request ID

---

## Security Best Practices Analysis

### ✅ What's Working Well

1. **Authentication Middleware:** `createApiRoute` with `requireAuth: true` is consistently used
2. **Rate Limiting:** Most sensitive routes have rate limiting configured
3. **Input Validation:** Zod schemas are used for request validation
4. **Error Handling:** Centralized error handling with `withErrorHandling`
5. **Explicit Ownership Checks:** Main subscription routes properly verify ownership

### ⚠️ Areas for Improvement

1. **Ownership Verification:** Not consistently applied across all resource routes
2. **Helper Function Security:** Database helpers don't enforce ownership
3. **Webhook Security:** Limited to signature verification only
4. **Rate Limiting Coverage:** Some bulk operations lack rate limiting
5. **Audit Logging:** No audit trail for sensitive operations

---

## Recommended Security Patterns

### Pattern 1: Explicit Ownership Check in Route Handler
```typescript
export const PATCH = createApiRoute(
  async (request: NextRequest, context, user) => {
    if (!user) throw ApiErrors.unauthorized()
    
    const { id } = await params
    const supabase = await createClient()
    
    // ALWAYS verify ownership first
    const { data: resource, error } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("id", id)
      .single()
    
    if (error || !resource) {
      throw ApiErrors.notFound("Subscription")
    }
    
    checkOwnership(user.id, resource.user_id)
    
    // Then proceed with operation
    // ...
  },
  { requireAuth: true, rateLimit: RateLimiters.standard }
)
```

### Pattern 2: Ownership-Aware Helper Functions
```typescript
export async function addTagToSubscription(
  subscriptionId: string,
  tagId: string,
  userId: string // Add userId parameter
): Promise<void> {
  const supabase = await createClient()
  
  // Verify subscription ownership
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("id", subscriptionId)
    .single()
  
  if (!subscription || subscription.user_id !== userId) {
    throw ApiErrors.forbidden("You do not own this subscription")
  }
  
  // Verify tag ownership
  const { data: tag } = await supabase
    .from("subscription_tags")
    .select("user_id")
    .eq("id", tagId)
    .single()
  
  if (!tag || tag.user_id !== userId) {
    throw ApiErrors.forbidden("You do not own this tag")
  }
  
  // Proceed with assignment
  const { error } = await supabase
    .from("subscription_tag_assignments")
    .upsert({ subscription_id: subscriptionId, tag_id: tagId })
  
  if (error) throw new Error(`Failed to assign tag: ${error.message}`)
}
```

### Pattern 3: Webhook Security Enhancement
```typescript
// Add idempotency tracking
const processedEvents = new Set<string>()

export async function POST(request: NextRequest) {
  // Verify Stripe signature
  const event = await verifyStripeSignature(request)
  
  // Check idempotency
  if (processedEvents.has(event.id)) {
    return NextResponse.json({ received: true, duplicate: true })
  }
  
  // Optional: Verify IP is from Stripe
  const ip = request.headers.get('x-forwarded-for')
  if (!isStripeIP(ip)) {
    return NextResponse.json({ error: "Invalid source" }, { status: 403 })
  }
  
  // Process event
  await handleWebhookEvent(event)
  
  // Mark as processed
  processedEvents.add(event.id)
  
  return NextResponse.json({ received: true })
}
```

---

## Action Items

### Immediate (Critical)
- [ ] Fix tag assignment ownership check
- [ ] Fix tag removal ownership check
- [ ] Add ownership verification to refund endpoint
- [ ] Enhance notes update with explicit ownership check

### Short-term (High Priority)
- [ ] Add rate limiting to CSV import
- [ ] Enhance webhook security with idempotency
- [ ] Update tag helper functions with ownership checks
- [ ] Add audit logging for sensitive operations

### Medium-term (Medium Priority)
- [ ] Standardize error handling across all routes
- [ ] Ensure request ID propagation
- [ ] Add comprehensive security tests
- [ ] Document security patterns for new routes

---

## Testing Requirements

### Unauthorized Access Tests
Each protected route must have tests for:
1. ❌ Unauthenticated access (no token)
2. ❌ Cross-user access (valid token, wrong resource)
3. ❌ Invalid resource ID
4. ✅ Valid authenticated access

### Example Test Structure
```typescript
describe('POST /api/subscriptions/[id]/tags', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await fetch('/api/subscriptions/123/tags', {
      method: 'POST',
      body: JSON.stringify({ tag_id: 'tag-123' })
    })
    expect(response.status).toBe(401)
  })
  
  it('should reject cross-user access', async () => {
    const victimSubId = await createSubscription(victimUser)
    const response = await fetch(`/api/subscriptions/${victimSubId}/tags`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: JSON.stringify({ tag_id: 'attacker-tag' })
    })
    expect(response.status).toBe(403)
  })
  
  it('should allow owner to assign tags', async () => {
    const subId = await createSubscription(ownerUser)
    const tagId = await createTag(ownerUser)
    const response = await fetch(`/api/subscriptions/${subId}/tags`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ tag_id: tagId })
    })
    expect(response.status).toBe(200)
  })
})
```

---

## Maintenance Guidelines

### For New Routes
1. **Always use `createApiRoute`** with `requireAuth: true` for protected endpoints
2. **Explicitly verify ownership** for resource-specific operations
3. **Add rate limiting** appropriate to the operation sensitivity
4. **Use `ApiErrors`** for consistent error responses
5. **Include request ID** in all responses
6. **Write security tests** before merging

### For Existing Routes
1. **Review this matrix** before modifying any route
2. **Don't remove ownership checks** without security review
3. **Test cross-user access** after any auth changes
4. **Update this document** when adding new routes

### Security Review Checklist
- [ ] Authentication required?
- [ ] Ownership verified?
- [ ] Rate limiting appropriate?
- [ ] Input validation complete?
- [ ] Error messages don't leak info?
- [ ] Audit logging added?
- [ ] Tests cover unauthorized access?

---

## References

- **Auth Helper:** `client/lib/api/auth.ts`
- **API Infrastructure:** `client/lib/api/index.ts`
- **Error Handling:** `client/lib/api/errors.ts`
- **Rate Limiting:** `client/lib/api/rate-limit.ts`
- **Middleware:** `client/middleware.ts`

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-27  
**Next Review:** 2026-05-27
