-- Create commitment_blinding_factors table for privacy-preserving audit logs
-- This table stores blinding factors that allow selective disclosure of audit events
-- while keeping on-chain commitments private.

CREATE TABLE IF NOT EXISTS commitment_blinding_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- On-chain commitment reference
  commitment_hash BYTEA NOT NULL,                    -- 32 bytes SHA-256 hash
  commitment_index BIGINT NOT NULL,                   -- Monotonic on-chain index
  
  -- Blinding factor (encrypted at rest)
  blinding_factor BYTEA NOT NULL,                     -- 32 bytes, encrypted with AES-256-GCM
  
  -- Original event data (for operational queries and GDPR export)
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Constraints
  CONSTRAINT unique_commitment_hash UNIQUE(commitment_hash),
  CONSTRAINT unique_commitment_index UNIQUE(commitment_index),
  CONSTRAINT check_commitment_hash_size CHECK (octet_length(commitment_hash) = 32),
  CONSTRAINT check_blinding_factor_size CHECK (octet_length(blinding_factor) >= 32)
);

-- Indexes for efficient queries
CREATE INDEX idx_blinding_factors_user ON commitment_blinding_factors(user_id);
CREATE INDEX idx_blinding_factors_commitment ON commitment_blinding_factors(commitment_hash);
CREATE INDEX idx_blinding_factors_index ON commitment_blinding_factors(commitment_index);
CREATE INDEX idx_blinding_factors_event_type ON commitment_blinding_factors(event_type);
CREATE INDEX idx_blinding_factors_created_at ON commitment_blinding_factors(created_at DESC);

-- Enable RLS
ALTER TABLE commitment_blinding_factors ENABLE ROW LEVEL SECURITY;

-- RLS policies: Users can only access their own blinding factors
CREATE POLICY "commitment_blinding_factors_select_own"
  ON commitment_blinding_factors FOR SELECT
  USING (user_id = auth.uid());

-- Service role can insert (for commitment generation)
CREATE POLICY "commitment_blinding_factors_insert_service"
  ON commitment_blinding_factors FOR INSERT
  WITH CHECK (true);  -- Service role bypasses RLS, but policy must exist

-- Users cannot update or delete (immutable audit log)
-- Admin/service operations use service role which bypasses RLS

-- Comments for documentation
COMMENT ON TABLE commitment_blinding_factors IS 'Stores blinding factors for privacy-preserving audit commitments. Enables selective disclosure while keeping on-chain data private.';
COMMENT ON COLUMN commitment_blinding_factors.commitment_hash IS 'SHA-256 hash of (event_data || blinding_factor || domain_separator)';
COMMENT ON COLUMN commitment_blinding_factors.blinding_factor IS 'Encrypted 32-byte random blinding factor (AES-256-GCM)';
COMMENT ON COLUMN commitment_blinding_factors.event_data IS 'Original plaintext event data for operational queries';
