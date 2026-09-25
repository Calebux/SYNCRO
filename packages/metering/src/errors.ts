/**
 * Metering error types and overage policy.
 *
 * Issue #1450: overage policy and the grace path.
 *
 * A cap that rejects at exactly 100% fails an agent mid-workflow with no
 * warning. A cap that allows unlimited overage is not a cap. This module
 * defines the behaviour in between:
 *
 *  - Warning thresholds fire *before* the cap binds and are surfaced to the
 *    principal (not only logged).
 *  - A configurable, bounded grace allowance may exist. It is authorized by
 *    the principal and repaid from the next period's budget.
 *  - Rejections are actionable: how much was available, what was needed, and
 *    how to raise the limit.
 *  - The grace path can never be extended indefinitely by repeated requests:
 *    it is a one-time allowance per period.
 */

/** A single warning threshold, expressed as a fraction of the limit. */
export interface OverageWarningThreshold {
  /** Fraction of the limit at which the warning fires, e.g. 0.8 for 80%. */
  fraction: number;
  /** Human-readable label surfaced to the principal. */
  label: string;
}

/**
 * Default warning thresholds. These fire before the cap binds so the
 * principal has a chance to raise the limit or authorize grace.
 */
export const DEFAULT_WARNING_THRESHOLDS: readonly OverageWarningThreshold[] = [
  { fraction: 0.8, label: "approaching limit" },
  { fraction: 0.95, label: "limit nearly exhausted" },
];

/**
 * Overage policy configuration.
 *
 * `graceAllowance` is the maximum overage that may be granted beyond the
 * limit. It is `0` by default: no grace unless explicitly configured. When
 * non-zero, grace must be authorized by the principal and is repaid from the
 * next period's budget.
 */
export interface OveragePolicy {
  /** The hard limit, in the same unit as usage. */
  limit: number;
  /** Maximum overage that may be granted. Defaults to 0 (no grace). */
  graceAllowance?: number;
  /** Warning thresholds. Defaults to DEFAULT_WARNING_THRESHOLDS. */
  warningThresholds?: readonly OverageWarningThreshold[];
}

/** A warning surfaced to the principal before the cap binds. */
export interface OverageWarning {
  /** The threshold that fired. */
  threshold: OverageWarningThreshold;
  /** Usage at the time the warning fired. */
  usage: number;
  /** The configured limit. */
  limit: number;
  /** Remaining budget before the cap binds. */
  remaining: number;
  /** Actionable message for the principal. */
  message: string;
}

/**
 * A bounded grace grant. Grace is a one-time allowance per period: it cannot
 * be extended indefinitely by repeated requests.
 */
export interface GraceGrant {
  /** The period this grant applies to. */
  period: string;
  /** The principal that authorized the grant. */
  authorizedBy: string;
  /** The amount of overage granted. */
  amount: number;
  /** The period from which the grant is repaid. */
  repaidFromPeriod: string;
}

/**
 * Tracks grace grants so a period can only be granted grace once. This is the
 * bound that prevents indefinite extension by repeated requests.
 */
export class GraceLedger {
  private readonly grants = new Map<string, GraceGrant>();

  /** Returns the existing grant for a period, if any. */
  get(period: string): GraceGrant | undefined {
    return this.grants.get(period);
  }

  /**
   * Records a grace grant. Throws if the period already has a grant, so grace
   * cannot be extended indefinitely by repeated requests.
   */
  grant(grant: GraceGrant): void {
    if (this.grants.has(grant.period)) {
      throw new OverageError(
        `grace already granted for period ${grant.period}; ` +
          `grace is a one-time allowance and cannot be extended`,
      );
    }
    this.grants.set(grant.period, grant);
  }
}

/**
 * Evaluates usage against an overage policy.
 *
 * Returns any warnings that should be surfaced to the principal. Warnings are
 * returned (not merely logged) so callers can deliver them to the principal.
 */
export function evaluateOverage(
  usage: number,
  policy: OveragePolicy,
): OverageWarning[] {
  const thresholds = policy.warningThresholds ?? DEFAULT_WARNING_THRESHOLDS;
  const warnings: OverageWarning[] = [];
  for (const threshold of thresholds) {
    if (usage >= policy.limit * threshold.fraction) {
      const remaining = Math.max(0, policy.limit - usage);
      warnings.push({
        threshold,
        usage,
        limit: policy.limit,
        remaining,
        message:
          `metering ${threshold.label}: ${usage} of ${policy.limit} used, ` +
          `${remaining} remaining before the cap binds`,
      });
    }
  }
  return warnings;
}

/**
 * Error thrown when a metering cap rejects a request.
 *
 * The message is actionable: it states how much was available, what was
 * needed, and how to raise the limit.
 */
export class OverageError extends Error {
  readonly available: number;
  readonly needed: number;
  readonly limit: number;

  constructor(message: string, available = 0, needed = 0, limit = 0) {
    super(message);
    this.name = "OverageError";
    this.available = available;
    this.needed = needed;
    this.limit = limit;
  }
}

/**
 * Builds an actionable rejection message: how much was available, what was
 * needed, and how to raise the limit.
 */
export function overageRejectionMessage(
  available: number,
  needed: number,
  limit: number,
): string {
  return (
    `metering cap exceeded: ${available} available, ${needed} needed ` +
    `(limit ${limit}). Raise the limit or authorize a one-time grace ` +
    `allowance to proceed.`
  );
}

/**
 * Enforces the overage policy for a request.
 *
 * - Emits warnings (returned) before the cap binds.
 * - Allows usage up to `limit + graceAllowance` when a grace grant exists.
 * - Rejects with an actionable message otherwise.
 */
export function enforceOverage(
  usage: number,
  needed: number,
  policy: OveragePolicy,
  grace?: GraceGrant,
): { warnings: OverageWarning[]; allowed: boolean; error?: OverageError } {
  const warnings = evaluateOverage(usage, policy);
  const graceAllowance = grace?.amount ?? 0;
  const ceiling = policy.limit + graceAllowance;
  if (usage + needed <= ceiling) {
    return { warnings, allowed: true };
  }
  const available = Math.max(0, ceiling - usage);
  return {
    warnings,
    allowed: false,
    error: new OverageError(
      overageRejectionMessage(available, needed, policy.limit),
      available,
      needed,
      policy.limit,
    ),
  };
}
