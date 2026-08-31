# Directory Ownership Matrix

**Version**: 1.0  
**Last Updated**: May 27, 2026  
**Maintained By**: @Calebux  
**Review Frequency**: Quarterly

## Overview

This document defines clear ownership for every major directory in the SYNCRO repository. Ownership determines who is responsible for code quality, architecture decisions, security, and maintenance within each area.

**Purpose**:
- Establish clear accountability for each codebase area
- Streamline code review and approval processes
- Provide triage guidance for issues and pull requests
- Enable efficient escalation and handoff procedures

**Related Documents**:
- [CODEOWNERS](./.github/CODEOWNERS) - GitHub enforcement of ownership
- [Code Review Process](./docs/code-review-process.md) - Review and escalation procedures
- [Contributing Guide](./CONTRIBUTING.md) - Contribution guidelines

---

## Quick Reference

| Directory | Owner | Team | Primary Responsibility |
|-----------|-------|------|------------------------|
| `/client/` | @Calebux | Frontend Team | UI/UX, components, client-side logic |
| `/backend/` | @Calebux | Backend Team | APIs, services, business logic |
| `/contracts/` | @Calebux | Smart Contract Team | Blockchain logic, Soroban contracts |
| `/supabase/` | @Calebux | Infrastructure Team | Database schema, migrations, RLS |
| `/sdk/` | @Calebux | SDK Team | Public SDK, integrations |
| `/shared/` | @Calebux | Platform Team | Shared types, domain models |
| `/docs/` | @Calebux | Documentation Team | Technical documentation |
| `/scripts/` | @Calebux | DevOps Team | Automation, utilities |
| `/.github/` | @Calebux | DevOps Team | CI/CD, workflows, automation |

---

## Detailed Ownership Matrix

### 1. Frontend (`/client/`)

**Owner**: @Calebux  
**Team**: Frontend Team  
**Stack**: Next.js 15, React 19, TypeScript, Tailwind CSS v4

#### Subdirectories

| Path | Responsibility | Key Technologies |
|------|----------------|------------------|
| `/client/app/` | Next.js App Router pages and layouts | Next.js, React Server Components |
| `/client/app/api/` | API route handlers (Next.js API routes) | Next.js API Routes, Supabase |
| `/client/app/dashboard/` | Main dashboard UI | React, Tailwind, shadcn/ui |
| `/client/app/settings/` | User settings pages | React, Forms, Validation |
| `/client/app/auth/` | Authentication flows | Supabase Auth, MFA |
| `/client/components/` | Reusable React components | React, TypeScript, Storybook |
| `/client/components/ui/` | Base UI components (shadcn/ui) | Radix UI, Tailwind |
| `/client/hooks/` | Custom React hooks | React Hooks, State Management |
| `/client/lib/` | Client-side utilities and helpers | TypeScript, Utilities |
| `/client/lib/api/` | API client and data fetching | Fetch, SWR, React Query |
| `/client/types/` | TypeScript type definitions | TypeScript |
| `/client/styles/` | Global styles and themes | Tailwind CSS, CSS |
| `/client/__tests__/` | Unit and integration tests | Vitest, Testing Library |
| `/client/e2e/` | End-to-end tests | Playwright |
| `/client/.storybook/` | Component documentation | Storybook |
| `/client/public/` | Static assets | Images, Icons, Fonts |

#### Responsibilities

- **UI/UX Implementation**: Implement designs, ensure accessibility (WCAG compliance)
- **Component Development**: Build reusable, tested components
- **State Management**: Manage client-side state and data fetching
- **Performance**: Optimize bundle size, lazy loading, code splitting
- **Testing**: Unit tests (Vitest), E2E tests (Playwright), visual tests (Storybook)
- **Security**: XSS prevention, CSP compliance, secure authentication flows
- **Documentation**: Component documentation, usage examples

#### Key Files

