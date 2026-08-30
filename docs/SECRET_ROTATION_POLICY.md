# Secret Rotation Policy

**Version**: 1.0  
**Last Updated**: May 27, 2026  
**Owner**: Security Team  
**Review Frequency**: Quarterly

## Overview

This document defines the secret rotation policy for the SYNCRO platform. Regular secret rotation is a critical security practice that limits the impact of compromised credentials and ensures compliance with security best practices.

## Rotation Schedule

| Secret Type | Rotation Frequency | Owner | Critical | Notes |
|-------------|-------------------|-------|----------|-------|
| `JWT_SECRET` | Every 90 days | Backend Team | ✅ Yes | Requires user re-authentication |
| `ADMIN_API_KEY` | Every 90 days | Security Team | ✅ Yes | Protects admin endpoints |
| `ENCRYPTION_KEY` | Every 180 days | Security Team | ✅ Yes | Requires data re-encryption migration |
| `STRIPE_SECRET_KEY` | On compromise only | Finance Team | ✅ Yes | Managed by Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | On compromise only | Finance Team | ✅ Yes | Managed by Stripe dashboard |
| `TELEGRAM_BOT_TOKEN` | On compromise only | Backend Team | ⚠️ Medium | Managed by BotFather |
| `GOOGLE_CLIENT_SECRET` | On compromise only | Backend Team | ⚠️ Medium | Managed by Google Cloud Console |
| `MICROSOFT_CLIENT_SECRET` | On compromise only | Backend Team | ⚠️ Medium | Managed by Azure Portal |
| `SUPABASE_SERVICE_ROLE_KEY` | Every 90 days | DevOps Team | ✅ Yes | Full database access |
| `SUPABASE_ANON_KEY` | Every 180 days | DevOps Team | ⚠️ Medium | Public-facing key with RLS |
| Database Credentials | Every 90 days | DevOps Team | ✅ Yes | Coordinate with deployments |
| `VAPID_PRIVATE_KEY` | On compromise only | Backend Team | ⚠️ Medium | Push notification signing |
| `ANTHROPIC_API_KEY` | On compromise only | Backend Team | ⚠️ Medium | AI classification service |
| `GEMINI_API_KEY` | On compromise only | Backend Team | ⚠️ Medium | AI fallback service |
| `SENTRY_AUTH_TOKEN` | Every 180 days | DevOps Team | ⚠️ Medium | Error tracking |

## Rotation Procedures

### Standard Rotation (Scheduled)

**Timeline**: 2-3 business days

#### Phase 1: Preparation (Day 1)
1. **Schedule rotation window**
   - Notify team via Slack/email
   - Schedule during low-traffic period
   - Prepare rollback plan

2. **Generate new secret**
   ```bash
   # For random secrets (JWT_SECRET, ADMIN_API_KEY, ENCRYPTION_KEY)
   openssl rand -hex 32
   
   # For database passwords
   openssl rand -base64 24 | tr -d "=+/" | cut -c1-24
   ```

3. **Update secret in secret manager**
   - GitHub Secrets (for CI/CD)
   - AWS Secrets Manager (if using)
   - Environment variables (production servers)

#### Phase 2: Deployment (Day 2)
1. **Deploy updated configuration**
   ```bash
   # Update environment variables
   export NEW_SECRET="<new_value>"
   
   # Restart services with new secret
   pm2 restart backend
   ```

2. **Verify service functionality**
   - Check health endpoints
   - Monitor error logs
   - Test critical flows
   - Verify authentication works

3. **Monitor for issues**
   - Watch error rates
   - Check user reports
   - Monitor authentication failures

#### Phase 3: Cleanup (Day 3)
1. **Grace period** (24-48 hours)
   - Keep old secret active for rollback
   - Monitor for any issues

2. **Revoke old secret**
   - Remove from secret manager
   - Clear from environment variables
   - Update documentation

3. **Document rotation**
   - Update `SECURITY_AUDIT_MATRIX_API_ROUTES.md`
   - Record rotation date
   - Note any issues encountered

### Emergency Rotation (Compromise Detected)

**Timeline**: Immediate (within 1 hour)

#### Immediate Actions (0-15 minutes)
1. **Assess impact**
   - Identify compromised secret
   - Determine exposure scope
   - Check for unauthorized access

2. **Revoke compromised secret**
   ```bash
   # Immediately disable old secret
   # This may cause service disruption
   ```

3. **Generate new secret**
   ```bash
   openssl rand -hex 32
   ```

#### Emergency Deployment (15-30 minutes)
1. **Update secret in all environments**
   - Production
   - Staging
   - CI/CD

2. **Emergency deployment**
   ```bash
   # Deploy with new secret immediately
   git pull origin main
   pm2 restart backend --update-env
   ```

3. **Verify service recovery**
   - Check health endpoints
   - Monitor error logs
   - Test authentication

#### Post-Incident (30-60 minutes)
1. **Incident report**
   - Document compromise details
   - Timeline of events
   - Impact assessment

2. **Security review**
   - How was secret compromised?
   - What systems were affected?
   - What data was accessed?

3. **Post-mortem**
   - Root cause analysis
   - Preventive measures
   - Update security procedures

## Secret-Specific Procedures

### JWT_SECRET Rotation

**Impact**: All users must re-authenticate

**Procedure**:
1. Generate new JWT_SECRET
2. Deploy new secret to all servers
3. Old JWTs become invalid immediately
4. Users redirected to login page
5. Monitor authentication success rate

**Communication**:
- Notify users via email (optional)
- Display "Session expired" message
- Provide clear re-login instructions

### ADMIN_API_KEY Rotation

**Impact**: Admin endpoints temporarily unavailable

