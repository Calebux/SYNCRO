# v3 Team, Roles, and Principal-Agent Authorization Model

This document defines the role-based access control (RBAC) model for the SYNCRO v3 team system, which governs who can grant spending authority and move money.

## Role Definitions

| Role | Description |
|------|-------------|
| **owner** | Team creator with full authority. Can fund channels, grant authority, raise caps, change payout addresses, close channels, register agents, invite/remove members, update roles, and read usage. |
| **operator** | Can register agents within existing spending caps, read usage, view team members, invite members, and manage webhooks. Cannot fund channels, raise caps, change payouts, close channels, or update roles. |
| **viewer** | Read-only access. Can read usage and view team members only. Cannot perform any mutations. |

## Role-Action Matrix

| Action | owner | operator | viewer | MFA Required | Description |
|--------|:-----:|:--------:|:------:|:------------:|-------------|
| **Team Management** |
| View team members | ✅ | ✅ | ✅ | No | List all team members and their roles |
| Invite members | ✅ | ✅ | ❌ | No | Send team invitations |
| View pending invitations | ✅ | ✅ | ❌ | No | List pending team invitations |
| Update member role | ✅ | ❌ | ❌ | **Yes** | Change a member's role (granting authority) |
| Remove team member | ✅ | ✅ | ❌ | No | Remove a member from the team |
| Manage webhooks (Slack) | ✅ | ✅ | ❌ | No | Update Slack webhook URL |
| **Channel / Payment Operations** |
| Fund channels | ✅ | ❌ | ❌ | **Yes** | Deposit funds into payment channels |
| Grant spending authority | ✅ | ❌ | ❌ | **Yes** | Authorize agents to spend within caps |
| Raise cap | ✅ | ❌ | ❌ | **Yes** | Increase spending cap for agents/channels |
| Change payout address | ✅ | ❌ | ❌ | **Yes** | Modify the destination for payouts |
| Close channel | ✅ | ❌ | ❌ | No | Initiate channel closure |
| Register agents | ✅ | ✅ | ❌ | No | Register agents within existing caps |
| Read usage / view preferences | ✅ | ✅ | ✅ | No | View channel preferences and usage data |

## MFA Re-authentication Requirements

Actions marked with **"Yes"** in the "MFA Required" column require the user to complete MFA verification (TOTP code) before the action is executed. This is enforced server-side via the `requireMfaReauth` and `requireOwnerMfa` middlewares.

### Flow for Authority-Granting Actions:

1. User attempts a protected action (e.g., `POST /api/payment-channels/grant-authority`)
2. Server checks for `x-mfa-verified: true` header or `mfa_verified=true` query parameter
3. If not present, returns `403 Forbidden` with message directing to `/api/2fa/totp/verify`
4. User calls `POST /api/2fa/totp/verify` with valid TOTP code
5. On success, MFA route sets verification flag (via session/header/cookie)
6. User retries the protected action with MFA verification flag
7. Server validates MFA and executes the action

## API Endpoints

### Team Endpoints (`/api/team`)

| Method | Path | Required Role | MFA Required |
|--------|------|---------------|--------------|
| GET | `/` | owner, operator, viewer | No |
| POST | `/invite` | owner, operator | No |
| GET | `/pending` | owner, operator | No |
| POST | `/accept/:token` | (public, email-matched) | No |
| PUT | `/:memberId/role` | owner | **Yes** |
| DELETE | `/:memberId` | owner, operator | No |
| PATCH | `/slack-webhook` | owner, operator | No |

### Payment Channel Endpoints (`/api/payment-channels`)

| Method | Path | Required Role | MFA Required |
|--------|------|---------------|--------------|
| GET | `/preferences` | owner, operator, viewer | No |
| GET | `/usage` | owner, operator, viewer | No |
| PATCH | `/preferences` | owner | **Yes** |
| POST | `/fund` | owner | **Yes** |
| POST | `/grant-authority` | owner | **Yes** |
| PATCH | `/cap` | owner | **Yes** |
| PATCH | `/payout-address` | owner | **Yes** |
| POST | `/:id/close` | owner | No |
| POST | `/agents` | owner, operator | No |

