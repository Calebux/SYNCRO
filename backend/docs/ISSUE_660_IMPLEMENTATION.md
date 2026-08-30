# Issue #660 — Implementation Summary
## [P1] Audit constraints on reminder, tag, and ledger tables

**Date:** 2026-06-02  
**Branch:** your branch name here  
**Status:** Complete

---

## What this issue asked for

The `tags`, `subscription_tags`, and `gift_card_ledger` tables had almost no
safety rules (constraints). This meant the database could accept bad data like
blank tag names, duplicate tag assignments, or gift card deductions that would
make a user's balance go negative.

This issue asked us to:
1. Audit what constraints were missing
2. Add those constraints via a migration
3. Update the app to handle new constraint errors gracefully
4. Write tests to prove everything works

---
## Files changed

### 1. New migration
`supabase/migrations/20260602000000_audit_constraints_tags_and_ledger.sql`

Creates two brand new tables and adds missing constraints to an existing one.

### 2. New utility
`backend/src/utils/db-constraint-errors.ts`

Maps Postgres constraint violation errors to typed HTTP errors so routes can
return friendly 4xx responses instead of raw 500s.

### 3. Updated route
`backend/src/routes/tags.ts`

- Added `parseDbError` to the `POST /api/tags` handler
- Added `parseDbError` to the `POST /api/subscriptions/:id/tags` handler
- Added `parseDbError` to the `DELETE /api/subscriptions/:id/tags/:tagId` handler
- Fixed table name from `subscription_tag_assignments` to `subscription_tags`
- Fixed table name from `subscription_tags` to `tags` in the GET and POST handlers

### 4. Updated route
`backend/src/routes/gift-card-ledger.ts`

- Added `parseDbError` to the `POST /api/gift-card-ledger/top-up` handler

### 5. New tests
`backend/tests/db-constraint-errors.test.ts`

13 unit tests covering every constraint mapping and the generic fallback.
No database connection required — all tests use fake Postgres error objects.

---

## What the migration does

### tags table (created from scratch)
| Constraint | Rule |
|---|---|
| `tags_user_id_fkey` | user_id must refer to a real user |
| `tags_user_id_name_lower_key` | no duplicate tag names per user (case-insensitive) |
| `tags_name_length_check` | name must be 1–50 characters |
| `tags_color_check` | color must be a valid hex code like #FF5733 or empty |

### subscription_tags table (created from scratch)
| Constraint | Rule |
|---|---|
| `subscription_tags_pkey` | composite primary key prevents duplicate tag assignments |
| `subscription_tags_subscription_id_fkey` | subscription_id must refer to a real subscription |
| `subscription_tags_tag_id_fkey` | tag_id must refer to a real tag |

### gift_card_ledger table (updated)
| Constraint | Rule |
|---|---|
| `gift_card_ledger_amount_check` | amount must never be zero |
| `gift_card_ledger_type_check` | type expanded to include refund, adjustment, expiry |
| `gift_card_ledger_type_amount_sign_check` | top_up/refund must be positive, deduction/expiry must be negative |
| `gift_card_ledger_currency_check` | currency must be a valid 3-letter ISO code |
| `gift_card_ledger_balance_after_check` | balance can never go below zero |
| `gift_card_ledger_reference_id_user_idx` | reference_id must be unique per user |

---

## How to apply the migration

```bash
# From the repo root
supabase db push
```

---

## How to run the tests

```bash
# From the backend folder
cd backend
npx jest --testPathPattern="db-constraint-errors"
```

---

## Security notes

- No RLS policies were removed or weakened
- All new tables have RLS enabled with owner-only policies
- No new environment variables required
- Migration is safe to re-run — all statements use IF NOT EXISTS guards

---

## PR checklist

- [x] Constraint inventory produced
- [x] Missing constraints added via migration
- [x] Application code updated to handle new constraint errors
- [x] Tests added and passing
- [x] Documentation written
- [x] No security regressions