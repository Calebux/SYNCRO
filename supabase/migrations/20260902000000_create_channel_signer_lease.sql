-- Channel Signer Lease Table
-- Prevents concurrent state signing by enforcing single active signer per channel

CREATE TABLE IF NOT EXISTS channel_signer_lease (
  channel_id UUID PRIMARY KEY REFERENCES payment_channels(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  lease_acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  last_nonce_allocated BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_signer_lease_expires ON channel_signer_lease(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_channel_signer_lease_instance ON channel_signer_lease(instance_id);

-- Function to acquire or renew a lease
CREATE OR REPLACE FUNCTION acquire_channel_signer_lease(
  p_channel_id UUID,
  p_instance_id TEXT,
  p_lease_duration_seconds INTEGER DEFAULT 30
)
RETURNS TABLE(
  success BOOLEAN,
  current_nonce BIGINT,
  lease_expires_at TIMESTAMPTZ,
  message TEXT
) AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_expires_at TIMESTAMPTZ := v_now + (p_lease_duration_seconds || ' seconds')::INTERVAL;
  v_existing_lease RECORD;
  v_nonce BIGINT;
BEGIN
  -- Lock the row to prevent race conditions
  SELECT * INTO v_existing_lease
  FROM channel_signer_lease
  WHERE channel_id = p_channel_id
  FOR UPDATE;

  -- Check if lease exists and is still valid
  IF v_existing_lease IS NOT NULL THEN
    IF v_existing_lease.lease_expires_at > v_now THEN
      -- Lease is still active
      IF v_existing_lease.instance_id = p_instance_id THEN
        -- Same instance, renew the lease
        UPDATE channel_signer_lease
        SET lease_expires_at = v_expires_at,
            updated_at = v_now
        WHERE channel_id = p_channel_id;
        
        RETURN QUERY SELECT 
          TRUE,
          v_existing_lease.last_nonce_allocated,
          v_expires_at,
          'Lease renewed'::TEXT;
        RETURN;
      ELSE
        -- Different instance holds the lease
        RETURN QUERY SELECT 
          FALSE,
          v_existing_lease.last_nonce_allocated,
          v_existing_lease.lease_expires_at,
          'Lease held by another instance'::TEXT;
        RETURN;
      END IF;
    ELSE
      -- Lease has expired, take it over
      UPDATE channel_signer_lease
      SET instance_id = p_instance_id,
          lease_acquired_at = v_now,
          lease_expires_at = v_expires_at,
          updated_at = v_now
      WHERE channel_id = p_channel_id;
      
      RETURN QUERY SELECT 
        TRUE,
        v_existing_lease.last_nonce_allocated,
        v_expires_at,
        'Expired lease acquired'::TEXT;
      RETURN;
    END IF;
  ELSE
    -- No existing lease, create new one
    INSERT INTO channel_signer_lease (
      channel_id,
      instance_id,
      lease_acquired_at,
      lease_expires_at
    ) VALUES (
      p_channel_id,
      p_instance_id,
      v_now,
      v_expires_at
    );
    
    RETURN QUERY SELECT 
      TRUE,
      0::BIGINT,
      v_expires_at,
      'New lease created'::TEXT;
    RETURN;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to allocate next nonce atomically
CREATE OR REPLACE FUNCTION allocate_next_nonce(
  p_channel_id UUID,
  p_instance_id TEXT
)
RETURNS TABLE(
  success BOOLEAN,
  nonce BIGINT,
  message TEXT
) AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lease RECORD;
  v_new_nonce BIGINT;
BEGIN
  -- Lock and fetch the lease
  SELECT * INTO v_lease
  FROM channel_signer_lease
  WHERE channel_id = p_channel_id
  FOR UPDATE;

  -- Verify lease ownership and validity
  IF v_lease IS NULL THEN
    RETURN QUERY SELECT 
      FALSE,
      0::BIGINT,
      'No lease exists for this channel'::TEXT;
    RETURN;
  END IF;

  IF v_lease.instance_id != p_instance_id THEN
    RETURN QUERY SELECT 
      FALSE,
      0::BIGINT,
      'Lease held by different instance'::TEXT;
    RETURN;
  END IF;

  IF v_lease.lease_expires_at <= v_now THEN
    RETURN QUERY SELECT 
      FALSE,
      0::BIGINT,
      'Lease has expired'::TEXT;
    RETURN;
  END IF;

  -- Allocate next nonce
  v_new_nonce := v_lease.last_nonce_allocated + 1;
  
  UPDATE channel_signer_lease
  SET last_nonce_allocated = v_new_nonce,
      updated_at = v_now
  WHERE channel_id = p_channel_id;

  RETURN QUERY SELECT 
    TRUE,
    v_new_nonce,
    'Nonce allocated'::TEXT;
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Function to release a lease
CREATE OR REPLACE FUNCTION release_channel_signer_lease(
  p_channel_id UUID,
  p_instance_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_lease RECORD;
BEGIN
  SELECT * INTO v_lease
  FROM channel_signer_lease
  WHERE channel_id = p_channel_id
  FOR UPDATE;

  IF v_lease IS NULL OR v_lease.instance_id != p_instance_id THEN
    RETURN FALSE;
  END IF;

  DELETE FROM channel_signer_lease
  WHERE channel_id = p_channel_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE channel_signer_lease ENABLE ROW LEVEL SECURITY;

-- Policy: only system/service role can manage leases
CREATE POLICY channel_signer_lease_system_policy ON channel_signer_lease
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

COMMENT ON TABLE channel_signer_lease IS 'Manages exclusive signing leases per channel to prevent concurrent state signing';
COMMENT ON FUNCTION acquire_channel_signer_lease IS 'Acquires or renews a signing lease for a channel instance';
COMMENT ON FUNCTION allocate_next_nonce IS 'Atomically allocates the next nonce for a channel with lease verification';
COMMENT ON FUNCTION release_channel_signer_lease IS 'Releases a signing lease held by an instance';
