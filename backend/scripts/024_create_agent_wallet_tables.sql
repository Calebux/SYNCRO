-- Migration: 024_create_agent_wallet_tables.sql
-- Issue #862 — Privacy: Implement address rotation for agent wallets
--
-- Creates two tables:
--   agent_wallet_rotations  — tracks the current active address index per agent
--   agent_wallet_history    — immutable append-only log of every address used
--
-- Also creates a stored function used by the rotation service to atomically
-- increment the rotation_count counter.

-- ─── agent_wallet_rotations ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_wallet_rotations (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name       TEXT        NOT NULL,
    current_index    INTEGER     NOT NULL DEFAULT 0,
    public_key       TEXT        NOT NULL,
    last_rotated_at  TIMESTAMPTZ,
    rotation_count   INTEGER     NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT agent_wallet_rotations_agent_name_unique UNIQUE (agent_name),
    CONSTRAINT agent_wallet_rotations_index_non_negative CHECK (current_index >= 0),
    CONSTRAINT agent_wallet_rotations_agent_name_valid  CHECK (
        agent_name IN ('scout', 'ledger', 'signal', 'scribe', 'executor')
    )
);

COMMENT ON TABLE  public.agent_wallet_rotations IS
    'Tracks the current active HD-wallet address index for each pipeline agent.';
COMMENT ON COLUMN public.agent_wallet_rotations.agent_name IS
    'Pipeline agent identifier: scout | ledger | signal | scribe | executor';
COMMENT ON COLUMN public.agent_wallet_rotations.current_index IS
    'BIP-32 address index currently active for this agent.';
COMMENT ON COLUMN public.agent_wallet_rotations.public_key IS
    'Stellar public key (G…) of the currently active address.';
COMMENT ON COLUMN public.agent_wallet_rotations.last_rotated_at IS
    'Timestamp of the most recent rotation. NULL = never rotated (genesis).';
COMMENT ON COLUMN public.agent_wallet_rotations.rotation_count IS
    'Total number of rotations performed for this agent.';

-- ─── agent_wallet_history ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_wallet_history (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name     TEXT        NOT NULL,
    address_index  INTEGER     NOT NULL,
    public_key     TEXT        NOT NULL,
    drain_tx_hash  TEXT,
    reason         TEXT        NOT NULL DEFAULT 'rotation',
    recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT agent_wallet_history_agent_name_valid CHECK (
        agent_name IN ('scout', 'ledger', 'signal', 'scribe', 'executor')
    )
);

CREATE INDEX IF NOT EXISTS idx_agent_wallet_history_agent_name
    ON public.agent_wallet_history (agent_name, recorded_at DESC);

COMMENT ON TABLE  public.agent_wallet_history IS
    'Immutable audit log of every Stellar address used by each pipeline agent.';
COMMENT ON COLUMN public.agent_wallet_history.drain_tx_hash IS
    'Stellar transaction hash of the drain payment from this address to the next one. NULL if not yet drained or drain failed.';
COMMENT ON COLUMN public.agent_wallet_history.reason IS
    'Why this address was recorded: genesis | daily | weekly | per-task | manual | forced';

-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- These tables hold internal agent infrastructure data, not user data.
-- Restrict access to service-role only; no user-facing RLS policies needed.

ALTER TABLE public.agent_wallet_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_wallet_history   ENABLE ROW LEVEL SECURITY;

-- Service role bypass (Supabase service_role ignores RLS by default, but
-- we add explicit policies for documentation purposes).
CREATE POLICY "service_role_only_rotations" ON public.agent_wallet_rotations
    USING (auth.role() = 'service_role');

CREATE POLICY "service_role_only_history" ON public.agent_wallet_history
    USING (auth.role() = 'service_role');

-- ─── Stored function: increment_rotation_count ────────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_rotation_count(p_agent_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.agent_wallet_rotations
    SET    rotation_count = rotation_count + 1
    WHERE  agent_name = p_agent_name;
END;
$$;

COMMENT ON FUNCTION public.increment_rotation_count(TEXT) IS
    'Atomically increments the rotation counter for the given agent. Called by the rotation service after a successful rotation.';
