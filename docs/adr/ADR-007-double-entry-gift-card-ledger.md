# ADR-007: Double-Entry Immutable Ledger for Gift Card Financial Tracking

**Status:** Accepted (Retrospective)  
**Date:** 2026-06-05  
**Deciders:** Backend & Database Engineering Teams  
**Issue/PR:** #636  

---

## Context

Tracking prepaid gift card issuance, redemptions, and balances with single-column SQL fields (e.g., `UPDATE gift_cards SET remaining_amount = remaining_amount - 10`) presents critical financial audit risks:
- **Race Conditions**: Parallel API requests can result in lost balance updates or negative balances.
- **Audit Deficit**: Updating a row in-place destroys historical transaction context and makes forensic balance reconciliation impossible.
- **Accounting Violations**: Standard accounting principles require matching debits and credits across assets and liabilities.

---

## Decision

We instituted an **Immutable Double-Entry Ledger System** for all gift card operations.

- **Immutable Ledger Table**: `gift_card_ledger_entries` records all financial events as immutable rows; `UPDATE` and `DELETE` operations are disabled via database triggers.
- **Double-Entry Structure**: Every transaction records entry type (`ISSUE`, `REDEMPTION`, `ADJUSTMENT`, `EXPIRE`), currency/asset symbol, debit account, credit account, and exact amount.
- **Computed Balances**: Account and gift card balances are derived dynamically by summing entries (`SUM(debit) - SUM(credit)`), verified by background consistency checks (`GiftCardLedgerVerifier`).
- **Database Constraints**: SQL check constraints enforce non-zero amounts, asset code matching, and non-negative derived balances.

---

## Consequences

### Positive
- **Immutable Financial Audit Trail**: Complete, unalterable history of every cent issued, redeemed, or expired.
- **Mathematical Integrity**: System guarantees total debits equal total credits across all accounts.
- **Concurrency Safety**: Appending new ledger entries avoids row-lock contention and in-place mutation race conditions.

### Negative
- **Storage Growth**: Table size grows monotonically with transaction volume (requires index optimization on `card_id` and `created_at`).
- **Read Query Complexity**: Fetching current balance requires aggregation queries or cached balance materializations.

---

## Compliance & Verification

- SQL Migration `supabase/migrations/20260828000000_immutable_double_entry_gift_card_ledger.sql` enforces immutability triggers.
- Concurrency and constraint test suites (`backend/tests/gift-card-ledger-concurrency.test.ts`, `backend/tests/db-constraint-errors.test.ts`) pass cleanly in CI.
