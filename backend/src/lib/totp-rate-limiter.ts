const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_FAILURES = 5; // Lock after 5 failed attempts
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout

interface FailureRecord {
  count: number;
  windowStart: number; // epoch ms
  lockedUntil?: number; // epoch ms
}

/**
 * In-memory rate limiter for TOTP verification attempts.
 * Prevents brute-force attacks by locking accounts after N failed attempts.
 * 
 * Security Features:
 * - Tracks failures per session/user
 * - Sliding time window (10 minutes)
 * - Automatic lockout after MAX_FAILURES attempts
 * - Lockout duration: 15 minutes
 * 
 * Note: This is in-memory and will reset on server restart.
 * For production, consider Redis-backed rate limiting.
 */
export class TotpRateLimiter {
  private records = new Map<string, FailureRecord>();

  /**
   * Check if a session/user is currently locked out.
   * @param sessionId - User or session identifier
   * @returns true if locked, false otherwise
   */
  isLocked(sessionId: string): boolean {
    const record = this.records.get(sessionId);
    if (!record?.lockedUntil) return false;
    
    const now = Date.now();
    if (now >= record.lockedUntil) {
      // Lockout expired, clean up
      this.records.delete(sessionId);
      return false;
    }
    
    return true;
  }

  /**
   * Record a failed TOTP verification attempt.
   * Implements sliding window and automatic lockout.
   * @param sessionId - User or session identifier
   */
  recordFailure(sessionId: string): void {
    const now = Date.now();
    const record = this.records.get(sessionId);

    if (!record || now - record.windowStart > WINDOW_MS) {
      // No record or window expired — start fresh
      this.records.set(sessionId, { count: 1, windowStart: now });
      return;
    }

    record.count += 1;

    if (record.count >= MAX_FAILURES) {
      record.lockedUntil = now + LOCKOUT_MS;
    }
  }

  /**
   * Reset failure count for a session (called on successful verification).
   * @param sessionId - User or session identifier
   */
  reset(sessionId: string): void {
    this.records.delete(sessionId);
  }

  /**
   * Get current failure count for a session.
   * Useful for logging and monitoring.
   * @param sessionId - User or session identifier
   * @returns current failure count
   */
  getFailureCount(sessionId: string): number {
    const record = this.records.get(sessionId);
    if (!record) return 0;
    
    const now = Date.now();
    if (now - record.windowStart > WINDOW_MS) {
      // Window expired
      this.records.delete(sessionId);
      return 0;
    }
    
    return record.count;
  }

  /**
   * Get remaining lockout time in milliseconds.
   * @param sessionId - User or session identifier
   * @returns milliseconds until unlock, or 0 if not locked
   */
  getRemainingLockoutMs(sessionId: string): number {
    const record = this.records.get(sessionId);
    if (!record?.lockedUntil) return 0;
    
    const remaining = record.lockedUntil - Date.now();
    return Math.max(0, remaining);
  }
}
