# Spec: System Architecture Diagrams and Documentation

## Problem Statement

`backend/ARCHITECTURE.md` and `IMPLEMENTATION_SUMMARY.md` describe parts of the system in prose. Nothing shows how the Next.js client, the Express backend, Supabase, Redis, the job runners, the eight Soroban contracts, the payment providers, and the email providers actually fit together. This makes both onboarding and threat modeling harder than necessary.

Current gaps:
- No system-level context diagram
- No clear container boundaries
- No component interaction model
- No sequence diagrams for critical flows
- Integration points are implicit, not documented

## Scope

Produce C4 levels 1-3: system context, containers, and components for the backend and the contract set.
- Add a sequence diagram for each critical flow:
  - Subscription creation from email
  - Reminder delivery
  - Renewal execution
  - Webhook ingestion
  - Gift-card redemption
- Keep diagrams as text (Mermaid) in the repo so they diff in review
- Render them into the docs site and check they build in CI

## Acceptance Criteria

- [ ] System context, container and component diagrams exist and are current
- [ ] Five critical-flow sequence diagrams exist covering all flows listed above
- [ ] Diagrams are Mermaid source in the repo, not committed images
- [ ] Diagram rendering is verified in CI and diagrams appear in the docs site

## Key Files/Areas

- `backend/docs/ARCHITECTURE_DIAGRAMS.md` (new)
- `backend/ARCHITECTURE.md` (update)
- `.github/workflows/validate-docs.yml` (update)
- Docs site configuration

## Requirements

### R1: C4 Level 1 - System Context
- Show the system as a single box
- Identify external actors: users, payment providers, email providers, blockchain networks
- Show data flows between system and external entities
- Focus on business-level interactions

### R2: C4 Level 2 - Container Diagrams
- Decompose system into containers: Next.js client, Express backend, Supabase, Redis, job runners
- Show container interactions and communication protocols
- Identify data stores and external services
- Include Soroban contract cluster as a single container

### R3: C4 Level 3 - Component Diagrams
- Decompose backend into major components: API routes, services, middleware, job queues
- Decompose contract set: 8 contracts and their dependencies
- Show internal interactions and responsibilities
- Identify data flow between components

### R4: Sequence Diagrams
Create sequence diagrams for each critical flow:

1. **Subscription Creation from Email**
   - Email provider receives subscription request
   - Backend validates and creates subscription
   - Contract updates on-chain state
   - User receives confirmation

2. **Reminder Delivery**
   - Job runner triggers reminder check
   - Query subscriptions due for renewal
   - Send reminder emails
   - Update reminder status
   - Handle bounces/failures

3. **Renewal Execution**
   - Job runner triggers renewal process
   - Query subscriptions due for renewal
   - Charge payment provider
   - Update blockchain state
   - Send renewal confirmation
   - Handle failures and retries

4. **Webhook Ingestion**
   - External service sends webhook
   - Backend validates webhook signature
   - Process webhook payload
   - Update database and blockchain
   - Return success/failure

5. **Gift-Card Redemption**
   - User inputs gift card code
   - Backend validates and verifies code
   - Mint contract credits
   - Apply credits to user account
   - Return redemption result

### R5: Diagram Maintenance
- Store all diagrams in Mermaid syntax
- Version diagrams alongside code changes
- Update diagrams when architecture changes
- Include diagrams in pull request diffs

### R6: Documentation Integration
- Generate PNG/SVG from Mermaid for docs site
- Verify diagram builds in CI pipeline
- Link diagrams in main ARCHITECTURE.md
- Include brief narrative explanation for each diagram

## Design Decisions

- **Mermaid**: Open-source, text-based, diffs well in Git
- **C4 Model**: Industry standard for architecture communication
- **Co-located with code**: Diagrams live in repo, not external tools
- **Automated rendering**: CI builds and publishes diagrams

## Implementation Tasks

1. Create `ARCHITECTURE_DIAGRAMS.md` with C4 L1-L3
2. Create 5 sequence diagrams for critical flows
3. Set up Mermaid rendering in CI
4. Update docs site build to include diagrams
5. Create diagram maintenance guidelines
6. Add diagram validation to CI
7. Document how to update diagrams

## Diagram Structure

```
backend/docs/
├── ARCHITECTURE_DIAGRAMS.md
│   ├── C4 Level 1: System Context
│   ├── C4 Level 2: Containers
│   ├── C4 Level 3: Components
│   │   ├── Backend Components
│   │   └── Contract Components
│   └── Sequence Diagrams
│       ├── Subscription Creation from Email
│       ├── Reminder Delivery
│       ├── Renewal Execution
│       ├── Webhook Ingestion
│       └── Gift-Card Redemption
```

## Dependencies

- Mermaid CLI or similar for rendering
- Documentation site build process
- GitHub Actions for CI validation

## Open Questions

- Should contract components be shown in detail or as a black box?
- Which tools to use for rendering Mermaid diagrams (Mermaid CLI, Docker, etc.)?
- How often should diagrams be reviewed and updated?
- Should we include deployment/infrastructure diagrams?
- Should sequence diagrams show error paths or focus on happy paths?

## Success Metrics

- All new contributors reference diagrams during onboarding
- Threat modeling becomes easier with clear component boundaries
- Architecture decisions are visible in diagrams before code review
- Diagram diffs catch architecture changes before they're merged

