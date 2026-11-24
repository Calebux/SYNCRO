-- ============================================================
-- Migration: Immutable Double-Entry Gift Card Ledger System
-- Issue: Phase 1 Crypto to Gift Card to Subscription Ledger
-- Created: 2026-08-28
-- ============================================================

-- 1. Create gift_card_ledger_transactions table
CREATE TABLE IF NOT EXISTS public.gift_card_ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason_code text NOT NULL CHECK (
    reason_code IN (
      'PURCHASE',
      'REDEMPTION',
      'EXPIRY',
      'ADJUSTMENT',
      'REVERSAL',
      'TOP_UP',
      'DEDUCTION'
    )
  ),
  description text,
  reference_id text,
  reversal_of_transaction_id uuid REFERENCES public.gift_card_ledger_transactions(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency protection index
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_ledger_transactions_reference_idx
  ON public.gift_card_ledger_transactions (user_id, reference_id)
  WHERE reference_id IS NOT NULL;

-- 2. Create gift_card_ledger_postings table
CREATE TABLE IF NOT EXISTS public.gift_card_ledger_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.gift_card_ledger_transactions(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  gift_card_id uuid REFERENCES public.subscription_gift_cards(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount <> 0),
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_card_ledger_postings_tx_idx
  ON public.gift_card_ledger_postings (transaction_id);

CREATE INDEX IF NOT EXISTS gift_card_ledger_postings_account_idx
  ON public.gift_card_ledger_postings (account_id);

CREATE INDEX IF NOT EXISTS gift_card_ledger_postings_user_idx
  ON public.gift_card_ledger_postings (user_id);

-- 3. Create checkpoints table for periodic verification job
CREATE TABLE IF NOT EXISTS public.gift_card_ledger_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  checkpoint_balance numeric(12, 2) NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  is_valid boolean NOT NULL DEFAULT true,
  notes text
);

CREATE INDEX IF NOT EXISTS gift_card_ledger_checkpoints_account_idx
  ON public.gift_card_ledger_checkpoints (account_id, verified_at DESC);

-- 4. Derived Balance View
-- Computes user balance on-the-fly from postings without any stored balance field
CREATE OR REPLACE VIEW public.gift_card_balance AS
SELECT
  user_id,
  COALESCE(SUM(amount), 0) AS balance
FROM public.gift_card_ledger_postings
WHERE user_id IS NOT NULL
  AND (
    account_id LIKE 'user:gift_card:%'
    OR account_id = 'user:' || user_id::text
  )
GROUP BY user_id;

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.gift_card_ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_ledger_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_card_ledger_checkpoints ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "ledger_tx_select_own" ON public.gift_card_ledger_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "ledger_tx_insert_own" ON public.gift_card_ledger_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ledger_postings_select_own" ON public.gift_card_ledger_postings
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "ledger_postings_insert_own" ON public.gift_card_ledger_postings
  FOR INSERT WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "ledger_checkpoints_select_own" ON public.gift_card_ledger_checkpoints
  FOR SELECT USING (true);
