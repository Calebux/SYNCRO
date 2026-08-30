# ADR-001: Frontend/Backend API Split

**Status:** Accepted (Retrospective)  
**Date:** 2026-05-27  
**Deciders:** Engineering team  
**Issue:** #604

---

## Context

The SYNCRO repository contains two API layers:

- **Next.js API routes** (`client/app/api/`) — served by the Next.js runtime, co-located with the frontend
- **Express backend** (`backend/src/routes/`) — a standalone Node.js service with its own process, port, and deployment

Both layers talk to the same Supabase database. Without an explicit ownership rule, features have been added to whichever layer was most convenient, creating ambiguity about where new work should go and making the security boundary unclear.

---

## Decision

### Rule: Next.js owns the user-facing data plane. Express owns the server-side processing plane.

---

## Ownership Split

### Next.js API routes own

| Concern | Rationale |
|---|---|
| Subscription CRUD (`/api/subscriptions`) | User-scoped reads/writes; benefits from Supabase SSR auth cookies and RLS |
| Analytics aggregations (`/api/analytics`) | Simple read aggregations over the authenticated user's own data |
| Payment processing (`/api/payments`) | Needs the user session; Stripe/PayPal calls are synchronous and user-initiated |
| Tag management (`/api/tags`) | User-scoped, low complexity |
| Health/liveness/readiness probes (`/api/health`) | Must be co-located with the deployed frontend |
| CSP violation reports (`/api/csp-report`) | Browser-sent; must be same-origin with the frontend |
| Stripe webhook receiver (`/api/webhooks/stripe`) | Stripe posts to the public frontend URL |
| Calendar feed (`/api/calendar`) | Generates an `.ics` feed scoped to the authenticated user |

**Characteristics of a Next.js route:**
- Operates on behalf of a single authenticated user
- Uses `createClient()` (Supabase SSR) for auth — no separate JWT validation
- Stateless; no background work, no timers, no long-running connections
- Response time < 5 s (Vercel/serverless timeout budget)

---

### Express backend owns

| Concern | Rationale |
|---|---|
| Reminder engine & scheduler | Long-running cron jobs; cannot run in serverless |
| Email delivery (SMTP) | Requires persistent SMTP connection and retry queues |
| Telegram bot & webhook | Requires `Telegraf` long-polling or persistent webhook process |
| Push notifications (VAPID) | Requires persistent subscription store and delivery queue |
| Risk detection & scoring | CPU-intensive; runs across all users on a schedule |
| Blockchain / Soroban sync | Requires persistent event listener and retry logic |
| Exchange rate polling | Background polling; not user-initiated |
| Compliance & GDPR export | Long-running data export jobs |
| Admin monitoring endpoints | Internal tooling; not exposed to the browser |
| Team management | Complex multi-user operations with role enforcement |
| MFA management | Sensitive; isolated from the frontend runtime |
| Digest / monthly summary | Scheduled batch jobs |
| Audit log ingestion | High-write, batched; not latency-sensitive |
| CSP monitoring jobs | Background aggregation and alerting |

**Characteristics of an Express route:**
- Operates across multiple users or on a schedule
- Uses the Supabase service-role key or its own JWT middleware
- May maintain state (queues, connections, timers)
- May run for seconds to minutes

---

## Migration Rules

### Adding a new feature

1. **Ask:** Does this run on behalf of one authenticated user, synchronously, within a request/response cycle?
   - **Yes** → Next.js API route
   - **No** → Express backend

2. **Ask:** Does this require a background job, a persistent connection, or access to other users' data?
   - **Yes** → Express backend
   - **No** → Next.js API route

### Moving an existing route

A Next.js route **must** be migrated to Express if it:
- Introduces a background timer or `setInterval`
- Requires the service-role key
- Needs to fan out across multiple users
- Exceeds the 5 s serverless timeout

An Express route **may** be migrated to Next.js if it:
- Is purely user-scoped CRUD
- Has no background work
- Would benefit from Supabase SSR auth (eliminates a separate JWT hop)

### Duplication is not permitted

The same logical operation must not exist in both layers. If a Next.js route and an Express route both handle subscription reads, one must be removed or the Next.js route must proxy to Express.

---

## Consequences

### Positive
- Clear ownership prevents accidental duplication
- Security boundary is explicit: the service-role key never appears in Next.js routes
- Serverless cold-start budget is respected
- Background jobs remain in a process that can hold state

### Negative
- Two deployments to maintain (Next.js on Vercel, Express on a long-running host)
- Cross-cutting concerns (e.g. rate limiting) must be implemented in both layers independently

### Neutral
- Both layers share the same Supabase project and RLS policies
- The `shared/` package can hold types used by both layers

---

## Compliance Checklist for New PRs

- [ ] New API route placed in the correct layer per the decision table above
- [ ] Next.js routes use `createClient()` (SSR), not the service-role key
- [ ] Express routes use `authenticate` middleware or `adminAuth`, not Supabase SSR cookies
- [ ] No background timers or persistent connections introduced in Next.js routes
- [ ] No duplication of an existing route in the other layer
