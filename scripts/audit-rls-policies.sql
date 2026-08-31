-- RLS Policy Audit Script
-- This script verifies that EVERY table in the public schema has active RLS policies
-- Usage: Run this script against your database to check RLS compliance
-- Exit codes: 0 = all tables have RLS, 1 = missing RLS policies found

-- Create a temporary function to audit RLS policies
CREATE OR REPLACE FUNCTION audit_rls_policies()
RETURNS TABLE(
  table_name TEXT,
  rls_enabled BOOLEAN,
  policy_count INTEGER,
  status TEXT
) AS $$
DECLARE
  rec RECORD;
  missing_rls_count INTEGER := 0;
  total_tables INTEGER := 0;
BEGIN
  -- Get all tables in the public schema
  FOR rec IN 
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name NOT LIKE 'pg_%'
      AND t.table_name NOT LIKE 'sql_%'
    ORDER BY t.table_name
  LOOP
    total_tables := total_tables + 1;
    
    -- Check if RLS is enabled for this table
    SELECT 
      c.relrowsecurity as rls_enabled,
      COALESCE(p.policy_count, 0) as policy_count
    INTO 
      rls_enabled, 
      policy_count
    FROM pg_class c
    LEFT JOIN (
      SELECT 
        schemaname || '.' || tablename as full_table_name,
        COUNT(*) as policy_count
      FROM pg_policies 
      WHERE schemaname = 'public'
      GROUP BY schemaname, tablename
    ) p ON p.full_table_name = 'public.' || rec.table_name
    WHERE c.relname = rec.table_name
      AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
    
    -- Determine status
    IF NOT rls_enabled THEN
      status := 'MISSING_RLS';
      missing_rls_count := missing_rls_count + 1;
    ELSIF policy_count = 0 THEN
      status := 'NO_POLICIES';
      missing_rls_count := missing_rls_count + 1;
    ELSE
      status := 'OK';
    END IF;
    
    -- Return the row
    table_name := rec.table_name;
    RETURN NEXT;
  END LOOP;
  
  -- Log summary
  RAISE NOTICE 'RLS AUDIT SUMMARY:';
  RAISE NOTICE '  Total tables: %', total_tables;
  RAISE NOTICE '  Tables with issues: %', missing_rls_count;
  RAISE NOTICE '  Compliance rate: %%%', ROUND((total_tables - missing_rls_count)::NUMERIC / total_tables * 100, 1);
  
  -- If any tables are missing RLS, this will cause the script to fail
  IF missing_rls_count > 0 THEN
    RAISE EXCEPTION 'RLS AUDIT FAILED: % tables are missing RLS policies or have RLS disabled', missing_rls_count;
  END IF;
  
  RAISE NOTICE 'RLS AUDIT PASSED: All tables have RLS enabled with policies';
END;
$$ LANGUAGE plpgsql;

-- Execute the audit
SELECT * FROM audit_rls_policies();

-- Clean up
DROP FUNCTION audit_rls_policies();