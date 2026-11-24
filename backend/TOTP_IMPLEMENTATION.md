# TOTP Implementation with Single-Use Enforcement and Brute-Force Protection

## Overview

This implementation provides secure TOTP (Time-based One-Time Password) verification with the following security features:

1. **Single-use enforcement** - TOTP codes can only be used once within their time window (replay attack prevention)
2. **Brute-force protection** - Rate limiting with automatic lockout after N failed attempts
3. **Security audit logging** - All verification attempts are logged for security monitoring
4. **Clock drift tolerance** - Allows ±30 seconds to account for client/server time differences

## Implementation Files

### Core Services

- **`src/services/mfa-service.ts`** - TOTP service with verification and secret generation
  - `TotpService.verify()` - Verifies TOTP codes with single-use enforcement
  - `TotpService.generateSecret()` - Generates new TOTP secrets for users
  - `TotpService.cleanupExpired()` - Removes expired used codes from database

- **`src/lib/totp-rate-limiter.ts`** - In-memory rate limiter for brute-force protection
  - Tracks failed attempts per user/session
  - Implements sliding time window (10 minutes)
  - Automatic lockout after 5 failed attempts (15 minute lockout)

### API Endpoints

- **`src/routes/mfa.ts`** - MFA API routes
  - `POST /api/2fa/totp/verify` - Verify a TOTP code
  - `POST /api/2fa/totp/generate` - Generate a new TOTP secret
  - `POST /api/2fa/recovery-codes/generate` - Generate recovery codes
  - `POST /api/2fa/recovery-codes/verify` - Verify a recovery code

### Database

- **`supabase/migrations/20260725000000_add_totp_used_codes.sql`** - Database migration
  - Creates `totp_used_codes` table for tracking used codes
  - Includes indexes for efficient lookup
  - Auto-cleanup function for expired records

### Tests

- **`tests/totp-verification.test.ts`** - Unit tests for TOTP service and rate limiter
- **`tests/mfa-routes.test.ts`** - Integration tests for MFA API endpoints

## Security Features

### 1. Single-Use Enforcement (Replay Prevention)

Each TOTP code is tracked in the database after successful verification. The same code cannot be used twice within its time window.

**How it works:**
1. User submits TOTP code
2. System verifies code is mathematically valid
3. System calculates the 30-second time window
4. System checks if code was already used in this window
5. If not used, marks code as used and allows authentication
6. If already used, rejects as replay attack

**Database tracking:**
- Stores SHA-256 hash of `{userId}:{token}:{timeWindow}`
- Tracks time window to prevent replay across boundaries
- Auto-expires after 2 minutes (4 time windows)

### 2. Brute-Force Protection

In-memory rate limiter prevents attackers from guessing TOTP codes.

**Configuration:**
- **Window:** 10 minutes sliding window
- **Max Failures:** 5 attempts
- **Lockout Duration:** 15 minutes

**Behavior:**
1. Tracks failed attempts per user/session
2. Resets counter on successful verification
3. After 5 failures, locks account for 15 minutes
4. Returns clear error messages with remaining lockout time

### 3. Security Audit Logging

All TOTP operations emit security events for monitoring:

- `mfa.totp_verification_success` (info) - Successful verification
- `mfa.totp_verification_failed` (medium) - Failed verification
- `mfa.failure_threshold_reached` (high) - Account locked due to failures
- `mfa.totp_lockout_active` (high) - Verification attempted while locked
- `mfa.totp_secret_generated` (info) - New secret generated

Events include:
- User ID
- IP address
- User agent
- Timestamp
- Failure count and lockout status

### 4. Clock Drift Tolerance

TOTP codes are valid for ±30 seconds (1 window before/after) to account for:
- Client/server clock differences
- Network latency
- User typing speed

**Configuration:**
```typescript
const TOTP_WINDOW = 1; // Allow 1 step before/after
const TOTP_STEP = 30; // 30-second time windows
```

## API Usage

### Generate TOTP Secret

```bash
POST /api/2fa/totp/generate
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "secret": "JBSWY3DPEHPK3PXP",
    "otpauth_url": "otpauth://totp/Syncro%20(user@example.com)?secret=JBSWY3DPEHPK3PXP&issuer=Syncro"
  }
}
```

The `otpauth_url` can be encoded as a QR code for users to scan with authenticator apps.

### Verify TOTP Code

```bash
POST /api/2fa/totp/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "token": "123456",
  "secret": "JBSWY3DPEHPK3PXP"
}

Response (success):
{
  "success": true
}

Response (invalid code):
{
  "success": false,
  "error": "Invalid or already-used TOTP code"
}

Response (locked out):
{
  "success": false,
  "error": "Too many failed attempts. Account locked for 15 minute(s)."
}
```

## Database Schema

### totp_used_codes Table

```sql
create table public.totp_used_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null,        -- SHA-256 hash
  time_window bigint not null,      -- Unix timestamp / 30
  used_at     timestamptz not null default now(),
  expires_at  timestamptz not null  -- Auto-cleanup after 2 minutes
);

create index totp_used_codes_user_window_idx on public.totp_used_codes(user_id, time_window);
create index totp_used_codes_expires_at_idx on public.totp_used_codes(expires_at);
```

