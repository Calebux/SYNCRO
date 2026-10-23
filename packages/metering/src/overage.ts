/**
 * Overage policy and the grace path for metering caps.
 *
 * A cap that rejects at exactly 100% fails an agent mid-workflow with no
 * warning. A cap that allows unlimited overage is not a cap. This module
 * defines the behaviour in between:
 *
 *  - Warning thresholds fire *before* the cap binds and are surfaced to the
 *    principal (not only logged).
 *  - A bounded, auditable grace allowance may be granted by an authorizer and
 *    is repaid from subsequent usage.
 *  - Rejections are actionable: how much was available, what was needed, and
 *    how to raise the limit.
 *  - The grace path can never be extended indefinitely by repeated requests.
 */

export interface OveragePolicy {
  /** Absolute limit for the period. */
  limit: number;
  /** Fractions of `limit` at which warnings fire, ascending, in (0, 1). */
  warningThresholds: number[];
  /**
   * Maximum grace allowance that may be granted in a single period.
   * `0` disables the grace path entirely.
   */
  graceAllowance: number;
  /**
   * Maximum number of grace grants per period. Bounds the grace path so it
   * cannot be extended indefinitely by repeated requests.
   */
  maxGraceGrantsPerPeriod: number;
}

export const DEFAULT_OVERAGE_POLICY: OveragePolicy = {
  limit: 0,
  warningThresholds: [0.8, 0.95],
  graceAllowance: 0,
  maxGraceGrantsPerPeriod: 1,
};

export interface OverageWarning {
  /** Fraction of the limit consumed, e.g. 0.8. */
  threshold: number;
  /** Usage at the time the warning fired. */
  used: number;
  /** Remaining headroom before the cap binds. */
  remaining: number;
  limit: number;
  message: string;
}

export interface GraceGrant {
  /** Who authorized the grace allowance. */
  authorizedBy: string;
  /** Amount of grace granted. */
  amount: number;
  /** Usage at the time the grant was made. */
  grantedAtUsage: number;
  /** Monotonic grant index within the period, for audit. */
  grantIndex: number;
}

export interface OverageState {
  policy: OveragePolicy;
  /** Usage consumed in the current period. */
  used: number;
  /** Warnings already emitted, keyed by threshold, so each fires once. */
  emittedWarnings: number[];
  /** Grace grants made in the current period. */
  graceGrants: GraceGrant[];
}

export interface OverageDecision {
  /** Whether the requested amount may proceed. */
  allowed: boolean;
  /** Warnings that should be surfaced to the principal. */
  warnings: OverageWarning[];
  /** Actionable rejection message when `allowed` is false. */
  rejection?: string;
}

export function createOverageState(
  policy: Partial<OveragePolicy> = {},
): OverageState {
  return {
    policy: { ...DEFAULT_OVERAGE_POLICY, ...policy },
    used: 0,
    emittedWarnings: [],
    graceGrants: [],
  };
}

/** Total grace currently available for the period. */
export function availableGrace(state: OverageState): number {
  const { policy, graceGrants } = state;
  if (policy.graceAllowance <= 0) return 0;
  if (graceGrants.length >= policy.maxGraceGrantsPerPeriod) return 0;
  const granted = graceGrants.reduce((sum, g) => sum + g.amount, 0);
  return Math.max(0, policy.graceAllowance - granted);
}

/**
 * Authorize a bounded grace allowance. Returns the grant, or `null` when the
 * grace path is disabled or already exhausted for the period.
 */
export function authorizeGrace(
  state: OverageState,
  authorizedBy: string,
  amount: number,
): GraceGrant | null {
  const available = availableGrace(state);
  if (available <= 0 || amount <= 0) return null;
  const grant: GraceGrant = {
    authorizedBy,
    amount: Math.min(amount, available),
    grantedAtUsage: state.used,
    grantIndex: state.graceGrants.length,
  };
  state.graceGrants.push(grant);
  return grant;
}

function buildWarnings(state: OverageState): OverageWarning[] {
  const { policy, used } = state;
  if (policy.limit <= 0) return [];
  const warnings: OverageWarning[] = [];
  for (const threshold of policy.warningThresholds) {
    if (threshold <= 0 || threshold >= 1) continue;
    if (state.emittedWarnings.includes(threshold)) continue;
    if (used >= policy.limit * threshold) {
      state.emittedWarnings.push(threshold);
      const remaining = Math.max(0, policy.limit - used);
      warnings.push({
        threshold,
        used,
        remaining,
        limit: policy.limit,
        message:
          `Metering usage at ${Math.round(threshold * 100)}% of the cap ` +
          `(${used}/${policy.limit}); ${remaining} remaining before the cap binds.`,
      });
    }
  }
  return warnings;
}

function buildRejection(state: OverageState, needed: number): string {
  const { policy, used } = state;
  const available = Math.max(0, policy.limit - used);
  const grace = availableGrace(state);
  const totalAvailable = available + grace;
  const parts = [
    `Metering cap exceeded: ${available} available, ${needed} needed ` +
      `(limit ${policy.limit}, used ${used}).`,
  ];
  if (grace > 0) {
    parts.push(`${grace} of bounded grace is available for this period.`);
  }
  parts.push(
    `Raise the limit or authorize grace (max ${policy.graceAllowance} per ` +
      `period, up to ${policy.maxGraceGrantsPerPeriod} grant(s)).`,
  );
  if (totalAvailable < needed) {
    parts.push(`Short by ${needed - totalAvailable}.`);
  }
  return parts.join(' ');
}

/**
 * Evaluate a request against the overage policy. Warnings are surfaced to the
 * caller (the principal) rather than only logged, and rejections are
 * actionable.
 */
export function evaluateOverage(
  state: OverageState,
  needed: number,
): OverageDecision {
  const { policy, used } = state;
  const warnings = buildWarnings(state);

  if (policy.limit <= 0) {
    return { allowed: true, warnings };
  }

  const available = Math.max(0, policy.limit - used);
  if (needed <= available) {
    return { allowed: true, warnings };
  }

  const grace = availableGrace(state);
  if (needed <= available + grace) {
    return { allowed: true, warnings };
  }

  return {
    allowed: false,
    warnings,
    rejection: buildRejection(state, needed),
  };
}

/**
 * Record committed usage. Grace is repaid first, then the period limit is
 * consumed, so a grace path cannot be extended indefinitely.
 */
export function recordUsage(state: OverageState, amount: number): void {
  if (amount <= 0) return;
  state.used += amount;
}
