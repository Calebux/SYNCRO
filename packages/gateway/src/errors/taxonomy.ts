/**
 * Gateway error taxonomy.
 *
 * Every error surfaced by the gateway carries a stable `code` so SDKs can
 * branch on it programmatically. Codes are grouped by domain via the prefix.
 */

export type GatewayErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "upstream_error"
  | "upstream_timeout"
  | "insufficient_funds"
  | "rate_card_version_stale"
  | "internal_error";

export interface GatewayErrorBody {
  code: GatewayErrorCode;
  message: string;
  /**
   * Optional structured details. For `rate_card_version_stale` this carries
   * `currentRateCardVersion` so the SDK can refresh and retry once.
   */
  details?: Record<string, unknown>;
}

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: GatewayErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toBody(): GatewayErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/**
 * Policy for a stale `rateCardVersion` on paid calls: **reject**.
 *
 * When a provider updates pricing mid-session, an agent holding the previous
 * `rateCardVersion` will send a stale value. Rather than silently honouring an
 * outdated price (which risks under/over-charging) or repricing without
 * consent, the gateway rejects the call with `rate_card_version_stale` and
 * includes the current version. The SDK is expected to refresh its rate card
 * and retry exactly once with the fresh version.
 */
export function staleRateCardVersionError(
  sentVersion: string,
  currentVersion: string,
): GatewayError {
  return new GatewayError(
    "rate_card_version_stale",
    `rateCardVersion '${sentVersion}' is stale; current version is '${currentVersion}'. Refresh the rate card and retry once.`,
    409,
    {
      sentRateCardVersion: sentVersion,
      currentRateCardVersion: currentVersion,
    },
  );
}