- `client/package.json` - Dependencies and scripts
- `client/next.config.mjs` - Next.js configuration
- `client/tailwind.config.ts` - Tailwind CSS configuration
- `client/tsconfig.json` - TypeScript configuration
- `client/vitest.config.ts` - Test configuration
- `client/middleware.ts` - Next.js middleware (auth, redirects)

#### Triage Guidance

**Route issues here if**:
- UI bugs or visual regressions
- Component behavior issues
- Client-side performance problems
- Accessibility concerns
- E2E test failures
- Build or deployment issues (client-specific)

---

### 2. Backend (`/backend/`)

**Owner**: @Calebux  
**Team**: Backend Team  
**Stack**: Node.js 20, Express.js 5, TypeScript, PostgreSQL

#### Subdirectories

| Path | Responsibility | Key Technologies |
|------|----------------|------------------|
| `/backend/src/routes/` | API endpoint definitions | Express.js, REST |
| `/backend/src/services/` | Business logic and core services | TypeScript, Domain Logic |
| `/backend/src/middleware/` | Request/response middleware | Express.js, Auth, Validation |
| `/backend/src/config/` | Configuration and environment | Zod, Environment Variables |
| `/backend/src/schemas/` | Validation schemas | Zod, JSON Schema |
| `/backend/src/types/` | TypeScript type definitions | TypeScript |
| `/backend/src/utils/` | Utility functions and helpers | TypeScript |
| `/backend/src/lib/` | Third-party integrations | Supabase, Stripe, APIs |
| `/backend/src/blockchain/` | Blockchain integration logic | Stellar, Soroban |
| `/backend/src/jobs/` | Background jobs and cron tasks | Node-cron, Bull |
| `/backend/src/errors/` | Error handling and custom errors | TypeScript, Error Classes |
| `/backend/tests/` | Unit and integration tests | Jest, Supertest |
| `/backend/scripts/` | Backend-specific scripts | Node.js, Automation |
| `/backend/migrations/` | Database migrations (legacy) | SQL |
| `/backend/docs/` | Backend-specific documentation | Markdown |

#### Responsibilities

- **API Development**: Design and implement RESTful APIs
- **Business Logic**: Implement core subscription management, risk detection, analytics
- **Data Access**: Database queries, ORM usage, data validation
- **Authentication**: JWT, session management, MFA
- **Authorization**: Role-based access control, permissions
- **Integrations**: Third-party APIs (Stripe, Gmail, Outlook, Telegram)
- **Background Jobs**: Scheduled tasks, reminder engine, notifications
- **Security**: Input validation, SQL injection prevention, rate limiting
- **Performance**: Query optimization, caching, load balancing
- **Testing**: Unit tests, integration tests, API tests
- **Documentation**: API documentation, service documentation

#### Key Files

- `backend/package.json` - Dependencies and scripts
- `backend/tsconfig.json` - TypeScript configuration
- `backend/jest.config.js` - Test configuration
- `backend/src/index.ts` - Server entry point
- `backend/src/config/env.ts` - Environment validation
- `backend/.env.example` - Environment variable template

#### Triage Guidance

**Route issues here if**:
- API endpoint bugs or errors
- Business logic issues
- Database query problems
- Authentication/authorization failures
- Integration failures (Stripe, email, etc.)
- Performance issues (slow queries, high CPU)
- Background job failures
- Security vulnerabilities

---

### 3. Smart Contracts (`/contracts/`)

**Owner**: @Calebux  
**Team**: Smart Contract Team  
**Stack**: Rust, Stellar Soroban SDK 23

#### Subdirectories

| Path | Responsibility | Key Technologies |
|------|----------------|------------------|
| `/contracts/contracts/` | Soroban smart contract source code | Rust, Soroban SDK |
| `/contracts/contracts/test_snapshots/` | Contract test snapshots | Soroban Testing |
| `/contracts/scripts/` | Deployment and interaction scripts | Bash, Stellar CLI |

#### Responsibilities

