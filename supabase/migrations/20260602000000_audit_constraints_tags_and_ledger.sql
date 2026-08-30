-- ============================================================
-- Migration: Audit constraints on tags and gift_card_ledger
-- Issue: #660 [P1]
-- Created: 2026-06-02
-- ============================================================
--
-- This migration does two things:
--   1. Creates the tags and subscription_tags tables from scratch
--   2. Adds missing constraints to the gift_card_ledger table
-- ============================================================
-- ============================================================
-- SECTION 1: Create the tags table
-- ============================================================

-- A tag belongs to one user and has a name and optional color.
-- Examples: "Work", "Entertainment", "Family"

CREATE TABLE IF NOT EXISTS public.tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Rule 1: A user cannot have two tags with the same name.
-- lower(name) makes this case-insensitive so "Work" and "work"
-- are treated as the same tag.
CREATE UNIQUE INDEX IF NOT EXISTS tags_user_id_name_lower_key
  ON public.tags (user_id, lower(name));

-- Rule 2: Tag name must be between 1 and 50 characters.
-- trim(name) removes spaces from both ends first, so "   " is rejected.
ALTER TABLE public.tags
  ADD CONSTRAINT tags_name_length_check
  CHECK (length(trim(name)) BETWEEN 1 AND 50);

-- Rule 3: Color must be a valid hex color like #FF5733 or #F73,
-- or left empty (NULL). The ~ symbol means "must match this pattern".
ALTER TABLE public.tags
  ADD CONSTRAINT tags_color_check
  CHECK (
    color IS NULL
    OR color ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'
  );

-- Enable RLS (Row Level Security) so users can only see their own tags
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_select_own"
  ON public.tags FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "tags_insert_own"
  ON public.tags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tags_update_own"
  ON public.tags FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "tags_delete_own"
  ON public.tags FOR DELETE
  USING (auth.uid() = user_id);

  -- ============================================================
-- SECTION 2: Create the subscription_tags table
-- ============================================================

-- This table links subscriptions to tags.
-- One subscription can have many tags.
-- One tag can be applied to many subscriptions.

CREATE TABLE IF NOT EXISTS public.subscription_tags (
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  tag_id          uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- This prevents the same tag being applied to the same
  -- subscription twice
  PRIMARY KEY (subscription_id, tag_id)
);

-- Enable RLS
ALTER TABLE public.subscription_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_tags_select_own"
  ON public.subscription_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tags
      WHERE tags.id = tag_id
      AND tags.user_id = auth.uid()
    )
  );

CREATE POLICY "subscription_tags_insert_own"
  ON public.subscription_tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tags
      WHERE tags.id = tag_id
      AND tags.user_id = auth.uid()
    )
  );

CREATE POLICY "subscription_tags_delete_own"
  ON public.subscription_tags FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tags
      WHERE tags.id = tag_id
      AND tags.user_id = auth.uid()
    )
  );

-- Index for looking up all subscriptions that have a given tag
CREATE INDEX IF NOT EXISTS subscription_tags_tag_id_idx
  ON public.subscription_tags (tag_id);

  -- ============================================================
-- SECTION 3: Add missing constraints to gift_card_ledger
-- ============================================================

-- Add a reference_id column for idempotency (duplicate protection).
-- This lets the app send the same request twice safely —
-- the second one will be rejected instead of recorded twice.
ALTER TABLE public.gift_card_ledger
  ADD COLUMN IF NOT EXISTS reference_id text;

-- Add a currency column so we know what currency the amount is in.
ALTER TABLE public.gift_card_ledger
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

-- Rule 1: Amount must never be zero.
-- A zero-value entry means nothing happened and should not be saved.
ALTER TABLE public.gift_card_ledger
  DROP CONSTRAINT IF EXISTS gift_card_ledger_amount_check;
ALTER TABLE public.gift_card_ledger
  ADD CONSTRAINT gift_card_ledger_amount_check
  CHECK (amount <> 0);

-- Rule 2: Expand the type check to include refund, adjustment, expiry.
-- We drop the old one first because you cannot modify a constraint,
-- only drop and recreate it.
ALTER TABLE public.gift_card_ledger
  DROP CONSTRAINT IF EXISTS gift_card_ledger_type_check;
ALTER TABLE public.gift_card_ledger
  ADD CONSTRAINT gift_card_ledger_type_check
  CHECK (type IN ('top_up', 'deduction', 'refund', 'adjustment', 'expiry'));

-- Rule 3: The sign of amount must match the type.
-- top_up and refund must be positive (adding money).
-- deduction and expiry must be negative (removing money).
-- adjustment can be either.
ALTER TABLE public.gift_card_ledger
  DROP CONSTRAINT IF EXISTS gift_card_ledger_type_amount_sign_check;
ALTER TABLE public.gift_card_ledger
  ADD CONSTRAINT gift_card_ledger_type_amount_sign_check
  CHECK (
    (type IN ('top_up', 'refund')       AND amount > 0)
    OR (type IN ('deduction', 'expiry') AND amount < 0)
    OR (type = 'adjustment')
  );

-- Rule 4: Currency must be a valid 3-letter code like USD, EUR, GBP.
ALTER TABLE public.gift_card_ledger
  DROP CONSTRAINT IF EXISTS gift_card_ledger_currency_check;
ALTER TABLE public.gift_card_ledger
  ADD CONSTRAINT gift_card_ledger_currency_check
  CHECK (currency ~ '^[A-Z]{3}$');

-- Rule 5: balance_after must never go below zero.
-- A negative balance means the user spent more than they had.
ALTER TABLE public.gift_card_ledger
  DROP CONSTRAINT IF EXISTS gift_card_ledger_balance_after_check;
ALTER TABLE public.gift_card_ledger
  ADD CONSTRAINT gift_card_ledger_balance_after_check
  CHECK (balance_after >= 0);

-- Rule 6: reference_id must be unique per user when provided.
-- This prevents the same transaction being recorded twice.
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_ledger_reference_id_user_idx
  ON public.gift_card_ledger (user_id, reference_id)
  WHERE reference_id IS NOT NULL;

  -- ============================================================
-- ROLLBACK: Run these manually if you need to undo this migration
-- ============================================================
--
-- DROP TABLE IF EXISTS public.subscription_tags;
-- DROP TABLE IF EXISTS public.tags;
--
-- ALTER TABLE public.gift_card_ledger DROP COLUMN IF EXISTS reference_id;
-- ALTER TABLE public.gift_card_ledger DROP COLUMN IF EXISTS currency;
--
-- ALTER TABLE public.gift_card_ledger DROP CONSTRAINT IF EXISTS gift_card_ledger_amount_check;
-- ALTER TABLE public.gift_card_ledger DROP CONSTRAINT IF EXISTS gift_card_ledger_type_check;
-- ALTER TABLE public.gift_card_ledger DROP CONSTRAINT IF EXISTS gift_card_ledger_type_amount_sign_check;
-- ALTER TABLE public.gift_card_ledger DROP CONSTRAINT IF EXISTS gift_card_ledger_currency_check;
-- ALTER TABLE public.gift_card_ledger DROP CONSTRAINT IF EXISTS gift_card_ledger_balance_after_check;
-- DROP INDEX IF EXISTS gift_card_ledger_reference_id_user_idx;
--
-- Then re-add the original type check:
-- ALTER TABLE public.gift_card_ledger
--   ADD CONSTRAINT gift_card_ledger_type_check
--   CHECK (type IN ('top_up', 'deduction'));
-- ============================================================