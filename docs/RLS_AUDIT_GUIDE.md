# RLS Audit System Guide

## Overview

The RLS (Row Level Security) Audit System is an automated security measure that prevents data leaks by ensuring every database table has proper access controls.

**Context**: Issue #14 - Leak prevention  
**Goal**: CI fails if a new table is added without RLS policies

## Quick Start

### 1. Run Local Audit
```bash
cd backend
npm run audit:rls:local
```

### 2. Run Against Production
```bash
cd backend
SUPABASE_URL=your_url SUPABASE_SERVICE_ROLE_KEY=your_key npm run audit:rls
```

### 3. Test the Audit System
```bash
cd backend
npm run test:rls-audit
```

## How It Works

### Automated Checks
The audit system verifies that **every table** in the public schema has:

1. **RLS Enabled**: `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;`
2. **Active Policies**: At least one `CREATE POLICY` statement

### CI Integration
- ✅ Runs automatically on every migration
- ✅ Blocks PRs if RLS policies are missing
- ✅ Validates both local and production databases
- ✅ Provides detailed compliance reports

### What Gets Checked
```sql
-- ✅ This table will PASS the audit
CREATE TABLE user_data (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  data TEXT
);

ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_data_select_own" 
  ON user_data FOR SELECT 
  USING (auth.uid() = user_id);
```

```sql
-- ❌ This table will FAIL the audit
CREATE TABLE bad_table (
  id UUID PRIMARY KEY,
  sensitive_data TEXT
);
-- Missing: RLS enablement and policies
```

## Creating RLS-Compliant Tables

### Step 1: Create Table
```sql
CREATE TABLE my_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Step 2: Enable RLS
```sql
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
```

### Step 3: Add Policies
```sql
-- SELECT: Users can read their own data
CREATE POLICY "my_table_select_own"
  ON my_table FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: Users can create their own data
CREATE POLICY "my_table_insert_own"
  ON my_table FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can modify their own data
CREATE POLICY "my_table_update_own"
  ON my_table FOR UPDATE
  USING (auth.uid() = user_id);

-- DELETE: Users can delete their own data
CREATE POLICY "my_table_delete_own"
  ON my_table FOR DELETE
  USING (auth.uid() = user_id);
```

### Step 4: Test Locally
```bash
supabase db push
npm run audit:rls:local
```

## Common Policy Patterns

### User-Owned Data
```sql
-- Standard user ownership pattern
CREATE POLICY "table_select_own" ON table_name FOR SELECT 
  USING (auth.uid() = user_id);
```

### Team-Based Access
```sql
-- Team member access
CREATE POLICY "table_team_access" ON table_name FOR ALL USING (
  EXISTS (
    SELECT 1 FROM team_members 
    WHERE team_members.team_id = table_name.team_id 
    AND team_members.user_id = auth.uid()
  )
);
```

### Admin Override
```sql
-- Admin can access everything
CREATE POLICY "table_admin_access" ON table_name FOR ALL USING (
  auth.uid() = user_id OR 
  auth.jwt() ->> 'is_admin' = 'true'
);
```

### Public Read, Private Write
```sql
-- Anyone can read, only owner can write
CREATE POLICY "table_public_read" ON table_name FOR SELECT 
  USING (true);

CREATE POLICY "table_owner_write" ON table_name FOR INSERT 
  WITH CHECK (auth.uid() = user_id);
```

## Troubleshooting

### Audit Fails: "RLS is not enabled"
```sql
-- Fix: Enable RLS on the table
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
```

### Audit Fails: "RLS enabled but no policies defined"
```sql
-- Fix: Add at least one policy
CREATE POLICY "your_table_policy" ON your_table FOR SELECT 
  USING (auth.uid() = user_id);
```

### Audit Fails: "Database connection error"
```bash
# Check environment variables
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY

# Test connection manually
curl -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     "$SUPABASE_URL/rest/v1/profiles?select=*&limit=1"
```

### Local Supabase Issues
```bash
# Reset and restart
supabase stop
supabase start

# Check status
supabase status
```

## Development Workflow

### Before Creating a Migration
1. Plan your table structure
2. Identify who should access what data
3. Design appropriate RLS policies

### Creating the Migration
```sql
-- 1. Create table
CREATE TABLE ...;

-- 2. Enable RLS
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;

-- 3. Add policies
CREATE POLICY ...;
```

### After Creating the Migration
```bash
# Apply migration
supabase db push

# Run audit
npm run audit:rls:local

# If audit passes, commit
git add .
git commit -m "Add new table with RLS policies"
```

### CI/CD Process
1. Push migration to GitHub
2. CI runs database workflow
3. Migrations are applied
4. RLS audit runs automatically
5. If audit fails, CI fails and blocks merge
6. Fix RLS issues and push again

## Security Best Practices

### Policy Design
- ✅ **Principle of least privilege**: Only grant necessary access
- ✅ **Defense in depth**: Use multiple security layers
- ✅ **Explicit policies**: Be specific about what's allowed
- ❌ **Avoid overly broad policies**: Don't use `USING (true)` unless necessary

### Testing Policies
```sql
-- Test as different users
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user-id-here"}';

-- Try to access data
SELECT * FROM your_table;
```

### Performance Considerations
- Add indexes on columns used in policies
- Keep policy logic simple
- Test policy performance with realistic data volumes

## Monitoring and Maintenance

### Regular Audits
```bash
# Run weekly production audits
npm run audit:rls

# Check compliance trends
git log --oneline scripts/check-rls-compliance.js
```

### Policy Reviews
- Review policies during code reviews
- Update policies when business logic changes
- Document policy decisions in migration comments

### Security Updates
- Monitor Supabase security advisories
- Update RLS patterns based on new threats
- Regular security assessments

## Advanced Usage

### Custom Audit Rules
Modify `check-rls-compliance.js` to add custom checks:
- Policy naming conventions
- Required policy types
- Performance thresholds

### Integration with Other Tools
- Add to pre-commit hooks
- Integrate with security scanners
- Export compliance reports

### Automated Fixes
Create scripts to automatically:
- Enable RLS on new tables
- Generate standard policies
- Fix common policy issues

## Related Documentation

- [Supabase RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [SYNCRO Security Architecture](./SECURITY.md)
- [Database Migration Guide](./MIGRATIONS.md)

## Support

If you encounter issues with the RLS audit system:

1. Check the [troubleshooting section](#troubleshooting)
2. Review the [scripts README](../scripts/README.md)
3. Run the test script: `npm run test:rls-audit`
4. Check GitHub Actions logs for CI failures
5. Create an issue with detailed error messages