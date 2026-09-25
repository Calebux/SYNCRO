// ─────────────────────────────────────────────────────────────────────────────
// @syncro/sdk v3 — Payments & utility surface
//
// This package exports the v3 payments API, webhook helpers, receipt
// verification, Stellar memo utilities, Soroban contract bindings,
// route pricing, and channel management.  Subscription APIs have been
// removed in this major version; see the deprecation note in the README.
// ─────────────────────────────────────────────────────────────────────────────

export {
  SyncroError,
  ValidationError,
  AuthError,
  NetworkError,
  RpcError,
  ContractError,
  NotFoundError,
  createApiError,
  resolveContractErrorVariant,
  withRetry,
  computeBackoffDelay,
} from "./errors.js";
export type { RetryPolicy, ProblemDetails } from "./errors.js";

export {
  verifyWebhookSignature,
  parseWebhookHeaders,
  parseVerifiedWebhookEvent,
  createWebhookHandler,
  SYNCRO_WEBHOOK_HEADERS,
} from "./webhooks.js";
export type {
  SyncroWebhookEventType,
  SyncroWebhookEventPayloadMap,
  SyncroWebhookEnvelope,
  SyncroWebhookEvent,
  SyncroWebhookDeliveryHeaders,
  WebhookHeaderInput,
} from "./webhooks.js";

export {
  decodeReceiptHeader,
  verifyReceipt,
} from "./receipts.js";

export {
  buildSyncroMemo,
  parseSyncroMemo,
  validateSyncroMemo,
  verifyTransactionMemo,
  hashSubscriptionId,
  resolveMemoOperationFromSubscriptionAction,
  resolveMemoOperationFromMethod,
  SYNCRO_MEMO_VERSION,
} from "./stellar/memo.js";
export type {
  SyncroMemoTypeCode,
  SyncroMemoParts,
  ParsedSyncroMemo,
  SyncroMemoOperation,
  StellarTransactionReceipt,
} from "./stellar/memo.js";

export {
  buildContractInvoke,
} from "./generated/index.js";
export type {
  GeneratedContractMap,
  ContractInvokeParams,
  BuiltTransaction,
} from "./generated/index.js";

export {
  pricing,
  metered,
  hostedGateway,
} from "./provider/index.js";
export type {
  RoutePricingRule,
  PricingDeclarationInput,
  PricingDeclaration,
  RoutePricing,
  SyncroReceipt,
  FailureMode,
  FailureHandler,
  MeteredOptions,
  HostedGatewayConfig,
} from "./provider/index.js";

export {
  CHANNEL_SCOPE,
  ChannelClient,
  ChannelScopeError,
} from "./channels/index.js";
export type {
  AutoTopUpConfig,
  ChallengePeriod,
  ChannelBalance,
  ChannelClientOptions,
  ChannelInvocation,
  ChannelLifecycleState,
  ChannelOperation,
  ChannelScope,
  ChannelTransport,
  ChannelView,
  CloseResult,
  EnsureFundedResult,
  InitiateCloseInput,
  OpenChannelInput,
} from "./channels/index.js";

export type {
  RetryOptions,
  StellarWallet,
  StellarKeypair,
  PaidReceipt,
  PaidReceiptPayload,
} from "./types.js";
