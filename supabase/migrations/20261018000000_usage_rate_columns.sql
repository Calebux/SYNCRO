-- supabase/migrations/20261018000000_usage_rate_columns.sql
--
-- Issue #1697 — store the rate source and rate card version on every usage row.
--
-- When a payer disputes a charge, SYNCRO must show which price applied.
-- Receipts carry some of this, but aggregated usage rows did not, so
-- reconciliation could not recompute a total from rows alone. Every new
-- `meter_usage_ledger` row now carries:
--
--   rate_card_version  which rate-card version priced the call
--   unit_price         cost per integer unit at serve time
--   fx_rate            FX multiplier applied to the priced amount
--   fx_source          where the FX rate came from ('none' when no FX applied)
--
-- No backfill: pre-launch tables are empty. NOT NULL with safe defaults keeps
-- the constraint strict for new rows without breaking writers that have not
-- been updated yet; the ledger service always writes explicit values.
--
-- The reconciliation report gains rate_mismatch_count / rate_mismatch_amount
-- so a run can show, from rows alone, how many committed totals do not equal
-- actual_units * unit_price * fx_rate.

alter table meter_usage_ledger
  add column if not exists rate_card_version text not null default 'v1',
  add column if not exists unit_price numeric not null default 0 check (unit_price >= 0),
  add column if not exists fx_rate numeric not null default 1 check (fx_rate > 0),
  add column if not exists fx_source text not null default 'none';

alter table usage_reconciliation_reports
  add column if not exists rate_mismatch_count integer not null default 0 check (rate_mismatch_count >= 0),
  add column if not exists rate_mismatch_amount numeric not null default 0 check (rate_mismatch_amount >= 0);
