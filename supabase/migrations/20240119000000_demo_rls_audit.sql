-- Demo migration to show RLS audit in action
-- This migration creates a table with proper RLS policies
-- If you remove the RLS policies, the audit will catch it

-- Create a demo table for RLS audit testing
CREATE TABLE IF NOT EXISTS public.demo_rls_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  demo_data TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS (REQUIRED - audit will fail without this)
ALTER TABLE public.demo_rls_table ENABLE ROW LEVEL SECURITY;

-- Add RLS policies (REQUIRED - audit will fail without these)
CREATE POLICY "demo_rls_table_select_own"
  ON public.demo_rls_table FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "demo_rls_table_insert_own"
  ON public.demo_rls_table FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "demo_rls_table_update_own"
  ON public.demo_rls_table FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "demo_rls_table_delete_own"
  ON public.demo_rls_table FOR DELETE
  USING (auth.uid() = user_id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS demo_rls_table_user_id_idx ON public.demo_rls_table(user_id);

-- Add comment explaining the purpose
COMMENT ON TABLE public.demo_rls_table IS 'Demo table for RLS audit testing - shows proper RLS implementation';

-- 
-- TESTING THE RLS AUDIT:
-- 
-- 1. With this migration applied, the RLS audit should PASS
-- 2. To test failure, comment out the RLS policies above and run the audit
-- 3. The audit will catch the missing policies and fail the CI
-- 
-- Example commands:
--   supabase db push                    # Apply this migration
--   npm run audit:rls:local            # Should pass
--   
--   # Then comment out policies and test again:
--   npm run audit:rls:local            # Should fail
--