## Server-Side Enforcement

All role checks are enforced **server-side** on every mutation:
- Middleware chain: `authenticate` → `attachTeamAuth` → `requireTeamRole` / `requireOwnerMfa` / `requireMfaReauth`
- No authorization logic resides in the frontend/console
- Each route handler validates the user's team role against the role matrix
- MFA re-authentication state is validated per-request

## Testing Coverage

Each role-action pair is covered by integration tests in `backend/tests/team-authorization.test.ts`:

| Test | Role | Action | Expected |
|------|------|--------|----------|
| `owner can fund channels` | owner | fund channels | 200 |
| `operator cannot fund channels` | operator | fund channels | 403 |
| `viewer cannot fund channels` | viewer | fund channels | 403 |
| `owner can grant authority` | owner | grant-authority | 200 |
| `operator cannot grant authority` | operator | grant-authority | 403 |
| `owner can raise cap` | owner | raise cap | 200 |
| `operator cannot raise cap` | operator | raise cap | 403 |
| `owner can change payout address` | owner | change payout | 200 |
| `operator cannot change payout address` | operator | change payout | 403 |
| `owner can close channel` | owner | close channel | 200 |
| `operator cannot close channel` | operator | close channel | 403 |
| `owner can register agents` | owner | register agents | 200 |
| `operator can register agents` | operator | register agents | 200 |
| `viewer cannot register agents` | viewer | register agents | 403 |
| `owner can read usage` | owner | read usage | 200 |
| `operator can read usage` | operator | read usage | 200 |
| `viewer can read usage` | viewer | read usage | 200 |
| `owner can update member role` | owner | update role | 200 |
| `operator cannot update member role` | operator | update role | 403 |
| `owner can remove members` | owner | remove members | 200 |
| `operator can remove members` | operator | remove members | 200 |
| `viewer cannot remove members` | viewer | remove members | 403 |
| `MFA required for owner grant authority` | owner | grant-authority (no MFA) | 403 |
| `MFA required for owner raise cap` | owner | raise cap (no MFA) | 403 |

## Database Schema

### `teams` table
- `id` (uuid, PK)
- `name` (text)
- `owner_id` (uuid, FK to auth.users)
- `slack_webhook_url` (text, nullable)

### `team_members` table
- `id` (uuid, PK)
- `team_id` (uuid, FK to teams)
- `user_id` (uuid, FK to auth.users)
- `role` (text: 'owner' | 'operator' | 'viewer' | 'admin' | 'member' — legacy roles supported for migration)
- `joined_at` (timestamp)

### `team_invitations` table
- `id` (uuid, PK)
- `team_id` (uuid, FK)
- `email` (text)
- `role` (text: 'owner' | 'operator' | 'viewer' | 'admin' | 'member')
- `token` (uuid)
- `invited_by` (uuid)
- `expires_at` (timestamp)
- `accepted_at` (timestamp, nullable)

## Migration Notes

- Legacy roles `admin` and `member` are still accepted in team invitations and stored in `team_members.role` for backward compatibility.
- The new v3 model maps: `admin` → `operator`, `member` → `viewer` (read-only).
- New invitations should use `operator` and `viewer` roles.
- The `canTeamRolePerformAction` function in `backend/src/middleware/team-auth.ts` handles the mapping.

## Implementation Files

| File | Purpose |
|------|---------|
| `backend/src/middleware/auth.ts` | Extended `UserRole` type to include `operator` |
| `backend/src/middleware/rbac.ts` | Updated `ROLE_PERMISSIONS` for new roles |
| `backend/src/middleware/team-auth.ts` | New team-scoped authorization middleware |
| `backend/src/routes/team.ts` | Updated team routes with v3 authorization |
| `backend/src/routes/payment-channels.ts` | New payment channel endpoints with v3 authorization |
| `backend/src/schemas/team.ts` | Updated validation schema for new roles |
| `backend/src/services/role-service.ts` | Added `operator` to valid roles |
| `backend/tests/team-authorization.test.ts` | Integration tests for all role-action pairs |
| `backend/docs/ROLE_MATRIX.md` | This documentation |