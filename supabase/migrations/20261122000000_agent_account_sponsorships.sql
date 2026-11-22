-- Server-managed Stellar wallets and sponsored account/trustline reserves (#1858).
-- The private signing key lives in the configured secret provider; only its reference is stored here.
CREATE TABLE IF NOT EXISTS public.agent_account_sponsorships (
  id uuid PRIMARY KEY,
  principal_public_key text NOT NULL,
  agent_public_key text NOT NULL UNIQUE,
  secret_name text NOT NULL UNIQUE,
  sponsor_public_key text NOT NULL DEFAULT '',
  network text NOT NULL,
  asset_code text NOT NULL DEFAULT 'USDC',
  asset_issuer text NOT NULL,
  status text NOT NULL CHECK (status IN ('provisioning','active','reclaim_pending','reclaimed','failed')),
  create_transaction_hash text,
  reclaim_transaction_hash text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_account_sponsorships_principal_idx
  ON public.agent_account_sponsorships (principal_public_key, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_account_sponsorships_status_idx
  ON public.agent_account_sponsorships (status)
  WHERE status IN ('provisioning','reclaim_pending','failed');
ALTER TABLE public.agent_account_sponsorships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_account_sponsorships FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_account_sponsorships TO service_role;
CREATE POLICY agent_account_sponsorships_service_role
  ON public.agent_account_sponsorships FOR ALL TO service_role
  USING (true) WITH CHECK (true);
