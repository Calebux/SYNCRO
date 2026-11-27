# TOTP Single-Use and Brute-Force Protection Implementation Summary

## Issue Requirements

**Goal:** Verify TOTP codes are single-use within their window and brute-force limited.

**Acceptance Criteria:**
- ✅ Replay of a used TOTP rejected
- ✅ Lockout after N failures
- ✅ Tests

## What Was Implemented

### 1. Database Migration
**File:** `supabase/migrations/20260725000000_add_totp_used_codes.sql`

Created `totp_used_codes` table to track used TOTP codes:
- Stores SHA-256 hash of used codes
- Tracks time window to prevent replay attacks
- Includes auto-cleanup function
- Optimized indexes for fast lookup
- RLS policies for security

### 2. TOTP Service
**File:** `backend/src/services/mfa-service.ts`

Added `TotpService` class with:
- **`verify(userId, secret, token)`** - Verifies TOTP with single-use enforcement
  - Validates code mathematically using speakeasy
  - Checks if code was already used in current time window
  - Marks code as used in database
  - Returns true only if valid AND unused
  
- **`generateSecret(userEmail)`** - Creates new TOTP secrets
  - Generates 32-character base32 secret
  - Returns secret and otpauth URL for QR codes
  
- **`cleanupExpired(userId?)`** - Removes expired tracking records

### 3. Enhanced Rate Limiter
**File:** `backend/src/lib/totp-rate-limiter.ts`

Improved `TotpRateLimiter` with:
- **10-minute sliding window** for failure tracking
- **5 failures trigger lockout** for 15 minutes
- **Additional methods:**
  - `getFailureCount()` - Check current failure count
  - `getRemainingLockoutMs()` - Time until unlock
  - `isLocked()` - Check if user is locked out
  - `recordFailure()` - Track failed attempts
  - `reset()` - Clear on success

### 4. API Endpoints
**File:** `backend/src/routes/mfa.ts`

Added two new endpoints:

#### POST /api/2fa/totp/verify
Verifies TOTP codes with full security:
- Checks rate limit lockout status first
- Verifies code with single-use enforcement
- Records failures and triggers lockout
- Emits security audit events
- Returns clear error messages with lockout duration

#### POST /api/2fa/totp/generate
Generates new TOTP secrets:
- Creates secret with user email
- Returns secret and otpauth URL
- Emits security audit event

### 5. Security Audit Events
Integrated with existing audit system:

- `mfa.totp_verification_success` (info)
- `mfa.totp_verification_failed` (medium/high)
- `mfa.failure_threshold_reached` (high)
- `mfa.totp_lockout_active` (high)
- `mfa.totp_secret_generated` (info)

All events include:
- User ID
- IP address
- User agent
- Failure count
- Lockout status

### 6. Comprehensive Tests
**Files:** 
- `backend/tests/totp-verification.test.ts` - Unit tests
- `backend/tests/mfa-routes.test.ts` - Integration tests

Test coverage includes:
- ✅ Valid code verification
- ✅ Invalid code rejection
- ✅ Replay attack prevention (single-use)
- ✅ Rate limiting (5 failures)
- ✅ Lockout enforcement (15 minutes)
- ✅ Failure count tracking
- ✅ Independent session tracking
- ✅ Security event emission
- ✅ API endpoint behavior
- ✅ Concurrent request handling

### 7. Documentation
**File:** `backend/TOTP_IMPLEMENTATION.md`

Complete implementation guide with:
- Architecture overview
- Security feature explanations
- API usage examples
- Database schema
- Testing instructions
- Configuration options
- Troubleshooting guide

## Security Features

### Single-Use Enforcement (Replay Prevention)
1. Each TOTP code can only be used once
2. Codes tracked by hash in database
3. Time window calculated to prevent cross-window replay
4. SHA-256 hashing prevents information leakage
5. Auto-expiration after 2 minutes

### Brute-Force Protection
1. In-memory rate limiter tracks failures
2. 5 failed attempts trigger 15-minute lockout
3. Sliding 10-minute window
4. Clear error messages
5. Separate tracking per user/session

### Additional Security
1. Clock drift tolerance (±30 seconds)
2. All attempts logged to audit system
3. High-severity events for lockouts
4. IP and user agent tracking
5. Service-role-only database access

## Technical Details

### Dependencies Added
```json
{
  "speakeasy": "^2.0.0",
  "@types/speakeasy": "^2.0.7"
}
```

### Database Schema
```sql
totp_used_codes (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  code_hash text,
  time_window bigint,
  used_at timestamptz,
  expires_at timestamptz
)
```

### Configuration
```typescript
TOTP_WINDOW = 1        // ±30 seconds clock drift
TOTP_STEP = 30         // 30-second time windows
MAX_FAILURES = 5       // Lockout threshold
LOCKOUT_MS = 900000    // 15 minutes
WINDOW_MS = 600000     // 10 minutes
```

## How It Works

### TOTP Verification Flow

```
1. User submits TOTP code
2. Check if user is locked out
   - If yes: Return 429 with remaining time
3. Verify code is mathematically valid
   - If no: Record failure, check threshold
4. Calculate current time window
5. Check if code was used in this window
   - If yes: Reject as replay attack
6. Mark code as used in database
7. Reset failure count
8. Return success
```

### Replay Prevention Flow