- **Contract Development**: Write, test, and deploy Soroban smart contracts
- **Security Audits**: Ensure contract security, prevent vulnerabilities
- **Gas Optimization**: Optimize contract execution costs
- **Testing**: Comprehensive unit tests, integration tests
- **Deployment**: Testnet and mainnet deployments
- **Documentation**: Contract interfaces, usage examples
- **Upgrades**: Contract upgrade strategies and migrations

#### Key Contracts

- `subscription_renewal` - Recurring payment logic
- `virtual-card` - Non-custodial card interface
- `escrow` - Secure fund holding
- `agent-registry` - Authorized agent management
- `subscription_logging` - On-chain audit trail

#### Key Files

- `contracts/Cargo.toml` - Rust workspace configuration
- `contracts/Cargo.lock` - Dependency lock file
- `contracts/README.md` - Contract documentation
- `contracts/DEPLOYMENT.md` - Deployment guide
- `contracts/DELEGATED_EXECUTION.md` - Delegation patterns

#### Triage Guidance

**Route issues here if**:
- Contract execution failures
- Gas cost issues
- Security vulnerabilities
- Contract upgrade problems
- Testnet/mainnet deployment issues
- Contract interaction bugs

---

### 4. Database & Infrastructure (`/supabase/`)

**Owner**: @Calebux  
**Team**: Infrastructure Team  
**Stack**: PostgreSQL, Supabase, SQL

#### Subdirectories

| Path | Responsibility | Key Technologies |
|------|----------------|------------------|
| `/supabase/migrations/` | Database schema migrations | SQL, PostgreSQL |
| `/supabase/` | Supabase configuration | Supabase CLI, TOML |

#### Responsibilities

- **Schema Design**: Database table design, relationships, constraints
- **Migrations**: Create and manage database migrations
- **RLS Policies**: Row-level security implementation
- **Indexes**: Performance optimization via indexes
- **Seed Data**: Test data for local development
- **Backup & Recovery**: Database backup strategies
- **Security**: RLS compliance, data encryption, access control
- **Performance**: Query optimization, index tuning
- **Documentation**: Schema documentation, migration guides

#### Key Files

- `supabase/config.toml` - Supabase configuration
- `supabase/seed.sql` - Local development seed data
- `supabase/migrations/*.sql` - Migration files

#### Triage Guidance

**Route issues here if**:
- Migration failures
- RLS policy violations
- Database performance issues
- Schema design questions
- Data integrity problems
- Backup/recovery issues

---

### 5. SDK (`/sdk/`)

**Owner**: @Calebux  
**Team**: SDK Team  
**Stack**: TypeScript, Node.js

#### Subdirectories

| Path | Responsibility | Key Technologies |
|------|----------------|------------------|
| `/sdk/src/` | SDK source code | TypeScript, Node.js |

#### Responsibilities

- **Public API**: Design and implement public SDK interfaces
- **Stellar Integration**: Stellar/Soroban utilities and helpers
- **Reminder SDK**: Subscription reminder functionality
- **Logger**: Structured logging utilities
- **Documentation**: SDK usage examples, API reference
- **Testing**: Unit tests, integration tests
- **Versioning**: Semantic versioning, changelog maintenance
- **Publishing**: npm package publishing

#### Key Files

- `sdk/package.json` - Package configuration
- `sdk/tsconfig.json` - TypeScript configuration
- `sdk/README.md` - SDK documentation
- `sdk/LOGGER_IMPLEMENTATION.md` - Logger documentation

#### Triage Guidance

**Route issues here if**:
- SDK API issues
- Integration problems
- Documentation gaps
- Breaking changes
- npm package issues

---

### 6. Shared Types (`/shared/`)

**Owner**: @Calebux  
**Team**: Platform Team  
**Stack**: TypeScript

#### Subdirectories

| Path | Responsibility | Key Technologies |
|------|----------------|------------------|
| `/shared/src/` | Shared domain models and types | TypeScript |

#### Responsibilities

- **Domain Models**: Shared types for subscriptions, payments, users, analytics
- **Type Safety**: Ensure type consistency across client, backend, SDK
- **Versioning**: Semantic versioning for breaking changes
- **Documentation**: Type documentation, usage examples
- **Testing**: Type tests, validation tests

