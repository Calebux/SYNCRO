# Next.js API Routes Security Audit Matrix

## Overview
This document tracks authentication (authn), authorization (authz), and ownership enforcement across all sensitive Next.js API routes.

## Matrix Format
- **Route**: API endpoint path
- **Method**: HTTP verb (GET, POST, PUT, DELETE, PATCH)
- **Auth**: Authentication required (✓ = required, ○ = public)
- **Authz**: Authorization checks implemented
- **Ownership**: Data ownership validation
- **Tests**: Unit/integration tests for unauthorized access
- **Status**: Implementation status

## Sensitive Routes Audit

### Subscriptions Routes
| Route | Method | Auth | Authz | Ownership | Tests | Status |
|-------|--------|------|-------|-----------|-------|--------|
| `/api/subscriptions` | GET | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions` | POST | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/[id]` | GET | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/[id]` | PUT | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/[id]` | DELETE | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/[id]/pause` | POST | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/[id]/resume` | POST | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/[id]/tags` | GET | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/[id]/tags` | POST | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/[id]/tags/[tagId]` | DELETE | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/[id]/notes` | PATCH | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/subscriptions/import` | POST | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |

### Tags Routes
| Route | Method | Auth | Authz | Ownership | Tests | Status |
|-------|--------|------|-------|-----------|-------|--------|
| `/api/tags` | GET | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/tags` | POST | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/tags/[id]` | PUT | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/tags/[id]` | DELETE | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |

### Payments Routes
| Route | Method | Auth | Authz | Ownership | Tests | Status |
|-------|--------|------|-------|-----------|-------|--------|
| `/api/payments` | POST | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/payments/paypal/capture` | POST | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |
| `/api/payments/refund` | POST | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |

### Webhooks Routes
| Route | Method | Auth | Authz | Ownership | Tests | Status |
|-------|--------|------|-------|-----------|-------|--------|
| `/api/webhooks/stripe` | POST | ○ | Signature verification | N/A | ✓ | ✓ Implemented |

### Team Routes
| Route | Method | Auth | Authz | Ownership | Tests | Status |
|-------|--------|------|-------|-----------|-------|--------|
| `/api/team/members` | GET | ✓ | Team membership | ✓ | ✓ | ✓ Implemented |
| `/api/team/members` | POST | ✓ | Team ownership | ✓ | ✓ | ✓ Implemented |

### Admin Routes
| Route | Method | Auth | Authz | Ownership | Tests | Status |
|-------|--------|------|-------|-----------|-------|--------|
| `/api/admin/users` | GET | ✓ | Admin role | N/A | ✓ | ✓ Implemented |
| `/api/admin/settings` | GET | ✓ | Admin role | N/A | ✓ | ✓ Implemented |
| `/api/admin/settings` | PATCH | ✓ | Admin role | N/A | ✓ | ✓ Implemented |

### Analytics Routes
| Route | Method | Auth | Authz | Ownership | Tests | Status |
|-------|--------|------|-------|-----------|-------|--------|
| `/api/analytics` | GET | ✓ | User ID match | ✓ | ✓ | ✓ Implemented |

### Health Routes
| Route | Method | Auth | Authz | Ownership | Tests | Status |
|-------|--------|------|-------|-----------|-------|--------|
| `/api/health` | GET | ○ | N/A | N/A | N/A | ○ Public |
| `/api/health/live` | GET | ○ | N/A | N/A | N/A | ○ Public |
| `/api/health/ready` | GET | ○ | N/A | N/A | N/A | ○ Public |

### CSP Report Routes
| Route | Method | Auth | Authz | Ownership | Tests | Status |
|-------|--------|------|-------|-----------|-------|--------|
| `/api/csp-report` | POST | ○ | Rate limited | N/A | ✓ | ✓ Implemented |

## Implementation Standards

### Authentication Requirements
- All sensitive endpoints must use `createApiRoute()` which enforces authentication
- Public endpoints must explicitly set `requireAuth: false`
- Session validation must occur before any database access

### Authorization Requirements
- User ID validation: Extract user from session and compare with `user_id` field
- Admin routes: Check user role from session/database
- Team routes: Verify team membership before access

### Ownership Validation Pattern
```typescript
// Standard ownership check for subscription-like resources
const subscription = await supabase
  .from('subscriptions')
  .select('*')
  .eq('id', id)
  .eq('user_id', user.id)  // Ownership check
  .single()

if (!subscription.data) {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
```

### Testing Requirements
Each sensitive endpoint must have tests for:
1. Successful request with valid authentication
2. Failed request without authentication  
3. Failed request with different user's data
4. Cross-user access attempts must be rejected

## Key Findings

### ✓ Strengths
- `createApiRoute()` helper enforces authentication consistently
- User ID checks implemented in all subscription routes
- Webhook validation uses signature verification instead of auth

### Security Notes
- All ownership checks use database equality (`eq('user_id', user.id)`)
- No hardcoded user IDs in routes
- Admin routes properly scoped with role checks

## Rotation History
- **2026-04-28**: Initial audit matrix created - all routes compliant
- Leaked JWT token (issue #501) has been rotated and moved to env vars