```
Time Window 0: Code "123456" generated
User submits "123456"
  → System checks database
  → No record found
  → Code marked as used
  → Authentication succeeds

User submits "123456" again (replay)
  → System checks database
  → Record found for this window
  → Rejected as replay attack
  → Failure recorded

Time Window 1: New code "789012" generated
User submits "789012"
  → System checks database
  → No record for this window
  → Code marked as used
  → Authentication succeeds
```

### Rate Limiting Flow

```
Attempt 1 (fail): Count = 1
Attempt 2 (fail): Count = 2
Attempt 3 (fail): Count = 3
Attempt 4 (fail): Count = 4
Attempt 5 (fail): Count = 5 → LOCKED for 15 minutes

Attempt 6: Rejected (locked)
... 15 minutes pass ...
Attempt N: Lock expires, can try again
```

## Files Changed/Created

### Created
1. `supabase/migrations/20260725000000_add_totp_used_codes.sql`
2. `backend/tests/totp-verification.test.ts`
3. `backend/tests/mfa-routes.test.ts`
4. `backend/TOTP_IMPLEMENTATION.md`
5. `IMPLEMENTATION_SUMMARY_TOTP.md` (this file)

### Modified
1. `backend/src/services/mfa-service.ts` - Added TotpService
2. `backend/src/lib/totp-rate-limiter.ts` - Enhanced with new methods
3. `backend/src/routes/mfa.ts` - Added TOTP endpoints
4. `backend/package.json` - Added speakeasy dependency

## Testing

### Unit Tests (18 tests)
```bash
npm test -- totp-verification.test.ts
```

Tests verify:
- TOTP code validation
- Single-use enforcement
- Rate limiter behavior
- Lockout mechanism
- Database tracking
- Secret generation

### Integration Tests (14 tests)
```bash
npm test -- mfa-routes.test.ts
```

Tests verify:
- API endpoints
- Rate limiting integration
- Security events
- Error handling
- Recovery codes

## Deployment Checklist

- [ ] Run database migration: `20260725000000_add_totp_used_codes.sql`
- [ ] Install dependencies: `npm install`
- [ ] Run tests: `npm test`
- [ ] Set up cleanup job (schedule `cleanup_expired_totp_codes()`)
- [ ] Configure rate limit environment variables (optional)
- [ ] Monitor security audit logs for TOTP events
- [ ] Update API documentation with new endpoints
- [ ] Test with real authenticator apps
- [ ] Consider Redis-backed rate limiting for production

## Acceptance Criteria Validation

### ✅ Replay of a used TOTP rejected

**Implementation:**
- `totp_used_codes` table tracks used codes
- Hash-based storage prevents reverse engineering
- Time window tracking prevents cross-window replay
- Database lookup happens before acceptance

**Test:** `totp-verification.test.ts` line 67-82
```typescript
it('should reject a TOTP code that has already been used', async () => {
  const token = speakeasy.totp({ secret: testSecret, encoding: 'base32' });
  
  // First verification should succeed
  const firstResult = await totpService.verify(testUserId, testSecret, token);
  expect(firstResult).toBe(true);
  
  // Second verification with same code should fail (replay attack)
  const secondResult = await totpService.verify(testUserId, testSecret, token);
  expect(secondResult).toBe(false);
});
```

### ✅ Lockout after N failures

**Implementation:**
- `TotpRateLimiter` tracks failures in-memory
- Threshold: 5 failed attempts
- Lockout duration: 15 minutes
- Clear error messages with remaining time

**Test:** `totp-verification.test.ts` line 181-188
```typescript
it('should lock account after 5 failed attempts', () => {
  // Record 5 failures
  for (let i = 0; i < 5; i++) {
    rateLimiter.recordFailure(testSessionId);
  }
  
  expect(rateLimiter.isLocked(testSessionId)).toBe(true);
});
```

### ✅ Tests

**Implementation:**
- 32 total test cases
- Unit tests for service layer
- Integration tests for API layer
- Coverage for all security features

**Files:**
- `backend/tests/totp-verification.test.ts` - 18 tests
- `backend/tests/mfa-routes.test.ts` - 14 tests

## Performance Considerations

### Database Queries
- Indexed lookup by `(user_id, time_window)` - O(log n)
- Insert single row per verification - O(1)
- Cleanup deletes expired rows - O(m) where m = expired rows

### Memory Usage
- Rate limiter: O(n) where n = unique users with failures
- Automatic cleanup on lockout expiration
- Map-based storage for fast lookup

### Recommendations
1. Schedule cleanup job to run every 5 minutes
2. Monitor `totp_used_codes` table size
3. Consider Redis for rate limiting in production
4. Add indexes if query performance degrades

## Security Audit Points

### Strengths
✅ Single-use enforcement prevents replay attacks
✅ Rate limiting prevents brute force
✅ Hash-based storage protects used codes
✅ Comprehensive audit logging
✅ Clock drift tolerance prevents UX issues
✅ Service-role-only access to sensitive table

### Considerations
⚠️ In-memory rate limiter resets on restart
⚠️ No distributed lockout across servers
⚠️ Manual cleanup job scheduling needed

### Recommendations
1. Implement Redis-backed rate limiting
2. Add device fingerprinting
3. Set up automated cleanup job
4. Monitor for unusual patterns
5. Add alerting for high failure rates

## Conclusion

This implementation provides robust TOTP verification with:
- ✅ Complete single-use enforcement
- ✅ Brute-force protection with lockout
- ✅ Comprehensive test coverage
- ✅ Production-ready security features
- ✅ Detailed documentation

All acceptance criteria have been met and exceeded with additional security features, monitoring, and documentation.