#### Key Files

- `shared/package.json` - Package configuration
- `shared/tsconfig.json` - TypeScript configuration
- `shared/README.md` - Shared types documentation

#### Triage Guidance

**Route issues here if**:
- Type inconsistencies across packages
- Breaking type changes
- Missing type definitions
- Type compilation errors

---

### 7. Documentation (`/docs/`)

**Owner**: @Calebux  
**Team**: Documentation Team  
**Stack**: Markdown, MDX, Mintlify

#### Subdirectories

| Path | Responsibility | Key Technologies |
|------|----------------|------------------|
| `/docs/api-reference/` | API endpoint documentation | MDX, OpenAPI |
| `/docs/superpowers/` | Feature documentation | Markdown |
| `/docs/` | General documentation | Markdown, MDX |

#### Responsibilities

- **Technical Documentation**: Architecture, design decisions, guides
- **API Documentation**: Endpoint documentation, examples
- **User Guides**: How-to guides, tutorials
- **Security Documentation**: Security policies, audit guides
- **Process Documentation**: Development workflows, review processes
- **Maintenance**: Keep documentation up-to-date with code changes

#### Key Files

- `docs/mint.json` - Mintlify configuration
- `docs/introduction.mdx` - Getting started guide
- `docs/quickstart.mdx` - Quick start guide
- `docs/authentication.mdx` - Authentication guide
- `docs/contracts.mdx` - Smart contract documentation
- `docs/sdk-reference.mdx` - SDK reference

#### Key Documentation

- `docs/RLS_AUDIT_GUIDE.md` - RLS audit procedures
- `docs/SECRET_ROTATION_POLICY.md` - Secret management
- `docs/code-review-process.md` - Code review guidelines
- `docs/branch-protection.md` - Branch protection rules
- `docs/CSP_*.md` - Content Security Policy documentation
- `docs/DEPENDENCY_*.md` - Dependency management

#### Triage Guidance

**Route issues here if**:
- Documentation inaccuracies
- Missing documentation
- Broken links or examples
- Documentation build failures

---

### 8. Automation & Scripts (`/scripts/`)

**Owner**: @Calebux  
**Team**: DevOps Team  
**Stack**: Node.js, Bash, SQL

#### Subdirectories

| Path | Responsibility | Key Technologies |
|------|----------------|------------------|
| `/scripts/` | Repository-wide automation scripts | Node.js, Bash |

#### Responsibilities

- **RLS Auditing**: Automated RLS policy compliance checks
- **Migration Validation**: Database migration drift detection
- **Security Audits**: Automated security checks
- **Utilities**: Helper scripts for development and operations
- **Documentation**: Script usage documentation

#### Key Scripts

- `scripts/check-rls-compliance.js` - RLS policy audit
- `scripts/audit-rls-policies.js` - Detailed RLS audit
- `scripts/check-migration-drift.js` - Migration drift detection
- `scripts/test-rls-audit.js` - RLS audit testing
- `scripts/verify-implementation.js` - Implementation verification

#### Triage Guidance

**Route issues here if**:
- Script execution failures
- Automation issues
- CI/CD script problems
- Utility script bugs

---

### 9. CI/CD & GitHub (`/.github/`)

**Owner**: @Calebux  
**Team**: DevOps Team  
**Stack**: GitHub Actions, YAML

#### Subdirectories

| Path | Responsibility | Key Technologies |
|------|----------------|------------------|
| `/.github/workflows/` | GitHub Actions workflows | YAML, GitHub Actions |
| `/.github/ISSUE_TEMPLATE/` | Issue templates | Markdown, YAML |
| `/.github/` | GitHub configuration | YAML, Markdown |

#### Responsibilities

- **CI/CD Pipelines**: Build, test, deploy automation
- **Branch Protection**: Enforce code review and quality gates
- **Issue Templates**: Standardize issue reporting
- **PR Templates**: Standardize pull request format
- **Dependabot**: Automated dependency updates
- **Security**: Secret scanning, vulnerability alerts
- **Monitoring**: Workflow health, failure alerts

