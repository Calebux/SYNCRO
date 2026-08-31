# Ownership Quick Reference

**Last Updated**: May 27, 2026  
**For**: SYNCRO Development Team

## Quick Links

- 📋 [Full Ownership Matrix](./DIRECTORY_OWNERSHIP_MATRIX.md)
- 👥 [CODEOWNERS](./.github/CODEOWNERS)
- 📝 [Code Review Process](./docs/code-review-process.md)
- 🤝 [Contributing Guide](./CONTRIBUTING.md)

## TL;DR - Who Owns What

| I'm working on... | Owner | Team |
|-------------------|-------|------|
| React components, UI | @Calebux | Frontend |
| API endpoints, services | @Calebux | Backend |
| Smart contracts | @Calebux | Smart Contract |
| Database migrations | @Calebux | Infrastructure |
| SDK, public APIs | @Calebux | SDK |
| Documentation | @Calebux | Documentation |
| CI/CD workflows | @Calebux | DevOps |
| Automation scripts | @Calebux | DevOps |

## Common Questions

### "Where do I report a bug?"

1. **Identify the area** using the table above
2. **Create an issue** on GitHub
3. **Tag the owner** (e.g., @Calebux)
4. **Add labels**: `bug`, area label (e.g., `frontend`, `backend`)

### "Who reviews my PR?"

Check `.github/CODEOWNERS` - GitHub automatically requests reviews from owners of files you changed.

### "My PR needs urgent review"

1. **Wait 24 hours** for initial response
2. **Comment** mentioning the owner after 48 hours
3. **Escalate** to @Calebux after 72 hours

### "I need to change multiple areas"

- Tag all affected owners in your PR
- One owner takes lead responsibility
- All owners must approve before merge

## Directory Ownership Map

```
SYNCRO/
├── client/              → Frontend Team (@Calebux)
│   ├── app/            → Next.js pages
│   ├── components/     → React components
│   ├── hooks/          → Custom hooks
│   ├── lib/            → Client utilities
│   └── __tests__/      → Frontend tests
│
├── backend/            → Backend Team (@Calebux)
│   ├── src/routes/    → API endpoints
│   ├── src/services/  → Business logic
│   ├── src/middleware/→ Express middleware
│   └── tests/         → Backend tests
│
├── contracts/          → Smart Contract Team (@Calebux)
│   ├── contracts/     → Soroban contracts
│   └── scripts/       → Deployment scripts
│
├── supabase/          → Infrastructure Team (@Calebux)
│   └── migrations/    → Database migrations
│
├── sdk/               → SDK Team (@Calebux)
│   └── src/          → SDK source code
│
├── shared/            → Platform Team (@Calebux)
│   └── src/          → Shared types
│
├── docs/              → Documentation Team (@Calebux)
│   ├── api-reference/→ API docs
│   └── superpowers/  → Feature docs
│
├── scripts/           → DevOps Team (@Calebux)
│   └── *.js          → Automation scripts
│
└── .github/           → DevOps Team (@Calebux)
    └── workflows/     → CI/CD pipelines
```

## Issue Triage Cheat Sheet

### Frontend Issues
**Examples**: UI bugs, component errors, styling issues, E2E test failures  
**Owner**: @Calebux  
**Labels**: `frontend`, `ui`, `component`

### Backend Issues
**Examples**: API errors, business logic bugs, database query issues  
**Owner**: @Calebux  
**Labels**: `backend`, `api`, `service`

### Smart Contract Issues
**Examples**: Contract execution failures, gas issues, deployment problems  
**Owner**: @Calebux  
**Labels**: `contracts`, `blockchain`, `soroban`

### Database Issues
**Examples**: Migration failures, RLS violations, schema problems  
**Owner**: @Calebux  
**Labels**: `database`, `migration`, `rls`

### SDK Issues
**Examples**: SDK API bugs, integration problems, documentation gaps  
**Owner**: @Calebux  
**Labels**: `sdk`, `integration`

### Documentation Issues
**Examples**: Outdated docs, broken links, missing examples  
**Owner**: @Calebux  
**Labels**: `documentation`, `docs`

### CI/CD Issues
**Examples**: Workflow failures, deployment issues, automation bugs  
**Owner**: @Calebux  
**Labels**: `ci-cd`, `devops`, `automation`

## PR Review Checklist

### Before Opening PR

- [ ] Identify affected areas (check directory structure)
- [ ] Review CODEOWNERS for required reviewers
- [ ] Ensure tests pass locally
- [ ] Update documentation if needed
- [ ] Add clear PR description

### During Review

