# RLS Policy Audit Scripts

This directory contains automated scripts to verify Row Level Security (RLS) policies across all database tables, preventing data leaks as outlined in Issue #14.

## Overview

The RLS audit system ensures that **EVERY** table in the public schema has:
1. Row Level Security enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)
2. At least one active policy defined (`CREATE POLICY ...`)

## Scripts

### 1. `check-rls-compliance.js`
**Primary audit script** - Node.js implementation for CI/CD integration.

```bash
# Run with environment variables
SUPABASE_URL=your_url SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/check-rls-compliance.js

# Or use npm scripts (from backend directory)
npm run audit:rls          # Uses env vars
npm run audit:rls:local    # Uses local Supabase instance
```

**Features:**
- ✅ Checks all tables in public schema using pg_policies system table
- ✅ Verifies RLS is enabled via pg_class.relrowsecurity
- ✅ Counts active policies per table from pg_policies
- ✅ Colored console output
- ✅ Detailed compliance report
- ✅ Exit code 1 if any issues found (fails CI)

### 2. `audit-rls-policies.sql`
**SQL-only version** for direct database execution.

```sql
-- Run directly in your database
\i scripts/audit-rls-policies.sql
```

**Features:**
- ✅ Pure SQL implementation
- ✅ Creates temporary audit function
- ✅ Comprehensive table analysis
- ✅ Raises exception if issues found

### 3. `audit-rls-policies.js`
**Advanced Node.js version** with fallback mechanisms.

```bash
node scripts/audit-rls-policies.js
```

**Features:**
- ✅ Multiple audit strategies
- ✅ Automatic fallback methods
- ✅ Detailed error handling
- ✅ Function creation and cleanup

## CI/CD Integration

### GitHub Workflows

#### 1. Dedicated RLS Audit (`.github/workflows/rls-audit.yml`)
Runs on:
- Push to main/develop branches
- PRs affecting migrations or audit scripts
- Changes to RLS audit workflow

```yaml
# Triggers RLS audit after migrations
- supabase/migrations/**
- backend/migrations/**
- scripts/check-rls-compliance.js
```

#### 2. Database Workflow Integration
The existing `database.yml` workflow now includes RLS auditing:

```yaml
- name: Run RLS Policy Audit
  run: node scripts/check-rls-compliance.js
```

### Local Development

```bash
# Start local Supabase
supabase start

# Apply migrations
supabase db push

# Run RLS audit
cd backend
npm run audit:rls:local
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin access | ✅ |

**Local Development:**
- URL: `http://localhost:54321`
- Service Key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (default local key)

## Expected Output

### ✅ Passing Audit
```
🔍 Starting RLS Compliance Check...
📊 Database: https://your-project.supabase.co

📋 RLS Compliance Report:
────────────────────────────────────────────────────────────────────────────────
Table Name                          RLS     Policies   Status
────────────────────────────────────────────────────────────────────────────────
audit_logs                          ✓       3          OK
idempotency_keys                     ✓       2          OK
profiles                             ✓       4          OK
subscriptions                        ✓       4          OK
teams                                ✓       5          OK
user_preferences                     ✓       3          OK

📊 Summary:
   Total tables: 6
   Tables with issues: 0
   Compliance rate: 100.0%

✅ RLS COMPLIANCE CHECK PASSED
   All tables have RLS enabled with policies
   Your database is protected against data leaks! 🔒
```

### ❌ Failing Audit
```
🔍 Starting RLS Compliance Check...
📊 Database: https://your-project.supabase.co

📋 RLS Compliance Report:
────────────────────────────────────────────────────────────────────────────────
Table Name                          RLS     Policies   Status
────────────────────────────────────────────────────────────────────────────────
audit_logs                          ✓       3          OK
new_table                            ✗       0          MISSING_RLS
subscriptions                        ✓       0          NO_POLICIES

📊 Summary:
   Total tables: 3
   Tables with issues: 2
   Compliance rate: 33.3%

❌ RLS Policy Issues Found:
   new_table: RLS is not enabled
   subscriptions: RLS enabled but no policies defined

🔧 To fix these issues:
   1. Enable RLS: ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
   2. Add policies: CREATE POLICY policy_name ON table_name FOR SELECT USING (...);
   3. Ensure all CRUD operations have appropriate policies

❌ RLS COMPLIANCE CHECK FAILED
   2 table(s) missing RLS policies
```

## Common RLS Policy Patterns

### User-Owned Data
```sql
-- Enable RLS
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

-- Policies for user-owned records
CREATE POLICY "user_data_select_own" ON user_data FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_data_insert_own" ON user_data FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_data_update_own" ON user_data FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_data_delete_own" ON user_data FOR DELETE USING (auth.uid() = user_id);
```

### Team-Based Access
```sql
-- Enable RLS
ALTER TABLE team_data ENABLE ROW LEVEL SECURITY;

-- Policy for team members
CREATE POLICY "team_data_member_access" ON team_data FOR ALL USING (
  EXISTS (
    SELECT 1 FROM team_members 
    WHERE team_members.team_id = team_data.team_id 
    AND team_members.user_id = auth.uid()
  )
);
```

### Admin Override
```sql
-- Policy with admin override
CREATE POLICY "data_select_own_or_admin" ON sensitive_data FOR SELECT USING (
  auth.uid() = user_id OR 
  auth.jwt() ->> 'is_admin' = 'true'
);
```

## Troubleshooting

### Script Fails to Connect
```bash
# Check environment variables
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY

# Test connection
curl -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     "$SUPABASE_URL/rest/v1/profiles?select=*&limit=1"
```

### Missing Dependencies
```bash
# Install required packages
cd backend
npm install @supabase/supabase-js
```

### Local Supabase Issues
```bash
# Reset local instance
supabase stop
supabase start

# Check status
supabase status
```

### CI/CD Failures
1. **Check secrets**: Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in GitHub secrets
2. **Verify permissions**: Service role key must have admin access
3. **Check migrations**: Ensure all migrations apply successfully before audit

## Security Considerations

### Service Role Key
- **Never commit** service role keys to version control
- Use GitHub secrets for CI/CD
- Rotate keys regularly
- Limit key permissions where possible

### Audit Scope
- Script only checks **public schema** tables
- Ignores system tables (`pg_%`, `sql_%`)
- Does not validate policy logic (only presence)

### Policy Quality
The audit verifies policies exist but doesn't validate:
- Policy correctness
- Security effectiveness  
- Performance impact
- Business logic compliance

## Integration with Development Workflow

### Pre-commit Hook (Optional)
```bash
# Add to .git/hooks/pre-commit
#!/bin/bash
cd backend
npm run audit:rls:local || {
  echo "❌ RLS audit failed - commit blocked"
  exit 1
}
```

### Migration Checklist
When creating new tables:
1. ✅ Create table
2. ✅ Enable RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
3. ✅ Add policies for SELECT, INSERT, UPDATE, DELETE
4. ✅ Test policies work correctly
5. ✅ Run RLS audit: `npm run audit:rls:local`
6. ✅ Commit migration

## Future Enhancements

- [ ] Policy logic validation
- [ ] Performance impact analysis
- [ ] Integration with schema documentation
- [ ] Automated policy generation
- [ ] Policy coverage reporting
- [ ] Security best practice validation

## Related Documentation

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [SYNCRO Security Architecture](../docs/SECURITY.md)
- [Database Migration Guide](../docs/MIGRATIONS.md)