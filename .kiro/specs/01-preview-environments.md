# Spec: Ephemeral Preview Environments for PRs

## Problem Statement

Review happens against diffs and screenshots. With a Next.js client, an Express backend, and Soroban contracts on testnet, most regressions are integration-shaped and only visible in a running system. This is why many issues are found in production paths rather than in review.

Without preview environments, reviewers cannot validate:
- End-to-end flows with seeded data
- Client-backend integration
- Blockchain contract interactions
- Email and payment provider integrations

## Scope

Deploy the client and backend to an ephemeral environment per PR, seeded with the seed dataset.
- Point preview environments at testnet contracts from the deployment manifest
- Post the preview URL and its seeded credentials on the PR
- Tear the environment down on merge or close
- Cap the total number of live previews to prevent cost overrun

## Acceptance Criteria

- [ ] Every PR gets a preview URL posted as a comment
- [ ] Preview environments are seeded and usable without manual setup
- [ ] Environments are destroyed on close/merge, and a cap prevents unbounded cost
- [ ] Preview deploys never target mainnet contracts, enforced by configuration

## Key Files/Areas

- `.github/workflows/` - GitHub Actions workflows
- `deploy/` - Deployment scripts and configuration
- `client/vercel.json` - Vercel deployment config
- Backend deployment configuration

## Requirements

### R1: Ephemeral Environment Provisioning
- Create a GitHub Actions workflow that deploys on every PR
- Provision separate instances of:
  - Next.js client (Vercel preview or similar)
  - Express backend (Heroku, Railway, or similar)
  - Seeded Supabase instance or data snapshot
- Generate unique URLs for each PR
- Enforce testnet-only contract addresses

### R2: Seed Dataset Integration
- Maintain a seed dataset with test users, subscriptions, invoices
- Automatically apply seed data on environment creation
- Include test credentials in a secure comment on PR
- Reset seed data independently of main deployment

### R3: Preview URL Management
- Post preview URL and credentials as a PR comment
- Update comment on subsequent commits
- Include links to both client and backend
- Provide instructions for manual testing

### R4: Cleanup and Cost Control
- Destroy environment on PR merge or close
- Track number of active preview environments
- Implement a hard cap (e.g., 5 concurrent previews)
- Alert when cap is reached

### R5: Testnet Enforcement
- Load contract addresses from deployment manifest
- Validate all contracts point to testnet before deployment
- Block deployment if mainnet contracts detected
- Document how to update contract addresses

## Design Decisions

- **Vercel + Railway + Supabase**: Leverages existing services for easier management
- **GitHub Actions**: Triggers on PR open, commit push, and close events
- **Environment secrets**: Stored in GitHub repo settings, injected at deploy time
- **Seed data**: Version-controlled SQL or JSON, applied via migrations

## Implementation Tasks

1. Create GitHub Actions workflow for PR preview deployment
2. Set up infrastructure provisioning scripts
3. Implement seed dataset pipeline
4. Create PR comment automation
5. Implement cleanup and cap enforcement
6. Document preview environment usage
7. Set up monitoring and cost alerts

## Dependencies

- GitHub Actions access
- Vercel/Railway/similar platform accounts
- Supabase access for environment cloning
- Terraform or equivalent IaC tool (optional but recommended)

## Open Questions

- Which cloud platforms to use for backend (Railway, Heroku, Fly.io)?
- How to manage database state across multiple preview environments?
- Should previews share a Supabase project or each get their own?
- What's the acceptable cost per preview environment?
- How long should preview environments stay live?