**Procedure**:
1. Generate new ADMIN_API_KEY
2. Update in GitHub Secrets
3. Update in production environment
4. Update in monitoring tools
5. Test admin endpoints

**Critical**: This key protects `/api/admin/*` and `/api/risk-score/recalculate`

### ENCRYPTION_KEY Rotation

**Impact**: Requires data re-encryption migration

**Procedure**:
1. Generate new ENCRYPTION_KEY
2. Create migration script to re-encrypt data
3. Run migration in maintenance window
4. Verify all data re-encrypted
5. Deploy new key
6. Remove old key

**Warning**: This is a complex operation requiring careful planning

### Database Credentials Rotation

**Impact**: Brief database connection interruption

**Procedure**:
1. Create new database user with same permissions
2. Update connection strings in all services
3. Deploy updated configuration
4. Verify database connectivity
5. Remove old database user

**Coordination**: Requires DevOps and Backend team coordination

### Third-Party Service Keys

**Stripe, Google, Microsoft, Telegram**

**Procedure**:
1. Generate new key in service dashboard
2. Update in secret manager
3. Deploy updated configuration
4. Test integration
5. Revoke old key in service dashboard

**Note**: These are managed by external services

## Automation

### Rotation Reminders

**Script**: `scripts/check-secret-expiration.js`

```bash
# Run weekly in CI
npm run check:secret-expiration
```

**Alerts**:
- 30 days before expiration: Warning
- 14 days before expiration: Alert
- 7 days before expiration: Critical alert
- Expired: CI fails

### Rotation Tracking

**File**: `SECURITY_AUDIT_MATRIX_API_ROUTES.md`

**Format**:
```markdown
## Rotation History
- **2026-05-27**: JWT_SECRET rotated (scheduled)
- **2026-05-15**: ADMIN_API_KEY rotated (scheduled)
- **2026-04-28**: STRIPE_SECRET_KEY rotated (compromise - issue #501)
```

## Monitoring and Alerting

### Secret Access Monitoring

**Metrics to Track**:
- Secret access frequency
- Failed secret retrievals
- Unusual access patterns
- Secret expiration dates

**Alerts**:
- High secret access rate (>100/min)
- Repeated failed retrievals (>10/min)
- Secret expiration approaching
- Unauthorized access attempts

### Secret Health Checks

**Daily Checks**:
- All required secrets present
- No expired secrets
- Secret rotation schedule on track
- No hardcoded secrets in code

## Compliance and Auditing

### Audit Trail

**Required Information**:
- Secret name (not value)
- Rotation date and time
- Person who performed rotation
- Reason for rotation (scheduled/emergency)
- Any issues encountered

### Compliance Requirements

**SOC 2**:
- Secrets rotated at least annually
- Rotation documented and auditable
- Access to secrets logged

**PCI DSS** (if applicable):
- Encryption keys rotated at least annually
- Key rotation documented
- Old keys securely destroyed

**GDPR**:
- Encryption keys for PII rotated regularly
- Key access logged and auditable
- Data re-encrypted with new keys

## Best Practices

### Secret Generation

✅ **Do**:
- Use cryptographically secure random generators
- Use sufficient length (32+ bytes for keys)
- Use different secrets for different environments
- Store secrets in secret manager, not code

❌ **Don't**:
- Use predictable patterns
- Reuse secrets across environments
- Store secrets in version control
- Share secrets via insecure channels

### Secret Storage

✅ **Do**:
- Use environment variables
- Use secret management services (AWS Secrets Manager, Vault)
- Encrypt secrets at rest
- Limit access to secrets

❌ **Don't**:
- Hardcode secrets in code
- Store secrets in configuration files
- Commit secrets to version control
- Share secrets via email/Slack

### Secret Usage

✅ **Do**:
- Use secrets only when necessary
- Log secret access (not values)
- Implement secret caching with TTL
- Use least-privilege access

❌ **Don't**:
- Log secret values
- Pass secrets in URLs
- Store secrets in client-side code
- Use secrets in error messages

## Troubleshooting

### Common Issues

**Issue**: Service fails after rotation
- **Cause**: Old secret still cached
- **Solution**: Clear cache, restart services

**Issue**: Users can't authenticate after JWT rotation
- **Cause**: Expected behavior
- **Solution**: Users must re-login

**Issue**: Database connection fails after rotation
- **Cause**: Connection pool using old credentials
- **Solution**: Restart application to refresh pool

**Issue**: Third-party integration broken after rotation
- **Cause**: Old key not revoked in service dashboard
- **Solution**: Verify new key active in service dashboard

### Rollback Procedure

If rotation causes critical issues:

1. **Immediate rollback**
   ```bash
   # Restore old secret
   export SECRET_NAME="<old_value>"
   pm2 restart backend --update-env
   ```

2. **Verify service recovery**
   - Check health endpoints
   - Monitor error logs
   - Test critical flows

3. **Investigate issue**
   - Review logs
   - Identify root cause
   - Plan corrective action

4. **Retry rotation**
   - Fix identified issues
   - Schedule new rotation window
   - Communicate with team

## Related Documentation

- [Secret Handling Audit Report](../SECRET_HANDLING_AUDIT_REPORT.md)
- [Secret Handling Action Items](../SECRET_HANDLING_ACTION_ITEMS.md)
- [Security Audit Matrix](../SECURITY_AUDIT_MATRIX_API_ROUTES.md)
- [RLS Audit Guide](./RLS_AUDIT_GUIDE.md)

## Support

For questions or issues with secret rotation:

1. Check this policy document
2. Review troubleshooting section
3. Contact Security Team via Slack (#security)
4. Create incident ticket for emergencies

## Changelog

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-05-27 | Initial policy created | Security Team |

---

**Next Review**: August 27, 2026 (Quarterly)
