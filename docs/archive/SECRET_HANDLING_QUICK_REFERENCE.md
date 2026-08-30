# Secret Handling Quick Reference

**Last Updated**: May 27, 2026  
**For**: SYNCRO Development Team

## Quick Links

- 📋 [Full Audit Report](./SECRET_HANDLING_AUDIT_REPORT.md)
- 📝 [Action Items](./SECRET_HANDLING_ACTION_ITEMS.md)
- 🔄 [Rotation Policy](./docs/SECRET_ROTATION_POLICY.md)
- ✅ [GitHub Secrets Checklist](./GITHUB_SECRETS_CHECKLIST.md)

## TL;DR - Key Findings

✅ **Good News**:
- No production secrets in tracked files
- Strong secret provider architecture
- Comprehensive log masking
- Graceful degradation when secrets missing

⚠️ **Minor Issues Fixed**:
- Demo tokens now documented
- SDK placeholders clarified
- Rotation policy created

## Common Tasks

### Adding a New Secret

1. **Generate the secret**
   ```bash
   openssl rand -hex 32
   ```

2. **Add to .env.example**
   ```bash
   # Description of what this secret does
   NEW_SECRET_KEY=your_value_here
   ```

3. **Add to GitHub Secrets**
   - Go to repository settings → Secrets
   - Add secret for each environment

4. **Update validation**
   - Add to `backend/src/config/env.ts` (Zod schema)
   - Add to `backend/scripts/validate-env.js`

5. **Document rotation schedule**
   - Update `docs/SECRET_ROTATION_POLICY.md`

### Rotating a Secret

1. **Generate new value**
   ```bash
   openssl rand -hex 32
   ```

2. **Update in all locations**
   - GitHub Secrets
   - Production environment
   - Staging environment

3. **Deploy and verify**
   ```bash
   pm2 restart backend --update-env
   ```

4. **Revoke old secret** (after 24-48 hours)

5. **Document rotation**
   - Update `SECURITY_AUDIT_MATRIX_API_ROUTES.md`

### Checking for Leaked Secrets

```bash
# Search for potential secrets
git grep -i "secret\|password\|token\|api_key"

# Check for JWT tokens
git grep -E "eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+"

# Check for API keys
git grep -E "sk_|pk_|whsec_"
```

### Testing Secret Configuration

```bash
# Validate environment variables
npm run validate:env

# Check secret expiration
npm run check:secret-expiration

# Test secret provider
npm test -- secret-management.test.ts
```

## Secret Types Reference

| Type | Format | Example | Rotation |
|------|--------|---------|----------|
| JWT Secret | Random 32+ bytes | `a1b2c3...` | 90 days |
| Admin API Key | Random 32+ bytes | `a1b2c3...` | 90 days |
| Encryption Key | Random 32 bytes | `a1b2c3...` (64 hex) | 180 days |
| Stripe Secret | `sk_live_*` or `sk_test_*` | `sk_live_51H...` | On compromise |
| Stripe Webhook | `whsec_*` | `whsec_abc...` | On compromise |
| Telegram Token | `<bot_id>:<token>` | `123456:ABC...` | On compromise |
| Supabase Service | JWT (starts with `eyJ`) | `eyJhbGci...` | 90 days |

## Environment Variables Checklist