#### Key Workflows

- `.github/workflows/ci.yml` - Continuous integration
- `.github/workflows/test.yml` - Test suite execution
- `.github/workflows/lint.yml` - Linting checks
- `.github/workflows/typecheck.yml` - TypeScript type checking
- `.github/workflows/database.yml` - Database migration checks
- `.github/workflows/rls-audit.yml` - RLS policy audit
- `.github/workflows/e2e.yml` - End-to-end tests
- `.github/workflows/security-audit.yml` - Security scanning
- `.github/workflows/staging-deploy.yml` - Staging deployment
- `.github/workflows/bundle-size.yml` - Bundle size tracking

#### Key Files

- `.github/CODEOWNERS` - Code ownership enforcement
- `.github/dependabot.yml` - Dependency update configuration
- `.github/pull_request_template.md` - PR template

#### Triage Guidance

**Route issues here if**:
- CI/CD pipeline failures
- Workflow configuration issues
- Branch protection problems
- Dependabot issues
- GitHub Actions bugs

---

### 10. Root Configuration Files

**Owner**: @Calebux  
**Team**: Platform Team

#### Key Files

| File | Responsibility | Owner |
|------|----------------|-------|
| `package.json` | Root workspace configuration | Platform Team |
| `pnpm-workspace.yaml` | Workspace definition | Platform Team |
| `tsconfig.json` | Root TypeScript configuration | Platform Team |
| `eslint.config.mjs` | Root ESLint configuration | Platform Team |
| `.gitignore` | Git ignore rules | Platform Team |
| `.npmrc` | npm configuration | Platform Team |
| `README.md` | Project overview | Documentation Team |
| `CONTRIBUTING.md` | Contribution guidelines | Documentation Team |
| `CurrentState.md` | Project status | Engineering Team |
| `TODO.md` | Project roadmap | Product Team |

#### Triage Guidance

**Route issues here if**:
- Workspace configuration issues
- Build system problems
- Linting configuration issues
- Git configuration problems

---

### 11. Generated & Temporary Directories

**Owner**: N/A (Auto-generated)  
**Team**: N/A

#### Directories

| Path | Purpose | Ownership |
|------|---------|-----------|
| `/node_modules/` | npm dependencies | Auto-generated |
| `/dist/` | Build output | Auto-generated |
| `/build/` | Build output | Auto-generated |
| `/.next/` | Next.js build cache | Auto-generated |
| `/coverage/` | Test coverage reports | Auto-generated |
| `/.kiro/` | Kiro AI configuration | Tool-specific |

**Note**: These directories should not be modified manually and are excluded from version control.

---

## Ownership Responsibilities

### Primary Owner Responsibilities

1. **Code Quality**: Ensure code meets quality standards
2. **Architecture**: Make architectural decisions for the area
3. **Security**: Identify and address security vulnerabilities
4. **Performance**: Monitor and optimize performance
5. **Testing**: Ensure adequate test coverage
6. **Documentation**: Maintain up-to-date documentation
7. **Code Review**: Review and approve pull requests
8. **Mentorship**: Guide contributors in the area
9. **Triage**: Triage issues and assign priorities
10. **Maintenance**: Regular maintenance and refactoring

### Team Responsibilities

1. **Collaboration**: Work with other teams on cross-cutting concerns
2. **Communication**: Keep stakeholders informed of changes
3. **Standards**: Establish and enforce coding standards
4. **Tooling**: Select and maintain development tools
5. **Onboarding**: Help new team members get up to speed
6. **Knowledge Sharing**: Document decisions and share knowledge

---

## Triage Guidelines

### Issue Triage Process

1. **Identify Area**: Determine which directory/area the issue affects
2. **Assign Owner**: Tag the appropriate owner from this matrix
3. **Set Priority**: Use P0 (critical), P1 (high), P2 (medium), P3 (low)
4. **Add Labels**: Add relevant labels (bug, feature, security, etc.)
5. **Provide Context**: Include reproduction steps, logs, screenshots

