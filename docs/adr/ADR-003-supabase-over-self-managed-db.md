# ADR-003: Supabase (Managed Postgres, Auth, RLS) over Self-Managed DB

**Status:** Accepted (Retrospective)  
**Date:** 2026-05-29  
**Deciders:** Engineering Team  
**Issue/PR:** #35, #598  

---

## Context

SYNCRO requires a robust storage and authentication foundation to support:
1. Multi-tenant user data (subscriptions, preferences, virtual cards, audit trails).
2. User authentication (passwordless magic links, OAuth, JWT management).
3. Fine-grained database authorization policies to isolate user data.
4. Seamless local development setup with deterministic migrations.

Managing a custom PostgreSQL cluster, building an independent auth service, and implementing API-level authorization from scratch introduces substantial operational overhead, security risks, and deployment complexity.

---

## Decision

We adopted **Supabase** as SYNCRO's managed database and authentication platform.

- **PostgreSQL Database:** Supabase-hosted Postgres instance with native Row Level Security (RLS).
- **Authentication:** Supabase Auth (`@supabase/ssr` on client, Service Role SDK on backend).
- **Migrations & Local Development:** Canonical schema migrations managed via the Supabase CLI (`supabase/migrations/`).
- **Data Access Layer:** Browser client connects via anon key + RLS policies; Express backend accesses administrative routes via service-role key.

---

## Consequences

### Positive
- **Zero Auth Infrastructure Overhead**: Built-in JWT generation, cookie handling, session management, and password reset flows out of the box.
- **Database-Level Isolation**: Security policies reside directly in PostgreSQL via RLS, reducing risks of client data leaks.
- **Local Development Parity**: Supabase CLI allows developers to run an exact replica of production Postgres and Auth in Docker via `supabase start`.
- **Automated Schema Migrations**: Single source of truth in `supabase/migrations/` validated in CI.

### Negative
- **Vendor & Extension Coupling**: Deep integration with Supabase-specific functions (`auth.uid()`, Supabase Auth schema).
- **Service Role Risk**: Exposing the service-role key on the client side would bypass RLS entirely; strict linting and environment variable rules must prevent leaks.

### Neutral
- SQL migrations must adhere strictly to Postgres standards (`TIMESTAMPTZ`, proper foreign keys, RLS enabled on all tables).

---

## Compliance & Verification

- CI workflow (`.github/workflows/database.yml`) validates all SQL migrations against a fresh Supabase container.
- Automated script `scripts/audit-rls-policies.js` verifies that every user table has RLS enabled and active policies.
