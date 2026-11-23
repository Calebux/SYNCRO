export {
  verifyReceipt,
  type IndependentReceipt,
  type VerifyReceiptInput,
  type VerifyReceiptResult,
  type ReceiptFailure,
} from "./receipt.js";

export { GatewayClient, type GatewayClientOptions } from "./gateway-client.js";
export {
  LogicalCallManager,
  IdempotencyKeyReuseError,
  type DefaultRetryPolicy,
  type RetryAttemptContext,
  type LogicalCallOptions,
} from "./retry.js";

export {
  GatewaySdkError,
  GatewayPaymentRequiredError,
  GatewayKeyMissingError,
  GatewayKeyInvalidError,
  GatewayRateLimitedError,
  GatewayChannelExhaustedError,
  GatewayKeyRevokedError,
  GatewayScopeDeniedError,
  GatewayGrantExpiredError,
  GatewayCapExceededError,
  GatewayMeterInsufficientError,
  GatewayUpstreamUnavailableError,
  GatewayMeterDegradedError,
  GatewayBadRequestError,
  GatewayUnauthorizedError,
  GatewayInternalError,
  createGatewayErrorFromCode,
  createGatewayErrorFromHttpStatus,
  getGatewayRetrySemantics,
  isGatewayErrorCode,
  type GatewayErrorCode,
  type GatewayErrorDetails,
  type GeneratedGatewayError,
} from "../generated/gateway-errors.js";

export {
  createPaidFetch,
  parsePaymentRequiredHeader,
  buildSyncroX402Payload,
  type PaidFetchConfig,
  type PaidResponse,
  type PaymentReceipt,
  type SyncroChannelContext,
  type SyncroChallenge,
  type X402PaymentRequirement,
  type X402PaymentRequired,
  type X402PaymentPayload,
  type X402Signer,
} from "./paid-fetch.js";
