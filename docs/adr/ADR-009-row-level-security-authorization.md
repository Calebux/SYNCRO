# ADR-009: Row-Level Security (RLS) as Primary Database Authorization Boundary

**Status:** Accepted (Retrospective)  
**Date:** 2026-06-12  
**Deciders:** Database & Security Teams  
**Issue/PR:** #35, RLS Policy Registry  

---

## Context

In multi-tenant web applications, authorizing user data access solely in application-level middleware or API controllers (e.g. `if (doc.user_id !== req.user.id) throw Forbidden`) presents recurring security failure points:
- A developer might forget to include `WHERE user_id = ...` in a newly added API endpoint.
- Clients connecting directly to Supabase PostgREST endpoints using the public `anon` key could query unauthorized rows if table permissions are not enforced at the database level.
- Multi-user scenarios (team management, admin impersonation) can introduce authorization bypass bugs.

---

## Decision

We enforced **PostgreSQL Row-Level Security (RLS)** as the authoritative data access boundary across all database tables.

- **Mandatory Policy Rule**: `ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;` is required on **every** public table without exception.
- **User Ownership Scoping**: User tables derive identity directly from Supabase Auth (`auth.uid()`).
- **Access Policies**:
  - `SELECT`, `INSERT`, `UPDATE`, `DELETE` policies explicitly check `auth.uid() = user_id`.
  - Public lookup tables (e.g. curated services, currency rates) use explicit `FOR SELECT USING (true)` policies.
- **Service Role Isolation**: Backend worker services bypass RLS strictly when executing system-wide cron jobs using the dedicated `service_role` key. The `service_role` key is strictly prohibited in frontend/client code.

---

## Consequences

### Positive
- **Defense-in-Depth**: Data isolation is enforced by PostgreSQL kernel rules, making client-side data leaks mathematically impossible even if an API route forgets an authorization filter.
- **Safe Public Client API**: The frontend can query Supabase directly using `@supabase/ssr` without risk of leaking cross-tenant data.
- **Centralized Auditability**: Security auditors examine `supabase/migrations/` policies rather than parsing thousands of lines of TypeScript application code.

### Negative
- **Policy Maintenance**: Complex queries (e.g. multi-tenant team permissions) require carefully optimized SQL policies to avoid performance bottlenecks.
- **Testing Requirements**: Automated RLS test suites must be maintained to verify both positive authorization and negative rejection cases.

---

## Compliance & Verification

- CI script `scripts/check-rls-compliance.js` scans database migrations and fails if any table lacks RLS enablement or active policies.
- Automated RLS audit suite (`npm run audit:rls:local -w backend`) executes exhaustive permission testing.
