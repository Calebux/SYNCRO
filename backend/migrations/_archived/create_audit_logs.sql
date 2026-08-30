-- Audit logs table for tracking user actions, security events, and system changes
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for optimal query performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON public.audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

-- Enable RLS (Row Level Security) for audit logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Audit logs can only be read by users who own them or by admins
CREATE POLICY audit_logs_select_own ON public.audit_logs
  FOR SELECT
  USING (auth.uid() = user_id OR auth.jwt() ->> 'is_admin' = 'true');

-- Only the backend (with service role) can insert audit logs
CREATE POLICY audit_logs_insert_backend ON public.audit_logs
  FOR INSERT
  WITH CHECK (true);

-- Audit logs are immutable (no updates or deletes except by admin)
CREATE POLICY audit_logs_delete_admin ON public.audit_logs
  FOR DELETE
  USING (auth.jwt() ->> 'is_admin' = 'true');