### Cross-Cutting Issues

For issues that span multiple areas:

1. **Tag All Owners**: Mention all affected area owners
2. **Designate Lead**: One owner takes lead responsibility
3. **Coordinate**: Owners coordinate on solution approach
4. **Document**: Document cross-area dependencies

### Escalation Path

1. **Level 1**: Area owner (24-48 hours)
2. **Level 2**: Team lead (48-72 hours)
3. **Level 3**: @Calebux (maintainer)

---

## Ownership Changes

### Proposing Ownership Changes

To propose changes to this ownership matrix:

1. **Open an Issue**: Create issue with `ownership` label
2. **Provide Rationale**: Explain why change is needed
3. **Impact Analysis**: Describe impact on teams and processes
4. **Get Approval**: Requires approval from:
   - Current owner
   - Proposed new owner
   - @Calebux (maintainer)

### Updating Ownership

When ownership changes:

1. **Update This Document**: Modify ownership matrix
2. **Update CODEOWNERS**: Update `.github/CODEOWNERS`
3. **Update Code Review Process**: Update `docs/code-review-process.md`
4. **Notify Teams**: Announce change to all teams
5. **Handoff**: Conduct knowledge transfer session

---

## Quick Reference by Team

### Frontend Team
- `/client/` - All frontend code
- `/client/components/` - React components
- `/client/app/` - Next.js pages
- `/client/__tests__/` - Frontend tests
- `/client/e2e/` - E2E tests

### Backend Team
- `/backend/` - All backend code
- `/backend/src/routes/` - API endpoints
- `/backend/src/services/` - Business logic
- `/backend/tests/` - Backend tests

### Smart Contract Team
- `/contracts/` - All smart contracts
- `/contracts/contracts/` - Contract source code
- `/contracts/scripts/` - Deployment scripts

### Infrastructure Team
- `/supabase/` - Database schema
- `/supabase/migrations/` - Migrations
- `/.github/workflows/database.yml` - Database CI

### SDK Team
- `/sdk/` - Public SDK
- `/sdk/src/` - SDK source code

### Platform Team
- `/shared/` - Shared types
- Root configuration files
- Workspace configuration

### DevOps Team
- `/.github/` - CI/CD configuration
- `/.github/workflows/` - GitHub Actions
- `/scripts/` - Automation scripts

### Documentation Team
- `/docs/` - All documentation
- `README.md` - Project overview
- `CONTRIBUTING.md` - Contribution guide

---

## Maintenance

### Review Schedule

- **Quarterly**: Full ownership matrix review
- **After Major Refactors**: Update affected areas
- **Team Changes**: Update when team members change
- **New Directories**: Add ownership for new major directories

### Review Checklist

- [ ] All major directories have owners
- [ ] Owners are current team members
- [ ] CODEOWNERS file is in sync
- [ ] Code review process is up-to-date
- [ ] Triage guidelines are accurate
- [ ] Contact information is current

---

## Related Documentation

- [CODEOWNERS](./.github/CODEOWNERS) - GitHub ownership enforcement
- [Code Review Process](./docs/code-review-process.md) - Review procedures
- [Contributing Guide](./CONTRIBUTING.md) - Contribution guidelines
- [Branch Protection](./docs/branch-protection.md) - Branch protection rules
- [CurrentState.md](./CurrentState.md) - Project status

---

## Contact Information

### Maintainer
- **GitHub**: @Calebux
- **Role**: Root Maintainer
- **Responsibilities**: All areas, final decisions, escalations

### Team Leads
- **Frontend Team Lead**: @Calebux
- **Backend Team Lead**: @Calebux
- **Smart Contract Team Lead**: @Calebux
- **Infrastructure Team Lead**: @Calebux
- **DevOps Team Lead**: @Calebux

**Note**: As the project grows, team leads will be designated for each area.

---

## Changelog

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-05-27 | Initial ownership matrix created | @Calebux |

---

**Next Review**: August 27, 2026 (Quarterly)
