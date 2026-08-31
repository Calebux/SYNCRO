-- Gift card ledger: tracks balance and autonomous monthly deductions
CREATE TABLE IF NOT EXISTS public.gift_card_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  amount numeric(10, 2) NOT NULL,
  -- positive = top-up, negative = deduction
  type text NOT NULL CHECK (type IN ('top_up', 'deduction')),
  description text,
  balance_after numeric(10, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Current balance view per user
CREATE OR REPLACE VIEW public.gift_card_balance AS
SELECT
  user_id,
  COALESCE(SUM(amount), 0) AS balance
FROM public.gift_card_ledger
GROUP BY user_id;

ALTER TABLE public.gift_card_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ledger_select_own" ON public.gift_card_ledger
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "ledger_insert_own" ON public.gift_card_ledger
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS gift_card_ledger_user_id_idx ON public.gift_card_ledger(user_id);
CREATE INDEX IF NOT EXISTS gift_card_ledger_subscription_id_idx ON public.gift_card_ledger(subscription_id);
