# ADR-000: [Short Title of Architecture Decision]

**Status:** Proposed | Accepted | Deprecated | Superseded  
**Date:** YYYY-MM-DD  
**Deciders:** [List of decision makers]  
**Issue:** #[Issue Number]  

---

## Context

Describe the context, problem statement, and background forcing this architecture decision. Reference existing models, contracts, database tables, and system boundaries.

---

## Decision

State the decision clearly and concisely.

---

## Domain Naming & Data Model Compliance

> [!IMPORTANT]
> All architectural proposals must align with the canonical domain vocabulary and data model defined in [docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md](../DOMAIN_GLOSSARY_AND_DATA_MODEL.md).

Check and document the impact on each domain entity:

| Domain Term / Entity | Layer Affected (Contracts, DB, API, Client, SDK) | Proposed Representation | Alignment with `docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md` |
| :--- | :--- | :--- | :--- |
| **Subscription** | | | |
| **Renewal** | | | |
| **Payment** | | | |
| **Charge** | | | |
| **Settlement** | | | |
| **Escrow** | | | |
| **Channel** | | | |
| **Card / Virtual Card** | | | |
| **Gift Card** | | | |

---

## Technical Details & Architecture Impact

### Smart Contracts (Soroban)
- Struct / interface updates

### Database Schema & Migrations
- PostgreSQL tables, RLS policies, indexing updates

### Backend & Client API
- Route placement (per ADR-001) & TypeScript DTOs in `@syncro/shared`

---

## Consequences

### Positive
- [Benefit 1]
- [Benefit 2]

### Negative / Trade-offs
- [Trade-off 1]
- [Trade-off 2]

---

## Compliance Checklist for Implementation PRs

- [ ] Domain terminology adheres to [docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md](../DOMAIN_GLOSSARY_AND_DATA_MODEL.md)
- [ ] DTO types defined/updated in `@syncro/shared`
- [ ] API routes follow layer boundary rules (ADR-001)
- [ ] Database migrations placed in `supabase/migrations/` with RLS policies enabled