### Required (Backend)
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `JWT_SECRET`
- [ ] `ADMIN_API_KEY`
- [ ] `ENCRYPTION_KEY`
- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`

### Optional (Backend)
- [ ] `TELEGRAM_BOT_TOKEN`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `MICROSOFT_CLIENT_SECRET`
- [ ] `ANTHROPIC_API_KEY`
- [ ] `GEMINI_API_KEY`
- [ ] `REDIS_URL`

### Required (Client)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## Security Best Practices

### ✅ Do

- Use environment variables for all secrets
- Generate secrets with `openssl rand -hex 32`
- Use different secrets for each environment
- Rotate secrets regularly (see policy)
- Document all secrets in `.env.example`
- Use secret provider for retrieval
- Log secret access (not values)
- Mask secrets in logs

### ❌ Don't

- Hardcode secrets in code
- Commit secrets to version control
- Share secrets via Slack/email
- Use production secrets in tests
- Log secret values
- Pass secrets in URLs
- Store secrets in client-side code

## Emergency Procedures

### Secret Compromised

1. **Immediate**: Revoke compromised secret
2. **Generate**: New secret value
3. **Deploy**: Emergency deployment
4. **Verify**: Service functionality
5. **Document**: Incident report

### Service Down After Rotation

1. **Rollback**: Restore old secret
2. **Verify**: Service recovery
3. **Investigate**: Root cause
4. **Fix**: Identified issues
5. **Retry**: Rotation with fix

## Common Issues

### "Secret not found" in CI

**Solution**: Check GitHub Secrets are set

### "Authentication failed" after rotation

**Solution**: Clear cache, restart services

### "Invalid secret format"

**Solution**: Verify format, regenerate if needed

### Secret exposed in logs

**Solution**: Use `::add-mask::` in workflows

## Monitoring

### What to Monitor

- Secret access frequency
- Failed secret retrievals
- Secret expiration dates
- Unusual access patterns

### Alerts to Set Up

- High access rate (>100/min)
- Repeated failures (>10/min)
- Secret expiring soon (14 days)
- Unauthorized access attempts

## Testing

### Unit Tests

```bash
# Test secret provider
npm test -- secret-management.test.ts

# Test log masking
npm test -- logger.test.ts
```

### Integration Tests

```bash
# Test with real secrets (staging)
npm run test:integration

# Test secret rotation
npm run test:rotation
```

## Documentation

### Where to Find Information

| Topic | Document |
|-------|----------|
| Audit findings | `SECRET_HANDLING_AUDIT_REPORT.md` |
| Implementation tasks | `SECRET_HANDLING_ACTION_ITEMS.md` |
| Rotation procedures | `docs/SECRET_ROTATION_POLICY.md` |
| GitHub secrets | `GITHUB_SECRETS_CHECKLIST.md` |
| Quick reference | This document |

### When to Update

- Adding new secret type
- Changing rotation schedule
- After security incident
- Quarterly review

## Support

### Who to Contact

| Issue | Contact |
|-------|---------|
| Secret rotation | Security Team (#security) |
| GitHub secrets | DevOps Team (#devops) |
| Secret provider | Backend Team (#backend) |
| Emergency | On-call engineer (PagerDuty) |

### Escalation Path

1. Check this quick reference
2. Review full documentation
3. Contact relevant team
4. Escalate to security lead
5. Create incident ticket

## Useful Commands

```bash
# Generate random secret
openssl rand -hex 32

# Generate database password
openssl rand -base64 24 | tr -d "=+/" | cut -c1-24

# Check environment variables
env | grep -i secret

# Validate .env file
npm run validate:env

# Test secret provider
npm test -- secret-management

# Check for leaked secrets
git grep -i "secret\|password\|token"

# Restart with new secrets
pm2 restart backend --update-env
```

## Rotation Schedule

| Secret | Frequency | Next Due |
|--------|-----------|----------|
| JWT_SECRET | 90 days | TBD |
| ADMIN_API_KEY | 90 days | TBD |
| ENCRYPTION_KEY | 180 days | TBD |
| SUPABASE_SERVICE_ROLE_KEY | 90 days | TBD |
| Database Credentials | 90 days | TBD |

## Compliance

### SOC 2
- Secrets rotated annually ✅
- Rotation documented ✅
- Access logged ✅

### PCI DSS
- Encryption keys rotated annually ✅
- Key rotation documented ✅
- Old keys destroyed ✅

### GDPR
- PII encryption keys rotated ✅
- Key access logged ✅
- Data re-encrypted ✅

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-05-27 | Initial quick reference |

---

**Need More Details?** See the full documentation linked at the top of this page.

**Questions?** Contact the Security Team via Slack (#security)
