-- CSP Violations table for tracking Content Security Policy violations
-- This table stores all CSP violation reports from browsers to help identify
-- security issues and tune CSP policies before enforcing them.

CREATE TABLE IF NOT EXISTS public.csp_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Violation details
  document_uri TEXT NOT NULL,
  violated_directive TEXT NOT NULL,
  blocked_uri TEXT,
  source_file TEXT,
  line_number INTEGER,
  column_number INTEGER,
  disposition TEXT CHECK (disposition IN ('enforce', 'report')),
  status_code INTEGER,
  script_sample TEXT,
  
  -- Request context
  user_agent TEXT,
  ip_address INET,
  referer TEXT,
  
  -- User context (nullable - violations can occur for anonymous users)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Aggregation helper (computed from violated_directive + blocked_uri)
  violation_signature TEXT GENERATED ALWAYS AS (
    violated_directive || '::' || COALESCE(blocked_uri, 'none')
  ) STORED
);

-- Indexes for optimal query performance
CREATE INDEX IF NOT EXISTS idx_csp_violations_created ON public.csp_violations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csp_violations_directive ON public.csp_violations(violated_directive, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csp_violations_signature ON public.csp_violations(violation_signature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csp_violations_user ON public.csp_violations(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_csp_violations_disposition ON public.csp_violations(disposition, created_at DESC);

-- Materialized view for aggregated violation statistics
-- Refresh this periodically (e.g., every 5 minutes) for dashboard queries
CREATE MATERIALIZED VIEW IF NOT EXISTS public.csp_violation_stats AS
SELECT 
  violation_signature,
  violated_directive,
  blocked_uri,
  disposition,
  COUNT(*) as occurrence_count,
  COUNT(DISTINCT user_id) as affected_users,
  COUNT(DISTINCT ip_address) as affected_ips,
  MIN(created_at) as first_seen,
  MAX(created_at) as last_seen,
  -- Calculate hourly rate for the last 24 hours
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as count_24h,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as count_1h
FROM public.csp_violations
WHERE created_at > NOW() - INTERVAL '30 days'  -- Only aggregate recent violations
GROUP BY violation_signature, violated_directive, blocked_uri, disposition;

-- Index on materialized view for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_csp_violation_stats_signature 
  ON public.csp_violation_stats(violation_signature);
CREATE INDEX IF NOT EXISTS idx_csp_violation_stats_count 
  ON public.csp_violation_stats(occurrence_count DESC);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_csp_violation_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.csp_violation_stats;
END;
$$;

-- Enable RLS (Row Level Security) for CSP violations
ALTER TABLE public.csp_violations ENABLE ROW LEVEL SECURITY;

-- Only admins can read CSP violations (sensitive security data)
CREATE POLICY csp_violations_select_admin ON public.csp_violations
  FOR SELECT
  USING (auth.jwt() ->> 'is_admin' = 'true');

-- Only the backend (with service role) can insert CSP violations
CREATE POLICY csp_violations_insert_backend ON public.csp_violations
  FOR INSERT
  WITH CHECK (true);

-- CSP violations are immutable (no updates or deletes except by admin)
CREATE POLICY csp_violations_delete_admin ON public.csp_violations
  FOR DELETE
  USING (auth.jwt() ->> 'is_admin' = 'true');

-- Grant necessary permissions
GRANT SELECT ON public.csp_violation_stats TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_csp_violation_stats() TO service_role;

-- Comment on table and columns for documentation
COMMENT ON TABLE public.csp_violations IS 'Stores Content Security Policy violation reports from browsers';
COMMENT ON COLUMN public.csp_violations.violation_signature IS 'Computed signature for grouping similar violations';
COMMENT ON MATERIALIZED VIEW public.csp_violation_stats IS 'Aggregated CSP violation statistics for monitoring and alerting';
