/**
 * Typed errors raised by the v3 SDK.
 *
 * These are intentionally small, serialisable classes so callers can branch on
 * `instanceof` (or on `code`) without string matching.
 */

export type SdkErrorCode =
  | "CONTRACT_MISMATCH"
  | "NETWORK_MISMATCH"
  | "CHANNEL_MISMATCH"
  | "PRICE_EXCEEDS_MAX"
  | "BUDGET_EXCEEDED";

/** Base class for all typed SDK errors. */
export class SdkError extends Error {
  readonly code: SdkErrorCode;

  constructor(code: SdkErrorCode, message: string) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    // Restore prototype chain for transpiled targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The challenge named a contract id that does not match the deployment
 * manifest. Signing it could bind funds to an attacker-controlled contract.
 */
export class ContractMismatchError extends SdkError {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(
      "CONTRACT_MISMATCH",
      `challenge contract id ${actual} does not match manifest ${expected}`,
    );
    this.name = "ContractMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * The challenge named a network that does not match the deployment manifest.
 */
export class NetworkMismatchError extends SdkError {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(
      "NETWORK_MISMATCH",
      `challenge network ${actual} does not match manifest ${expected}`,
    );
    this.name = "NetworkMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * The challenge referenced a channel that does not belong to this principal
 * and provider pair.
 */
export class ChannelMismatchError extends SdkError {
  readonly expectedPrincipal: string;
  readonly expectedProvider: string;
  readonly actualPrincipal: string;
  readonly actualProvider: string;

  constructor(
    expectedPrincipal: string,
    expectedProvider: string,
    actualPrincipal: string,
    actualProvider: string,
  ) {
    super(
      "CHANNEL_MISMATCH",
      `challenge channel (principal ${actualPrincipal}, provider ${actualProvider}) ` +
        `does not belong to (principal ${expectedPrincipal}, provider ${expectedProvider})`,
    );
    this.name = "ChannelMismatchError";
    this.expectedPrincipal = expectedPrincipal;
    this.expectedProvider = expectedProvider;
    this.actualPrincipal = actualPrincipal;
    this.actualProvider = actualProvider;
  }
}

/**
 * The challenge quoted a price above the caller-set `maxPricePerCall`.
 */
export class PriceExceedsMaxError extends SdkError {
  readonly maxPricePerCall: bigint;
  readonly actualPrice: bigint;

  constructor(maxPricePerCall: bigint, actualPrice: bigint) {
    super(
      "PRICE_EXCEEDS_MAX",
      `challenge price ${actualPrice.toString()} exceeds maxPricePerCall ${maxPricePerCall.toString()}`,
    );
    this.name = "PriceExceedsMaxError";
    this.maxPricePerCall = maxPricePerCall;
    this.actualPrice = actualPrice;
  }
}

/**
 * Signing the next state would push cumulative spend past the caller-set
 * local `budget`. Raised before any signature is produced.
 */
export class BudgetExceededError extends SdkError {
  readonly budget: bigint;
  readonly spent: bigint;
  readonly nextSpend: bigint;
  readonly asset: string;

  constructor(budget: bigint, spent: bigint, nextSpend: bigint, asset: string) {
    super(
      "BUDGET_EXCEEDED",
      `next spend ${nextSpend.toString()} would exceed budget ${budget.toString()} ` +
        `(already spent ${spent.toString()} ${asset})`,
    );
    this.name = "BudgetExceededError";
    this.budget = budget;
    this.spent = spent;
    this.nextSpend = nextSpend;
    this.asset = asset;
  }
}
