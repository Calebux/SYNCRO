# GitHub Secrets Verification Checklist - Issue #636

**Date**: May 27, 2026  
**Priority**: P0  
**Status**: Ready for Verification

## Overview

This checklist ensures all required secrets are properly configured in GitHub Actions for CI/CD pipelines.

## Access Instructions

1. Navigate to: `https://github.com/<org>/SYNCRO/settings/secrets/actions`
2. Verify each secret listed below is present
3. Check secret permissions and environment scoping

## Required Secrets

### Core Infrastructure

| Secret Name | Required | Environment | Description | Verification |
|-------------|----------|-------------|-------------|--------------|
| `SUPABASE_URL` | ✅ Yes | All | Supabase project URL | [ ] Set |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | All | Service role key for admin access | [ ] Set |
| `SUPABASE_ANON_KEY` | ✅ Yes | All | Anonymous key for client access | [ ] Set |
| `DATABASE_URL` | ⚠️ Optional | Production | Direct PostgreSQL connection (if not using Supabase) | [ ] Set / [ ] N/A |

### Authentication & Security

| Secret Name | Required | Environment | Description | Verification |
|-------------|----------|-------------|-------------|--------------|
| `JWT_SECRET` | ✅ Yes | All | JWT token signing key | [ ] Set |
| `ADMIN_API_KEY` | ✅ Yes | All | Admin endpoint protection | [ ] Set |
| `ENCRYPTION_KEY` | ✅ Yes | All | Data encryption key (32 bytes) | [ ] Set |

### Payment Processing

| Secret Name | Required | Environment | Description | Verification |
|-------------|----------|-------------|-------------|--------------|
| `STRIPE_SECRET_KEY` | ✅ Yes | All | Stripe API secret key | [ ] Set |
| `STRIPE_WEBHOOK_SECRET` | ✅ Yes | All | Stripe webhook signature verification | [ ] Set |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ Yes | All | Stripe publishable key (client-side) | [ ] Set |

### Email Integrations

| Secret Name | Required | Environment | Description | Verification |
|-------------|----------|-------------|-------------|--------------|
| `GOOGLE_CLIENT_ID` | ⚠️ Optional | All | Gmail OAuth client ID | [ ] Set / [ ] N/A |
| `GOOGLE_CLIENT_SECRET` | ⚠️ Optional | All | Gmail OAuth client secret | [ ] Set / [ ] N/A |
| `MICROSOFT_CLIENT_ID` | ⚠️ Optional | All | Outlook OAuth client ID | [ ] Set / [ ] N/A |
| `MICROSOFT_CLIENT_SECRET` | ⚠️ Optional | All | Outlook OAuth client secret | [ ] Set / [ ] N/A |
| `MICROSOFT_TENANT_ID` | ⚠️ Optional | All | Azure AD tenant ID | [ ] Set / [ ] N/A |

### Notifications

| Secret Name | Required | Environment | Description | Verification |
|-------------|----------|-------------|-------------|--------------|
| `TELEGRAM_BOT_TOKEN` | ⚠️ Optional | All | Telegram bot API token | [ ] Set / [ ] N/A |
| `VAPID_PUBLIC_KEY` | ⚠️ Optional | All | Push notification public key | [ ] Set / [ ] N/A |
| `VAPID_PRIVATE_KEY` | ⚠️ Optional | All | Push notification private key | [ ] Set / [ ] N/A |

### AI Services

| Secret Name | Required | Environment | Description | Verification |
|-------------|----------|-------------|-------------|--------------|
| `ANTHROPIC_API_KEY` | ⚠️ Optional | All | Claude API for classification | [ ] Set / [ ] N/A |
| `GEMINI_API_KEY` | ⚠️ Optional | All | Gemini API for fallback | [ ] Set / [ ] N/A |

### Monitoring & Error Tracking

