# TOTP Quick Reference Guide

## 🚀 Quick Start

### API Endpoints

#### Generate TOTP Secret
```bash
POST /api/2fa/totp/generate
Authorization: Bearer <token>
```

#### Verify TOTP Code
```bash
POST /api/2fa/totp/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "token": "123456",
  "secret": "JBSWY3DPEHPK3PXP"
}
```

## 🔒 Security Rules

### Single-Use Enforcement
- Each TOTP code works **once** within its 30-second window
- Replay attempts are **rejected** and logged
- Codes tracked via SHA-256 hash in database

### Rate Limiting
| Metric | Value |
|--------|-------|
| Max Failures | 5 attempts |
| Lockout Duration | 15 minutes |
| Tracking Window | 10 minutes |

### Clock Drift
- **±30 seconds** tolerance
- Prevents false rejections from time differences

## 📊 Response Codes

| Code | Meaning |
|------|---------|
| 200 | ✅ Valid code |
| 400 | ❌ Missing fields |
| 401 | ❌ Invalid/used code |
| 429 | 🔒 Locked out |
| 500 | ⚠️ Server error |

## 🔍 Security Events

| Event | Severity | Trigger |
|-------|----------|---------|
| `mfa.totp_verification_success` | info | Valid code |
| `mfa.totp_verification_failed` | medium | Invalid code |
| `mfa.failure_threshold_reached` | high | 5 failures |
| `mfa.totp_lockout_active` | high | Attempt while locked |
| `mfa.totp_secret_generated` | info | New secret |

## 🧪 Testing

### Run All Tests
```bash
npm test -- totp
```

### Run Specific Tests
```bash
npm test -- totp-verification.test.ts
npm test -- mfa-routes.test.ts
```

## 📈 Monitoring Queries

### Check Used Codes
```sql
SELECT user_id, COUNT(*) as codes_used
FROM totp_used_codes
WHERE used_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id
ORDER BY codes_used DESC;
```

### Find Locked Accounts
Check application logs for:
```
mfa.failure_threshold_reached
```

### Cleanup Old Records
```sql
SELECT cleanup_expired_totp_codes();
```

## 🛠️ Configuration

### Constants (in code)
```typescript
TOTP_WINDOW = 1        // ±30 seconds
TOTP_STEP = 30         // 30-second windows
MAX_FAILURES = 5       // Lockout threshold
LOCKOUT_MS = 900000    // 15 minutes
WINDOW_MS = 600000     // 10 minutes
```

### Environment Variables
```bash
# Optional rate limiting config
RATE_LIMIT_MFA_MAX=10
RATE_LIMIT_MFA_WINDOW_MINUTES=15
```

## 🐛 Troubleshooting

### "Invalid or already-used TOTP code"

**Possible causes:**
1. Code already used (replay)
2. Clock skew
3. Wrong secret
4. Expired code

**Solutions:**
1. Wait for next code (30 seconds)
2. Check system time
3. Verify secret matches
4. Use current code from authenticator

### "Too many failed attempts"

**Cause:** Rate limit lockout

**Solutions:**
1. Wait 15 minutes
2. Check logs for security events
3. Verify user isn't under attack

### Database Connection Errors

**Symptoms:** Verification always fails

**Solutions:**
1. Check Supabase connection
2. Verify migration ran
3. Check table exists: `totp_used_codes`

## 📚 Code Examples

### Service Usage
```typescript
import { totpService } from '../services/mfa-service';

// Generate secret
const { secret, otpauth_url } = totpService.generateSecret('user@example.com');

// Verify code
const isValid = await totpService.verify(userId, secret, token);

// Cleanup expired
await totpService.cleanupExpired(userId);
```

### Rate Limiter Usage
```typescript
import { TotpRateLimiter } from '../lib/totp-rate-limiter';

const limiter = new TotpRateLimiter();

// Check lockout
if (limiter.isLocked(sessionId)) {
  const remainingMs = limiter.getRemainingLockoutMs(sessionId);
  // Handle lockout
}

// Record failure
limiter.recordFailure(sessionId);

// Reset on success
limiter.reset(sessionId);
```

## 🔗 Related Documentation

- Full Implementation: `backend/TOTP_IMPLEMENTATION.md`
- Summary: `IMPLEMENTATION_SUMMARY_TOTP.md`
- Feature Overview: `TOTP_FEATURE_SUMMARY.md`

## 📞 Support

For issues:
1. Check security event logs
2. Verify database migration
3. Review rate limiter status
4. Test with known-good secret
