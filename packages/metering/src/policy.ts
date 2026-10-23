/**
 * Overage policy and the grace path for metering caps.
 *
 * A cap that rejects at exactly 100% fails an agent mid-workflow with no
 * warning; a cap that allows unlimited overage is not a cap. This module
 * defines the behaviour in between:
 *
 *  - Warning thresholds fire *before* the cap binds and are surfaced to the
 *    principal (not only logged).
 *  - A bounded, auditable grace allowance may be granted by an explicit
 *    authorizer and is repaid from subsequent usage.
 *  - Rejections are actionable: how much was available, what was needed, and
 *    how to raise the limit.
 *  - The grace path can never be extended indefinitely by repeated requests:
 *    it is bounded per period and by a one-time grant flag.
 */

export type Principal = string;

/** A single warning threshold, expressed as a fraction of the limit. */
export interface WarningThreshold {
  /** Fraction of the limit at which the warning fires, e.g. 0.8 for 80%. */
  fraction: number;
  /** Stable identifier so consumers can dedupe / route the warning. */
  id: string;
  /** Human-readable message surfaced to the principal. */
  message: string;
}

/** Default thresholds that fire before the cap binds. */
export const DEFAULT_WARNING_THRESHOLDS: readonly WarningThreshold[] = [
  { fraction: 0.8, id: 'approaching-cap', message: 'Approaching metering cap (80% used).' },
  { fraction: 0.95, id: 'near-cap', message: 'Near metering cap (95% used).' },
];

/** A warning surfaced to the principal. */
export interface OverageWarning {
  principal: Principal;
  thresholdId: string;
  message: string;
  /** Amount already consumed. */
  used: number;
  /** The configured limit. */
  limit: number;
  /** Remaining headroom before the cap binds (never negative). */
  remaining: number;
}

/**
 * A bounded grace allowance. It is granted by an explicit authorizer, is
 * repaid from subsequent usage, and cannot be extended indefinitely.
 */
export interface GraceAllowance {
  /** Amount of overage permitted beyond the limit. */
  amount: number;
  /** Who authorized the grace allowance. */
  authorizedBy: Principal;
  /** Period the allowance applies to (e.g. '2024-06'). */
  period: string;
  /** Amount already repaid from subsequent usage. */
  repaid: number;
  /**
   * Whether this allowance has already been granted once for the period.
   * A one-time grant prevents repeated requests from extending it forever.
   */
  oneTime: boolean;
}

/** Result of evaluating a metering request against the policy. */
export type PolicyDecision =
  | { kind: 'allow'; warnings: OverageWarning[] }
  | { kind: 'allow-with-grace'; warnings: OverageWarning[]; grace: GraceAllowance }
  | { kind: 'reject'; warnings: OverageWarning[]; rejection: Rejection };

/** Actionable rejection surfaced to the principal. */
export interface Rejection {
  principal: Principal;
  /** Amount that was available (limit + any usable grace, minus used). */
  available: number;
  /** Amount that was needed for the request. */
  needed: number;
  /** The configured limit. */
  limit: number;
  /** How to raise the limit. */
  remedy: string;
  message: string;
}

/**
 * Tracks grace allowances per principal and period so the grace path stays
 * bounded and auditable. A principal may hold at most one one-time allowance
 * per period; further requests are rejected rather than silently extended.
 */
export class GraceLedger {
  private readonly grants = new Map<string, GraceAllowance>();

  private key(principal: Principal, period: string): string {
    return `${principal}\u0000${period}`;
  }

  /** Returns the existing allowance for the period, if any. */
  get(principal: Principal, period: string): GraceAllowance | undefined {
    return this.grants.get(this.key(principal, period));
  }

  /**
   * Grants a one-time grace allowance. Returns undefined if an allowance has
   * already been granted for this principal and period, which prevents the
   * grace path from being extended indefinitely by repeated requests.
   */
  grant(
    principal: Principal,
    period: string,
    amount: number,
    authorizedBy: Principal,
  ): GraceAllowance | undefined {
    const key = this.key(principal, period);
    if (this.grants.has(key)) {
      return undefined;
    }
    const allowance: GraceAllowance = {
      amount,
      authorizedBy,
      period,
      repaid: 0,
      oneTime: true,
    };
    this.grants.set(key, allowance);
    return allowance;
  }

  /**
   * Repays a grace allowance from subsequent usage. Repayment is capped at the
   * granted amount so the ledger stays auditable.
   */
  repay(principal: Principal, period: string, amount: number): GraceAllowance | undefined {
    const allowance = this.get(principal, period);
    if (!allowance) {
      return undefined;
    }
    allowance.repaid = Math.min(allowance.amount, allowance.repaid + Math.max(0, amount));
    return allowance;
  }

  /** Remaining, un-repaid grace available for the period. */
  remaining(principal: Principal, period: string): number {
    const allowance = this.get(principal, period);
    if (!allowance) {
      return 0;
    }
    return Math.max(0, allowance.amount - allowance.repaid);
  }
}

/** Options for evaluating a metering request. */
export interface EvaluateOptions {
  principal: Principal;
  /** Amount already consumed in the period. */
  used: number;
  /** The configured limit. */
  limit: number;
  /** Amount requested by this operation. */
  requested: number;
  /** Period identifier, e.g. '2024-06'. */
  period: string;
  /** Warning thresholds; defaults to DEFAULT_WARNING_THRESHOLDS. */
  thresholds?: readonly WarningThreshold[];
  /** Ledger holding bounded grace allowances. */
  ledger?: GraceLedger;
  /** How to raise the limit, included in rejections. */
  remedy?: string;
}

function buildWarnings(
  principal: Principal,
  used: number,
  limit: number,
  thresholds: readonly WarningThreshold[],
): OverageWarning[] {
  const remaining = Math.max(0, limit - used);
  const warnings: OverageWarning[] = [];
  for (const threshold of thresholds) {
    if (used >= limit * threshold.fraction) {
      warnings.push({
        principal,
        thresholdId: threshold.id,
        message: threshold.message,
        used,
        limit,
        remaining,
      });
    }
  }
  return warnings;
}

/**
 * Evaluates a metering request against the overage policy.
 *
 * Warnings are always surfaced to the principal. If the request exceeds the
 * limit, a bounded grace allowance may cover the overage; otherwise the
 * request is rejected with an actionable message.
 */
export function evaluateOverage(options: EvaluateOptions): PolicyDecision {
  const {
    principal,
    used,
    limit,
    requested,
    period,
    thresholds = DEFAULT_WARNING_THRESHOLDS,
    ledger,
    remedy = 'Raise the metering limit for this principal or wait for the next period.',
  } = options;

  const warnings = buildWarnings(principal, used, limit, thresholds);
  const projected = used + requested;

  if (projected <= limit) {
    return { kind: 'allow', warnings };
  }

  const overage = projected - limit;
  const graceRemaining = ledger ? ledger.remaining(principal, period) : 0;

  if (ledger && graceRemaining >= overage) {
    const grace = ledger.get(principal, period);
    if (grace) {
      return { kind: 'allow-with-grace', warnings, grace };
    }
  }

  const available = Math.max(0, limit + graceRemaining - used);
  const rejection: Rejection = {
    principal,
    available,
    needed: requested,
    limit,
    remedy,
    message:
      `Metering cap exceeded for ${principal}: ${available} available, ` +
      `${requested} needed (limit ${limit}, used ${used}). ${remedy}`,
  };

  return { kind: 'reject', warnings, rejection };
}
