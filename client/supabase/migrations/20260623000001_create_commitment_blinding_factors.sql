-- Create commitment_blinding_factors table
CREATE TABLE IF NOT EXISTS commitment_blinding_factors (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id VARCHAR(255) NOT NULL,
  commitment_hash VARCHAR(255) NOT NULL,
  blinding_factor TEXT NOT NULL,
  event_data_plaintext JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

CREATE INDEX idx_commitment_blinding_factors_user_id ON commitment_blinding_factors(user_id);
CREATE INDEX idx_commitment_blinding_factors_event_id ON commitment_blinding_factors(event_id);
CREATE INDEX idx_commitment_blinding_factors_commitment_hash ON commitment_blinding_factors(commitment_hash);

-- Enable RLS
ALTER TABLE commitment_blinding_factors ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "commitment_blinding_factors_select_own"
  ON commitment_blinding_factors FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "commitment_blinding_factors_insert_own"
  ON commitment_blinding_factors FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "commitment_blinding_factors_update_own"
  ON commitment_blinding_factors FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "commitment_blinding_factors_delete_own"
  ON commitment_blinding_factors FOR DELETE
  USING (user_id = auth.uid());