| Secret Name | Required | Environment | Description | Verification |
|-------------|----------|-------------|-------------|--------------|
| `SENTRY_DSN` | ⚠️ Optional | All | Sentry error tracking DSN | [ ] Set / [ ] N/A |
| `SENTRY_AUTH_TOKEN` | ⚠️ Optional | All | Sentry API token | [ ] Set / [ ] N/A |
| `SENTRY_ORG` | ⚠️ Optional | All | Sentry organization slug | [ ] Set / [ ] N/A |
| `SENTRY_PROJECT` | ⚠️ Optional | All | Sentry project slug | [ ] Set / [ ] N/A |

### Infrastructure

| Secret Name | Required | Environment | Description | Verification |
|-------------|----------|-------------|-------------|--------------|
| `REDIS_URL` | ⚠️ Optional | All | Redis connection URL | [ ] Set / [ ] N/A |
| `RATE_LIMIT_REDIS_URL` | ⚠️ Optional | All | Redis for rate limiting | [ ] Set / [ ] N/A |

### Blockchain (Stellar/Soroban)

| Secret Name | Required | Environment | Description | Verification |
|-------------|----------|-------------|-------------|--------------|
| `SOROBAN_RPC_URL` | ⚠️ Optional | All | Soroban RPC endpoint | [ ] Set / [ ] N/A |
| `SOROBAN_CONTRACT_ADDRESS` | ⚠️ Optional | All | Deployed contract address | [ ] Set / [ ] N/A |
| `STELLAR_SECRET_KEY` | ⚠️ Optional | All | Stellar account secret key | [ ] Set / [ ] N/A |

## Environment-Specific Secrets

### Production Environment

**Additional Requirements**:
- [ ] All ✅ Yes secrets are set
- [ ] Production-grade values (not test keys)
- [ ] Secrets are different from staging
- [ ] Secrets are rotated regularly

### Staging Environment

**Additional Requirements**:
- [ ] All ✅ Yes secrets are set
- [ ] Test/staging values used
- [ ] Secrets are different from production
- [ ] Can use test API keys (e.g., `sk_test_*`)

### Development Environment

**Additional Requirements**:
- [ ] Local `.env` files used (not GitHub Secrets)
- [ ] Demo/test values acceptable
- [ ] Documented in `.env.example`

## Secret Validation

### Format Validation

| Secret Type | Expected Format | Example |
|-------------|----------------|---------|
| Supabase URL | `https://*.supabase.co` | `https://abc123.supabase.co` |
| Supabase Keys | JWT format (starts with `eyJ`) | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| JWT Secret | 32+ character random string | `a1b2c3d4e5f6...` (64 chars) |
| Stripe Secret | `sk_live_*` or `sk_test_*` | `sk_live_51H...` |
| Stripe Webhook | `whsec_*` | `whsec_abc123...` |
| Telegram Token | `<bot_id>:<token>` | `123456789:ABCdefGHIjklMNOpqrsTUVwxyz` |
| Encryption Key | 32 bytes (64 hex chars) | `a1b2c3d4e5f6...` (64 chars) |

### Security Validation

- [ ] No secrets contain placeholder text (e.g., `your_key_here`)
- [ ] No secrets are empty strings
- [ ] No secrets are duplicated across environments
- [ ] No test keys in production environment
- [ ] No production keys in test environment

## Secret Permissions

### Repository Secrets

**Access Level**: Available to all workflows

**Verification**:
- [ ] Secrets are repository-level (not organization-level)
- [ ] Secrets are accessible to all branches
- [ ] Secrets are not exposed in logs

### Environment Secrets

**Access Level**: Restricted to specific environments

**Verification**:
- [ ] Production secrets require approval
- [ ] Staging secrets accessible to staging environment
- [ ] Environment protection rules configured

## Workflow Usage Verification

### Check Workflow Files

Verify secrets are used correctly in workflows:

| Workflow | Secrets Used | Verification |
|----------|--------------|--------------|
| `.github/workflows/ci.yml` | `SUPABASE_*`, `STRIPE_*`, `JWT_SECRET` | [ ] Correct |
| `.github/workflows/database.yml` | `SUPABASE_SERVICE_ROLE_KEY` | [ ] Correct |
| `.github/workflows/rls-audit.yml` | `SUPABASE_SERVICE_ROLE_KEY` | [ ] Correct |
| `.github/workflows/test.yml` | Test secrets | [ ] Correct |
| `.github/workflows/staging-deploy.yml` | All staging secrets | [ ] Correct |

