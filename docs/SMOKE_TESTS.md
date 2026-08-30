# Post-Deployment Smoke Tests

## Overview

Smoke tests verify that critical functionality works after staging or production deployments. These tests run automatically via GitHub Actions after successful deployments and can also be triggered manually.

**Issue Reference:** #101 - Post-deploy smoke tests

## What Gets Tested

### 1. Authentication Flow
- ✅ User login with valid credentials
- ✅ Rejection of invalid credentials
- ✅ Session token validation
- ✅ JWT token retrieval and verification

### 2. Dashboard & Core Features
- ✅ User role retrieval
- ✅ Subscription list access
- ✅ Subscription pagination
- ✅ Authentication enforcement on protected routes

### 3. API Health
- ✅ Backend health endpoint (`/health`)
- ✅ Frontend health endpoint (`/api/health`)
- ✅ Swagger documentation availability
- ✅ Database connectivity

### 4. Payment & Billing
- ✅ Exchange rates API
- ✅ Gift card ledger access
- ✅ Reminder system status
- ✅ Billing cycle operations

### 5. Security
- ✅ Authentication enforcement
- ✅ API key authentication
- ✅ Row-level security (RLS) policies
- ✅ Protected endpoint access control

### 6. Integration Health
- ✅ Sentry configuration
- ✅ Stellar network connectivity
- ✅ Email service configuration
- ✅ Database connection pooling

## Setup

### 1. Create Smoke Test User

Before running smoke tests, you need to create a dedicated test user in each environment:

```bash
# Set environment variables
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export SMOKE_TEST_USER_EMAIL="smoke-test@syncro.test"
export SMOKE_TEST_USER_PASSWORD="SecurePassword123!"

# Run setup script
cd backend
npm run setup:smoke-user
```

This creates:
- A test user account
- A user profile
- A sample subscription for testing

### 2. Configure CI/CD Secrets

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

**Required:**
- `SMOKE_TEST_USER_EMAIL` - Email for smoke test user
- `SMOKE_TEST_USER_PASSWORD` - Password for smoke test user
- `BACKEND_URL` - Backend API URL (e.g., `https://api.syncro.app`)
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key

**Optional:**
- `SMOKE_TEST_API_KEY` - API key for testing API key authentication

**Already configured (from existing setup):**
- `SENTRY_DSN`
- `STELLAR_NETWORK_URL`
- `SOROBAN_CONTRACT_ADDRESS`
- `SMTP_HOST`
- `SMTP_USER`

## Running Smoke Tests

### Locally

```bash
cd backend

# Run smoke tests
npm run test:smoke

# Run with verbose output
npm run test:smoke:verbose

# Run specific test suite
npm run test:smoke -- --testNamePattern="Authentication"
```

**Environment variables for local testing:**

```bash
export SMOKE_TEST_BASE_URL="http://localhost:3001"
export SMOKE_TEST_FRONTEND_URL="http://localhost:3000"
export NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
export SMOKE_TEST_USER_EMAIL="smoke-test@syncro.test"
export SMOKE_TEST_USER_PASSWORD="your-password"
```

### In CI/CD

Smoke tests run automatically after successful deployments via the `post-deploy-health-check.yml` workflow.

**Manual trigger:**

1. Go to Actions → Post-Deploy Health Check
2. Click "Run workflow"
3. Select environment (staging/production)
4. Enter target URL
5. Click "Run workflow"

## Test Structure

```
backend/tests/smoke/
├── smoke-tests.test.ts      # Main smoke test suite
├── jest.smoke.config.js     # Jest configuration for smoke tests
└── setup.ts                 # Test environment setup
```

### Test Organization

Tests are organized into logical groups:

1. **Critical Path: Authentication** - Login and session management
2. **Critical Path: API Health** - Health endpoints and documentation
3. **Critical Path: Dashboard & Subscriptions** - Core user features
4. **Critical Path: Payment & Billing Health** - Financial operations
5. **Critical Path: Core API Operations** - Additional API endpoints
6. **Security & Rate Limiting** - Security controls
7. **Database Connectivity** - Database and RLS verification
8. **Integration Health Checks** - External service configuration

## Failure Handling

### Automatic Actions

**Preview/Staging Failures:**
- Comment added to PR with failure details
- Workflow run link provided
- Specific failed checks listed

**Production Failures:**
- GitHub issue created automatically
- Labeled as `bug`, `production`, `critical`
- Includes deployment URL and workflow run link
- Recommends immediate investigation and potential rollback

### Manual Response

When smoke tests fail:

1. **Check the workflow logs** for specific failure details
2. **Review the failed test** to understand what broke
3. **Verify the deployment** is actually accessible
4. **Check external dependencies** (Supabase, Stellar, etc.)
5. **Consider rollback** if critical paths are broken

## Maintenance

### Adding New Tests

1. Add test cases to `backend/tests/smoke/smoke-tests.test.ts`
2. Follow existing patterns for authentication and error handling
3. Use descriptive test names
4. Set appropriate timeouts (default: 10s per test)
5. Update this documentation

### Updating Test User

If you need to reset or update the smoke test user:

```bash
# Delete existing user (via Supabase dashboard or SQL)
# Then re-run setup
npm run setup:smoke-user
```

### Environment-Specific Configuration

Different environments may require different configurations:

**Staging:**
- Uses staging Supabase project
- Shorter timeouts acceptable
- More verbose logging

**Production:**
- Uses production Supabase project
- Stricter timeouts
- Minimal logging
- Higher failure severity

## Troubleshooting

### Common Issues

**"Missing required environment variables"**
- Ensure all required secrets are set in GitHub Actions
- Check `.env` file for local testing

**"Authentication failed"**
- Verify smoke test user exists in the environment
- Check password hasn't expired
- Confirm Supabase URL and keys are correct

**"Connection timeout"**
- Deployment may not be fully ready (increase wait time)
- Check if services are actually running
- Verify network connectivity

**"RLS policy test failed"**
- Expected behavior - RLS should prevent cross-user access
- If test passes when it shouldn't, RLS policies may be misconfigured

### Debug Mode

Run tests with verbose output:

```bash
VERBOSE=1 npm run test:smoke:verbose
```

This enables:
- Console logs during test execution
- Detailed request/response information
- Full error stack traces

## Best Practices

1. **Keep tests fast** - Smoke tests should complete in < 2 minutes
2. **Test critical paths only** - Not a replacement for comprehensive E2E tests
3. **Use dedicated test user** - Never use real user accounts
4. **Clean up after tests** - Tests should be idempotent
5. **Monitor test reliability** - Flaky tests should be fixed or removed
6. **Update on architecture changes** - Keep tests aligned with system changes

## Related Documentation

- [CI/CD Workflows](./branch-protection.md)
- [API Documentation](./api-reference/)
- [Security Audit Matrix](../SECURITY_AUDIT_MATRIX_API_ROUTES.md)
- [RLS Audit Guide](./RLS_AUDIT_GUIDE.md)

## Metrics & Monitoring

Track smoke test performance:
- **Success rate** - Should be > 99%
- **Execution time** - Should be < 2 minutes
- **Failure patterns** - Identify recurring issues
- **Environment differences** - Staging vs production behavior

## Support

For issues with smoke tests:
1. Check this documentation
2. Review workflow logs in GitHub Actions
3. Check Supabase logs for authentication issues
4. Contact DevOps team for infrastructure issues