- [ ] Address feedback promptly
- [ ] Request re-review after changes
- [ ] Escalate if review stalls (48+ hours)
- [ ] Ensure all required approvals received

### Before Merging

- [ ] All CI checks pass
- [ ] All required approvals received
- [ ] Branch is up-to-date with main
- [ ] No merge conflicts

## Escalation Path

```
Issue/PR Created
      ↓
Area Owner (24-48h)
      ↓
Team Lead (48-72h)
      ↓
@Calebux (Maintainer)
```

## Common Scenarios

### Scenario 1: UI Bug

1. **Report**: Create issue with `frontend` label
2. **Tag**: @Calebux
3. **Include**: Screenshots, browser info, reproduction steps
4. **Priority**: P0 (critical), P1 (high), P2 (medium), P3 (low)

### Scenario 2: API Endpoint Change

1. **PR**: Create PR with changes
2. **Auto-review**: GitHub requests review from @Calebux
3. **Documentation**: Update API docs if needed
4. **Tests**: Add/update tests
5. **Merge**: After approval and CI pass

### Scenario 3: Database Migration

1. **Create**: Use `supabase migration new <name>`
2. **Test**: Apply locally with `supabase db push`
3. **PR**: Create PR with migration file
4. **Review**: @Calebux reviews
5. **CI**: Database workflow validates migration
6. **Merge**: After approval and CI pass

### Scenario 4: Cross-Area Change

1. **Identify**: List all affected areas
2. **PR**: Tag all owners in description
3. **Lead**: One owner takes lead
4. **Coordinate**: Owners discuss approach
5. **Approve**: All owners must approve
6. **Merge**: After all approvals

## Contact Information

### Maintainer
- **GitHub**: @Calebux
- **Role**: Root Maintainer
- **Scope**: All areas, final decisions

### Current Team Structure

**Note**: As a solo maintainer project, @Calebux currently owns all areas. As the team grows, specific team leads will be designated.

## Useful Commands

```bash
# Check who owns a file
git blame <file>

# See CODEOWNERS for a file
cat .github/CODEOWNERS | grep <path>

# Find all files owned by a user
grep "@username" .github/CODEOWNERS

# List all owners
cat .github/CODEOWNERS | grep "@" | sort | uniq
```

## Labels Reference

| Label | Area | Owner |
|-------|------|-------|
| `frontend` | Client UI/UX | @Calebux |
| `backend` | API/Services | @Calebux |
| `contracts` | Smart Contracts | @Calebux |
| `database` | Database/Migrations | @Calebux |
| `sdk` | Public SDK | @Calebux |
| `documentation` | Docs | @Calebux |
| `ci-cd` | CI/CD | @Calebux |
| `security` | Security | @Calebux |
| `performance` | Performance | @Calebux |
| `bug` | Bug Report | Area Owner |
| `feature` | Feature Request | Area Owner |
| `enhancement` | Enhancement | Area Owner |

## Priority Levels

| Priority | Description | Response Time |
|----------|-------------|---------------|
| P0 | Critical - Production down | Immediate |
| P1 | High - Major feature broken | 24 hours |
| P2 | Medium - Minor issue | 48 hours |
| P3 | Low - Nice to have | 1 week |

## Tips for Contributors

### Finding the Right Owner

1. **Check directory structure** in this guide
2. **Look at CODEOWNERS** file
3. **Check git history**: `git log <file>`
4. **Ask in PR/issue** if unsure

### Getting Faster Reviews

1. **Small PRs**: Keep PRs focused and small
2. **Clear description**: Explain what and why
3. **Tests included**: Add tests for changes
4. **Documentation updated**: Update docs if needed
5. **Tag correctly**: Use correct labels and owners

### Avoiding Review Delays

1. **Check CI first**: Ensure tests pass locally
2. **Follow conventions**: Match existing code style
3. **Complete PR template**: Fill out all sections
4. **Respond quickly**: Address feedback promptly
5. **Be patient**: Allow 24-48 hours for review

## Resources

- [Full Ownership Matrix](./DIRECTORY_OWNERSHIP_MATRIX.md) - Detailed ownership information
- [CODEOWNERS](./.github/CODEOWNERS) - GitHub enforcement
- [Code Review Process](./docs/code-review-process.md) - Review procedures
- [Contributing Guide](./CONTRIBUTING.md) - Contribution guidelines
- [CurrentState.md](./CurrentState.md) - Project status

## Need Help?

1. **Check this guide** first
2. **Review full ownership matrix** for details
3. **Ask in issue/PR** if unclear
4. **Tag @Calebux** for urgent matters

---

**Questions?** Open an issue with the `question` label or tag @Calebux.
