-- Create RLS audit function for automated compliance checking
-- This function can be called by the audit scripts to check RLS status

CREATE OR REPLACE FUNCTION public.audit_rls_compliance()
RETURNS TABLE(
  table_name TEXT,
  rls_enabled BOOLEAN,
  policy_count INTEGER,
  status TEXT
) 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rec RECORD;
BEGIN
  -- Loop through all tables in public schema
  FOR rec IN 
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name NOT LIKE 'pg_%'
      AND t.table_name NOT LIKE 'sql_%'
    ORDER BY t.table_name
  LOOP
    -- Get RLS status and policy count for each table
    SELECT 
      rec.table_name,
      COALESCE(c.relrowsecurity, false) as rls_enabled,
      COALESCE(p.policy_count, 0) as policy_count,
      CASE 
        WHEN NOT COALESCE(c.relrowsecurity, false) THEN 'MISSING_RLS'
        WHEN COALESCE(p.policy_count, 0) = 0 THEN 'NO_POLICIES'
        ELSE 'OK'
      END as status
    INTO 
      table_name,
      rls_enabled, 
      policy_count,
      status
    FROM pg_class c
    LEFT JOIN (
      SELECT 
        tablename,
        COUNT(*) as policy_count
      FROM pg_policies 
      WHERE schemaname = 'public'
        AND tablename = rec.table_name
      GROUP BY tablename
    ) p ON p.tablename = rec.table_name
    WHERE c.relname = rec.table_name
      AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to authenticated users (for service role)
GRANT EXECUTE ON FUNCTION public.audit_rls_compliance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_rls_compliance() TO service_role;

-- Add comment
COMMENT ON FUNCTION public.audit_rls_compliance() IS 'Audits RLS policies on all public schema tables for security compliance';

-- Test the function (this will show current RLS status)
-- SELECT * FROM public.audit_rls_compliance();