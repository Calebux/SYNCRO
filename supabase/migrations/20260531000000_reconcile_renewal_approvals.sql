-- =============================================================
-- Migration: Reconcile renewal_approvals after deduplication audit
-- Issue #655 - Canonical migration source is supabase/migrations/
-- =============================================================

-- Add subscription_id as a UUID foreign key (backend version had this)
ALTER TABLE public.renewal_approvals
  ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE CASCADE;

-- Add a computed TIMESTAMPTZ column so app code can read expires_at as a proper timestamp
ALTER TABLE public.renewal_approvals
  ADD COLUMN IF NOT EXISTS expires_at_ts TIMESTAMPTZ
    GENERATED ALWAYS AS (to_timestamp(expires_at)) STORED;

-- Add index on the new subscription_id column for fast lookups
CREATE INDEX IF NOT EXISTS idx_renewal_approvals_subscription_id
  ON public.renewal_approvals (subscription_id);

-- Document the column purposes clearly
COMMENT ON COLUMN public.renewal_approvals.blockchain_sub_id IS
  'The on-chain subscription ID from the Soroban contract (BIGINT).';

COMMENT ON COLUMN public.renewal_approvals.subscription_id IS
  'FK to public.subscriptions(id) — the app-level subscription this approval belongs to.';

COMMENT ON COLUMN public.renewal_approvals.expires_at IS
  'Unix epoch seconds (INTEGER) from the Soroban contract. Use expires_at_ts for display.';

COMMENT ON COLUMN public.renewal_approvals.expires_at_ts IS
  'Computed TIMESTAMPTZ version of expires_at for app-layer queries. Read-only.';

-- Enable RLS if not already enabled
ALTER TABLE public.renewal_approvals ENABLE ROW LEVEL SECURITY;

-- Service role only policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'renewal_approvals'
    AND policyname = 'Service role access only'
  ) THEN
    CREATE POLICY "Service role access only"
      ON public.renewal_approvals
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE public.renewal_approvals IS
  'Canonical renewal approvals table. Owned by supabase/migrations/. '
  'The backend/migrations/ version has been archived (Issue #655).';
