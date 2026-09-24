# ADR-000: [Short Title of Decision]

**Status:** [Proposed | Accepted | Accepted (Retrospective) | Superseded by [ADR-XXX](./ADR-XXX-title.md) | Rejected]  
**Date:** YYYY-MM-DD  
**Deciders:** [Engineering team, Maintainers, Architecture Working Group, etc.]  
**Issue/PR:** [#XXX](https://github.com/ShantelPeters/SYNCRO/issues/XXX)

---

## Context

Describe the context and problem statement. What architectural drivers or operational requirements led to this decision? What constraints, trade-offs, or alternative options were considered?

---

## Decision

State the decision clearly and concisely in active voice.

- **Choice:** [What option was chosen]
- **Key Rationale:** [Primary reasons for choosing this option over alternatives]
- **Scope:** [Which system components, repositories, or layers are affected]

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

## Consequences

### Positive
- Benefit 1
- Benefit 2

### Negative
- Drawback 1
- Drawback 2

### Neutral
- Structural observation or side effect

---

## Compliance & Verification

- How to verify adherence to this decision (e.g. automated CI check, code review rule, contract test).
- Triggers for revisiting this decision in the future.

---

## Compliance Checklist for Implementation PRs

- [ ] Domain terminology adheres to [docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md](../DOMAIN_GLOSSARY_AND_DATA_MODEL.md)
- [ ] DTO types defined/updated in `@syncro/shared`
- [ ] API routes follow layer boundary rules (ADR-001)
- [ ] Database migrations placed in `supabase/migrations/` with RLS policies enabled