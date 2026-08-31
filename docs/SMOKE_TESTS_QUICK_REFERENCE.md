# Smoke Tests - Quick Reference

## 🚀 Quick Start

### Run Locally
```bash
cd backend
npm run test:smoke
```

### Setup Test User (One-time per environment)
```bash
export SUPABASE_URL="your-url"
export SUPABASE_SERVICE_ROLE_KEY="your-key"
export SMOKE_TEST_USER_EMAIL="smoke-test@syncro.test"
export SMOKE_TEST_USER_PASSWORD="SecurePassword123!"
npm run setup:smoke-user
```

## 📋 Required Secrets (GitHub Actions)

| Secret | Description | Example |
|--------|-------------|---------|
| `SMOKE_TEST_USER_EMAIL` | Test user email | `smoke-test@syncro.test` |
| `SMOKE_TEST_USER_PASSWORD` | Test user password | `SecurePassword123!` |
| `BACKEND_URL` | Backend API URL | `https://api.syncro.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | `eyJhbG...` |

## ✅ What's Tested

- ✅ Login flow
- ✅ Dashboard access
- ✅ Subscription list
- ✅ API health endpoints
- ✅ Payment/billing APIs
- ✅ Security & authentication
- ✅ Database connectivity

## 🔧 Common Commands

```bash
# Run all smoke tests
npm run test:smoke

# Run with verbose output
npm run test:smoke:verbose

# Run specific test
npm run test:smoke -- --testNamePattern="Authentication"

# Setup smoke test user
npm run setup:smoke-user
```

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Missing env vars | Check GitHub secrets or local `.env` |
| Auth failed | Verify test user exists, run `setup:smoke-user` |
| Timeout | Increase wait time or check service status |
| RLS test failed | Expected - RLS should block cross-user access |

## 📊 Success Criteria

- All tests pass ✅
- Execution time < 2 minutes ⏱️
- No authentication errors 🔐
- All critical paths verified 🛣️

## 🚨 When Tests Fail

**Staging:**
- PR comment added with details
- Review workflow logs
- Fix before merging

**Production:**
- GitHub issue created automatically
- Labeled `critical`, `production`
- **Consider rollback immediately**

## 📖 Full Documentation

See [SMOKE_TESTS.md](./SMOKE_TESTS.md) for complete details.

## 🔗 Related

- [CI/CD Workflows](./branch-protection.md)
- [API Security](../SECURITY_AUDIT_MATRIX_API_ROUTES.md)
- [RLS Audit](./RLS_AUDIT_GUIDE.md)
