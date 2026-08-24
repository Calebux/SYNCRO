-- LLM spend attribution for the email parser (issue #1281).
--
-- Budgets are enforced in-process by llm-budget-service so a database outage
-- cannot fail the cutoff open. This table is the durable attribution record:
-- who spent what, under which prompt version, during which scan.

CREATE TABLE IF NOT EXISTS public.llm_usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Null for calls made outside a user context (e.g. maintenance jobs).
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Rescan job id, so one mailbox scan's cost can be totalled.
  scan_id UUID,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  -- True when the row records a template-cache hit rather than a model call.
  cached BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Daily per-user rollups drive the budget dashboards.
CREATE INDEX IF NOT EXISTS idx_llm_usage_ledger_user_created
  ON public.llm_usage_ledger (user_id, created_at DESC);

-- Totalling a single scan's spend.
CREATE INDEX IF NOT EXISTS idx_llm_usage_ledger_scan
  ON public.llm_usage_ledger (scan_id)
  WHERE scan_id IS NOT NULL;

-- Attributing an accuracy change to the prompt that caused it (#1280).
CREATE INDEX IF NOT EXISTS idx_llm_usage_ledger_prompt_version
  ON public.llm_usage_ledger (prompt_version, created_at DESC);

ALTER TABLE public.llm_usage_ledger ENABLE ROW LEVEL SECURITY;

-- Users may read their own spend; nobody writes through the anon/authenticated
-- roles. Inserts happen via the service role from llm-budget-service.
DROP POLICY IF EXISTS "llm_usage_ledger_select_own" ON public.llm_usage_ledger;
CREATE POLICY "llm_usage_ledger_select_own"
  ON public.llm_usage_ledger
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Owners may read the whole ledger for cost review.
DROP POLICY IF EXISTS "llm_usage_ledger_owner_select" ON public.llm_usage_ledger;
CREATE POLICY "llm_usage_ledger_owner_select"
  ON public.llm_usage_ledger
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );

COMMENT ON TABLE public.llm_usage_ledger IS
  'Per-call LLM token and cost attribution for the email parser (issue #1281).';