### Cleanup Function

```sql
create or replace function public.cleanup_expired_totp_codes()
returns void
language plpgsql
security definer
as $$
begin
  delete from public.totp_used_codes
  where expires_at < now();
end;
$$;
```

Schedule this to run periodically (recommended: every 5 minutes).

## Testing

### Run Unit Tests

```bash
npm test -- totp-verification.test.ts
```

Tests cover:
- Valid TOTP code verification
- Invalid code rejection
- Replay attack prevention
- Rate limiting and lockout
- Failure count tracking
- Secret generation

### Run Integration Tests

```bash
npm test -- mfa-routes.test.ts
```

Tests cover:
- API endpoint functionality
- Rate limiting integration
- Security event emission
- Recovery code verification

### Manual Testing

1. Generate a TOTP secret:
```bash
curl -X POST http://localhost:3000/api/2fa/totp/generate \
  -H "Authorization: Bearer <token>"
```

2. Add secret to authenticator app (Google Authenticator, Authy, etc.)

3. Verify a code:
```bash
curl -X POST http://localhost:3000/api/2fa/totp/verify \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"token": "123456", "secret": "JBSWY3DPEHPK3PXP"}'
```

4. Try to reuse the same code (should fail)

5. Make 5 failed attempts (should trigger lockout)

## Acceptance Criteria

✅ **Replay of a used TOTP rejected**
- TOTP codes are tracked in database after use
- Same code cannot be verified twice within its time window
- Hash-based tracking prevents information leakage

✅ **Lockout after N failures**
- Account locks after 5 failed verification attempts
- Lockout lasts 15 minutes
- Clear error messages indicate remaining lockout time
- Lockout applies per user/session

✅ **Tests**
- Comprehensive unit tests for TOTP service
- Comprehensive unit tests for rate limiter
- Integration tests for API endpoints
- Tests cover replay prevention, rate limiting, and lockout

## Configuration

Environment variables (optional):

```bash
# Rate limiting (from rate-limit-factory)
RATE_LIMIT_MFA_MAX=10                    # Max requests per window
RATE_LIMIT_MFA_WINDOW_MINUTES=15         # Rate limit window

# TOTP settings (in code constants)
TOTP_WINDOW=1                            # Clock drift tolerance (±30s)
TOTP_STEP=30                             # Time window size (seconds)
MAX_FAILURES=5                           # Lockout threshold
LOCKOUT_MS=900000                        # Lockout duration (15 minutes)
```

## Security Considerations

### Why In-Memory Rate Limiting?

The current implementation uses in-memory rate limiting which:
- ✅ Simple and fast
- ✅ No external dependencies
- ❌ Resets on server restart
- ❌ Doesn't work across multiple servers

**For production**, consider:
- Redis-backed rate limiting (already used elsewhere in the app)
- Shared state across server instances
- Persistent lockout state

### Why SHA-256 Hash?

Used codes are stored as hashes to:
- Prevent information leakage if database is compromised
- Make it impossible to reverse-engineer valid codes
- Protect against timing attacks

### Why 2-Minute Expiration?

Used codes expire after 2 minutes because:
- TOTP codes are valid for 30 seconds (base window)
- Clock drift allows ±30 seconds (3 windows total: before, current, after)
- 2 minutes (4 windows) provides buffer for cleanup

### Why Service Role Only?

The `totp_used_codes` table uses service role access because:
- Security-sensitive data
- Should not be directly accessible to users
- Prevents bypassing single-use enforcement
- All access goes through verified backend code

## Dependencies

- **speakeasy** - TOTP generation and verification
- **crypto** - SHA-256 hashing for used code tracking
- **@supabase/supabase-js** - Database access
- **express** - HTTP routing

## Future Enhancements

1. **Redis-backed rate limiting** - Share state across servers
2. **Automatic cleanup job** - Schedule `cleanup_expired_totp_codes()`
3. **Device fingerprinting** - Track devices for additional security
4. **Backup codes rotation** - Auto-generate new recovery codes
5. **WebAuthn support** - Add hardware key authentication
6. **SMS fallback** - Alternative 2FA method
7. **Trusted devices** - Remember devices for N days
8. **Admin dashboard** - View lockout status and security events

## Troubleshooting

### "Too many failed attempts" immediately

**Cause:** Rate limiter is locked
**Solution:** Wait 15 minutes or restart server (dev only)

### "Failed to check TOTP used codes"

**Cause:** Database connection issue
**Solution:** Check Supabase connection and migration status

### "Invalid or already-used TOTP code" on first try

**Possible causes:**
1. Clock skew between client and server (check system time)
2. Wrong secret being used
3. Code from previous time window

### Tests failing with connection errors

**Cause:** Tests require Supabase connection
**Solution:** Mock Supabase client in tests or use test database

## Support

For issues or questions:
1. Check security event logs for detailed error information
2. Review rate limiter status with `getRemainingLockoutMs()`
3. Verify database migration ran successfully
4. Check Supabase connection and credentials

## License

Part of the Syncro project.
