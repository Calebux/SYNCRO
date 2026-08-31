# Branch Protection Rules

This document describes the required branch protection configuration for `main` to prevent direct pushes and enforce code review + CI.

## Required Setup (Repo Admin Only)

Navigate to: **Settings → Branches → Add ruleset**
URL: `https://github.com/Calebux/SYNCRO/settings/branches`

### Rule: `main`

| Setting | Value |
|---|---|
| Branch name pattern | `main` |
| Require a pull request before merging | ✅ |
| Required approvals | `1` |
| Dismiss stale reviews on new commits | ✅ |
| Require status checks to pass | ✅ |
| Required checks | `Validate Environment Variables`, `Security Audit`, `Build Client`, `Test Backend` |
| Require branches to be up to date | ✅ |
| Do not allow bypassing (blocks admins) | ✅ |

### Effect
- Direct `git push` to `main` → **rejected**
- PRs without 1 approval → **blocked**
- PRs with failing CI → **blocked**
