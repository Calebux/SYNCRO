# Smoke Tests

Post-deployment smoke tests for SYNCRO. These tests verify critical functionality after staging or production deployments.

## Purpose

Smoke tests ensure that after a deployment:
- Users can log in ✅
- Dashboard loads and displays data ✅
- API endpoints respond correctly ✅
- Payment/billing systems are operational ✅
- Security controls are enforced ✅

## Quick Start

```bash
# From backend directory
npm run test:smoke
```

## Files

- **smoke-tests.test.ts** - Main test suite covering all critical paths
- **jest.smoke.config.js** - Jest configuration optimized for smoke tests
- **setup.ts** - Environment validation and test setup
- **README.md** - This file

## Test Coverage

### Authentication (Critical Path)
- User login with valid credentials
- Invalid credential rejection
- Session token validation

### Dashboard (Critical Path)
- User role retrieval
- Subscription list access
- Pagination functionality

### API Health (Critical Path)
- Backend `/health` endpoint
- Frontend `/api/health` endpoint
- Swagger documentation

### Payment & Billing (Critical Path)
- Exchange rates API
- Gift card ledger
- Reminder system status

### Security
- Authentication enforcement
- API key validation
- RLS policy verification

## Configuration

### Environment Variables

```bash
# Required
SMOKE_TEST_BASE_URL=http://localhost:3001
SMOKE_TEST_FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SMOKE_TEST_USER_EMAIL=smoke-test@syncro.test
SMOKE_TEST_USER_PASSWORD=SecurePassword123!

# Optional
SMOKE_TEST_API_KEY=your-api-key
VERBOSE=1  # Enable verbose logging
```

### Test User Setup

Before running smoke tests, create a dedicated test user:

```bash
cd backend
npm run setup:smoke-user
```

This creates a test user with:
- Email: `smoke-test@syncro.test`
- Role: `member`
- Sample subscription for testing

## Running Tests

### All Tests
```bash
npm run test:smoke
```

### Verbose Mode
```bash
npm run test:smoke:verbose
```

### Specific Test Suite
```bash
npm run test:smoke -- --testNamePattern="Authentication"
```

### Watch Mode (Development)
```bash
npm run test:smoke -- --watch
```

## CI/CD Integration

Smoke tests run automatically via `.github/workflows/post-deploy-health-check.yml` after:
- Staging deployments
- Production deployments

Manual trigger available via GitHub Actions UI.

## Test Characteristics

- **Fast**: Complete in < 2 minutes
- **Focused**: Test critical paths only
- **Reliable**: Minimal flakiness
- **Sequential**: Run one at a time (maxWorkers: 1)
- **Fail-fast**: Stop on first failure (bail: true)

## Failure Handling

When tests fail:

1. **Check workflow logs** for specific errors
2. **Verify deployment** is accessible
3. **Review failed test** details
4. **Check external services** (Supabase, etc.)
5. **Consider rollback** if critical

### Automatic Actions

**Staging Failures:**
- PR comment with details
- Workflow run link

**Production Failures:**
- GitHub issue created
- Labeled `critical`, `production`
- Immediate investigation required

## Adding New Tests

1. Add test to `smoke-tests.test.ts`
2. Follow existing patterns
3. Use descriptive names
4. Set appropriate timeouts
5. Update documentation

Example:

```typescript
describe('New Feature', () => {
  it('should verify new critical path', async () => {
    const response = await request(BASE_URL)
      .get('/api/new-endpoint')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveProperty('data');
  }, 10000); // 10 second timeout
});
```

## Best Practices

✅ **DO:**
- Test critical user journeys
- Use dedicated test user
- Keep tests fast (< 10s each)
- Clean up test data
- Handle timeouts gracefully

❌ **DON'T:**
- Test implementation details
- Use real user accounts
- Create flaky tests
- Test non-critical features
- Ignore test failures

## Troubleshooting

### "Missing required environment variables"
→ Set all required env vars (see Configuration section)

### "Authentication failed"
→ Run `npm run setup:smoke-user` to create test user

### "Connection timeout"
→ Check if services are running and accessible

### "RLS policy test failed"
→ This is expected - RLS should block unauthorized access

## Documentation

- [Full Documentation](../../../docs/SMOKE_TESTS.md)
- [Quick Reference](../../../docs/SMOKE_TESTS_QUICK_REFERENCE.md)
- [CI/CD Workflows](../../../docs/branch-protection.md)

## Support

For issues:
1. Check this README
2. Review full documentation
3. Check GitHub Actions logs
4. Contact DevOps team

---

**Issue Reference:** #101 - Post-deploy smoke tests