### Fallback Values

Verify fallback values for local CI:

```yaml
# ✅ Good: Falls back to demo token for local CI
SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY || 'eyJ...' }}

# ❌ Bad: No fallback, will fail in local CI
SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

**Verification**:
- [ ] Local CI workflows have demo token fallbacks
- [ ] Production workflows require real secrets
- [ ] Fallback values are clearly documented

## Testing Secret Configuration

### Manual Testing

1. **Trigger CI workflow**
   ```bash
   git push origin main
   ```

2. **Check workflow logs**
   - Verify no "secret not found" errors
   - Verify no authentication failures
   - Verify services connect successfully

3. **Test specific integrations**
   - Supabase connection
   - Stripe webhook verification
   - Email integration (if configured)
   - Telegram bot (if configured)

### Automated Testing

Run secret validation script:

```bash
# Check required secrets are set
npm run check:secrets

# Validate secret formats
npm run validate:secrets
```

## Common Issues

### Issue: Secret Not Found

**Symptoms**:
- Workflow fails with "secret not found"
- Environment variable is undefined

**Solutions**:
1. Verify secret name matches exactly (case-sensitive)
2. Check secret is set in correct environment
3. Verify workflow has access to secret

### Issue: Invalid Secret Format

**Symptoms**:
- Authentication fails
- API returns 401/403 errors

**Solutions**:
1. Verify secret format matches expected pattern
2. Check for extra whitespace or newlines
3. Regenerate secret if corrupted

### Issue: Secret Exposed in Logs

**Symptoms**:
- Secret value visible in workflow logs

**Solutions**:
1. Use `::add-mask::` to mask secret in logs
2. Avoid echoing secrets in scripts
3. Use GitHub's automatic secret masking

## Security Best Practices

### Secret Management

✅ **Do**:
- Use GitHub Secrets for all sensitive values
- Rotate secrets regularly (see SECRET_ROTATION_POLICY.md)
- Use different secrets for each environment
- Limit secret access to necessary workflows

❌ **Don't**:
- Hardcode secrets in workflow files
- Share secrets via insecure channels
- Use production secrets in test environments
- Commit secrets to version control

### Access Control

✅ **Do**:
- Require approval for production deployments
- Use environment protection rules
- Audit secret access regularly
- Revoke access when team members leave

❌ **Don't**:
- Give everyone access to production secrets
- Use organization-wide secrets for sensitive data
- Share secret values via Slack/email

## Completion Checklist

### Initial Setup
- [ ] All required secrets verified
- [ ] Secret formats validated
- [ ] Environment-specific secrets configured
- [ ] Workflow files updated

### Testing
- [ ] CI workflows pass
- [ ] Integration tests pass
- [ ] Manual testing completed
- [ ] No secrets exposed in logs

### Documentation
- [ ] Secret rotation policy reviewed
- [ ] Team notified of secret locations
- [ ] Runbook updated
- [ ] Emergency contacts documented

### Ongoing Maintenance
- [ ] Secret rotation schedule set
- [ ] Monitoring alerts configured
- [ ] Audit trail established
- [ ] Quarterly review scheduled

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Security Team Lead | | | |
| DevOps Lead | | | |
| Backend Lead | | | |

## Related Documentation

- [Secret Handling Audit Report](./SECRET_HANDLING_AUDIT_REPORT.md)
- [Secret Rotation Policy](./docs/SECRET_ROTATION_POLICY.md)
- [Secret Handling Action Items](./SECRET_HANDLING_ACTION_ITEMS.md)
- [Security Audit Matrix](./SECURITY_AUDIT_MATRIX_API_ROUTES.md)

## Support

For issues with GitHub Secrets:

1. Check this checklist
2. Review GitHub Actions documentation
3. Contact DevOps team via Slack (#devops)
4. Create support ticket for urgent issues

---

**Last Updated**: May 27, 2026  
**Next Review**: June 27, 2026 (Monthly)
