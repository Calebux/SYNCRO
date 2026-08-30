# Code Review Process & Escalation Guide

## Overview

SYNCRO uses a `.github/CODEOWNERS` file to enforce required reviews based on code ownership boundaries. This document outlines the review process, escalation paths, and handoff procedures.

**Related Documentation**:
- [Directory Ownership Matrix](../DIRECTORY_OWNERSHIP_MATRIX.md) - Detailed ownership information
- [Ownership Quick Reference](../OWNERSHIP_QUICK_REFERENCE.md) - Quick lookup guide
- [CODEOWNERS](../.github/CODEOWNERS) - GitHub enforcement

## Ownership Boundaries

| Area | Owner | Primary Responsibility |
|------|-------|------------------------|
| **client/** | Frontend Team | UI/UX, components, hooks, styles, E2E tests |
| **backend/** | Backend Team | APIs, services, business logic, database queries |
| **contracts/** | Smart Contract Team | Blockchain logic, delegation, renewal windows |
| **supabase/** | Infrastructure Team | Database migrations, RLS policies, seed data |
| **sdk/** | SDK Team | Reminder SDK, logger, public APIs |
| **shared/** | Platform Team | Shared types, domain models |
| **docs/** | Documentation Team | Technical documentation, guides |
| **scripts/** | DevOps Team | Automation scripts, utilities |
| **.github/** | DevOps/Maintainer | CI/CD workflows, branch protection, automation |

**For detailed ownership information**, see [Directory Ownership Matrix](../DIRECTORY_OWNERSHIP_MATRIX.md).

## Review Requirements

### Approval Policy

- **Minimum reviewers:** 1 required approval from the code owner
- **Auto-request:** GitHub automatically requests reviews when PRs touch owned files
- **Merge criteria:** PR must have approved reviews before merging to `main`

### Ownership Enforcement

When a PR touches files in multiple ownership areas:

1. **GitHub automatically requests reviews** from all affected owners
2. **Each owner must approve** changes in their area
3. **No merge until all approvals received** (enforced by branch protection)

## Review Process

### For Contributors

1. **Before opening a PR:**
   - Check `.github/CODEOWNERS` to identify required reviewers
   - Leave a comment tagging owners if your change spans multiple areas
   - Link related issues in the PR description

2. **While in review:**
   - Address feedback promptly
   - If review stalls, escalate to the next level (see below)
   - Request re-review after making changes

3. **Addressing feedback:**
   - Discuss disagreements in PR comments (never commit controversial changes without consensus)
   - If ownership is unclear, involve the maintainer (@Calebux)

### For Owners/Reviewers

1. **Reviewing code in your area:**
   - Focus on design, logic, security, and maintainability
   - Check for test coverage and documentation
   - Ensure changes align with codebase conventions

2. **Cross-area changes:**
   - If a change affects your area but originated in another, review carefully but defer to the primary owner
   - Comment to flag concerns but allow the primary owner to make final decisions

3. **Approval criteria:**
   - Code is tested (unit tests pass, E2E tests pass if applicable)
   - Documentation is updated
   - No security or performance regressions
   - Follows project conventions

## Escalation Procedures

### Level 1: Owner Review (24-48 hours)

- PR automatically assigned to code owner
- If no response in 24 hours, leave a comment mentioning the reviewer
- If no response in 48 hours, escalate to Level 2

### Level 2: Secondary Review Request

- Tag the next senior team member in the same area
- Leave comment with `@mention` and brief summary of the change
- Provide context: "This PR has been pending review for 48h on [feature/area]"

### Level 3: Maintainer Escalation

- Tag @Calebux for urgent reviews
- Use clear subject line: `[URGENT] PR #123 - [area] - awaiting review`
- Include:
  - Why this is urgent
  - Which owner hasn't responded
  - How long it's been pending
  - Impact of delay

### Blocker Resolution

If a review is genuinely blocked (e.g., reviewer unavailable):

1. **Owner can request:** PR reviewer to unblock → reply with timeline
2. **Team can request:** Maintainer to bypass or reassign review
3. **Maintainer action:** Can approve on behalf of owner with documented reason in PR

## Special Cases

### Changes to `.github/CODEOWNERS`

- Must be approved by @Calebux
- Include rationale for ownership changes
- Update this document if boundaries change

### Hotfixes / Critical Bugs

- Fast-track available for urgent production issues
- Must include proof of criticality (incident report, customer impact)
- Requires 1 owner approval + 1 maintainer approval minimum
- Follow normal merge once expedited

### Documentation-Only Changes

- Still require review from affected area owners
- Can be approved by a single senior contributor
- No strict timeline if no code changes

### Large Refactors

- PRs > 400 lines require **advance planning**
- Create tracking issue or RFC (Request for Comment)
- Get owner sign-off before opening PR
- May be split into multiple PRs by owner request

## Branch Protection Rules

The `main` branch is protected with:

- ✅ Require pull request before merging
- ✅ Require CODEOWNERS review approvals
- ✅ Require status checks to pass (tests, type checks, linting)
- ✅ Require up-to-date branches before merging
- ✅ Dismiss stale review approvals when new commits pushed
- ✅ Restrict who can push to matching branches (maintainers only)

## Contributing to CODEOWNERS

To propose ownership changes:

1. **Open an issue** with:
   - Proposed change
   - Rationale (why existing structure is inadequate)
   - Impact (which teams affected)

2. **Create a PR** that:
   - Updates `.github/CODEOWNERS`
   - Updates this document with new boundaries
   - Tags @Calebux for discussion

3. **Approval:** Requires sign-off from affected owners + maintainer

## FAQ

**Q: Can I bypass CODEOWNERS review?**  
A: No. Only @Calebux can do this via branch protection settings, and only for emergencies.

**Q: What if I own code in multiple areas?**  
A: You must review your changes in each area independently. Consider splitting the PR by area.

**Q: How long should review take?**  
A: Target: 24 hours for initial review, 48 hours for approval. Escalate after 48h.

**Q: What if the owner is on vacation?**  
A: Set status in GitHub/Slack. Assign a backup owner or escalate to maintainer.

**Q: Can I merge my own PR?**  
A: No. Even maintainers require at least 1 peer review. Merge only after approval.

---

## Related Documentation

- [Directory Ownership Matrix](../DIRECTORY_OWNERSHIP_MATRIX.md) - Detailed ownership for all directories
- [Ownership Quick Reference](../OWNERSHIP_QUICK_REFERENCE.md) - Quick lookup guide
- [CODEOWNERS](../.github/CODEOWNERS) - GitHub enforcement file
- [Contributing Guide](../CONTRIBUTING.md) - Contribution guidelines

---

**Last updated:** 2026-05-27  
**Maintained by:** @Calebux
