/**
 * Per-principal aggregate daily cap (#1701).
 *
 * Caps otherwise apply per agent: a principal with 50 agents at 10 USDC each
 * could spend 500 USDC a day even when they meant 50 in total. This module
 * adds an optional principal-wide daily limit enforced at admission across
 * all agents that share one principal.
 *
 * Pure helper with no external dependencies so it is unit-testable anywhere.
 * Wired into `AgentConsoleService` (budget views + spend tracking) and the
 * gateway `checkCap` admission step (reject with a distinct error code).
 */

/** Distinct error code surfaced when the principal total would be exceeded. */
export const PRINCIPAL_DAILY_CAP_EXCEEDED = 'principal_daily_cap_exceeded';

export class PrincipalCapError extends Error {
  readonly code = PRINCIPAL_DAILY_CAP_EXCEEDED;

  constructor(
    public readonly principal: string,
    public readonly remainingUsdc: number,
    public readonly requiredUsdc: number,
  ) {
    super(
      `principal daily cap exceeded (${PRINCIPAL_DAILY_CAP_EXCEEDED}): ` +
        `remaining ${remainingUsdc.toFixed(2)} USDC, required ${requiredUsdc.toFixed(2)} USDC`,
    );
  }
}

function dayKeyUtc(nowMs: number): string {
  const date = new Date(nowMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function toCents(amountUsdc: number): number {
  return Math.round(amountUsdc * 100);
}

export class PrincipalAggregateCap {
  private readonly limits = new Map<string, number>();
  private readonly spend = new Map<string, { day: string; cents: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Set (or replace) the principal-wide daily limit in USDC. */
  setDailyLimit(principal: string, amountUsdc: number): void {
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0 || amountUsdc > 1_000_000) {
      throw new Error('principal daily limit must be greater than zero');
    }
    this.limits.set(principal, toCents(amountUsdc));
  }

  clearDailyLimit(principal: string): void {
    this.limits.delete(principal);
    this.spend.delete(principal);
  }

  clear(): void {
    this.limits.clear();
    this.spend.clear();
  }

  /** Remaining principal budget in USDC, or null when no limit is set. */
  remainingUsdc(principal: string): number | null {
    const limit = this.limits.get(principal);
    if (limit === undefined) return null;
    return (limit - this.spentToday(principal)) / 100;
  }

  /** Spent principal budget in USDC today, or null when no limit is set. */
  spentUsdc(principal: string): number | null {
    if (!this.limits.has(principal)) return null;
    return this.spentToday(principal) / 100;
  }

  limitUsdc(principal: string): number | null {
    const limit = this.limits.get(principal);
    return limit === undefined ? null : limit / 100;
  }

  /**
   * Admission check: throws `PrincipalCapError` (code
   * `principal_daily_cap_exceeded`) when this call would push the principal
   * total over its daily limit. No-ops when no limit is set.
   */
  checkAdmission(principal: string, amountUsdc: number): void {
    const limit = this.limits.get(principal);
    if (limit === undefined) return;
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return;
    const required = toCents(amountUsdc);
    const remaining = limit - this.spentToday(principal);
    if (required > remaining) {
      throw new PrincipalCapError(principal, remaining / 100, required / 100);
    }
  }

  /** Track spend against the principal total. No-ops when no limit is set. */
  recordSpend(principal: string, amountUsdc: number): void {
    if (!this.limits.has(principal)) return;
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return;
    const bucket = this.bucket(principal);
    bucket.cents += toCents(amountUsdc);
  }

  private bucket(principal: string): { day: string; cents: number } {
    const today = dayKeyUtc(this.now());
    const existing = this.spend.get(principal);
    if (existing && existing.day === today) return existing;
    const fresh = { day: today, cents: 0 };
    this.spend.set(principal, fresh);
    return fresh;
  }

  private spentToday(principal: string): number {
    return this.bucket(principal).cents;
  }
}

export const principalAggregateCap = new PrincipalAggregateCap();
