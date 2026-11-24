## @syncro/sdk — Public API Surface Report
## Version: 3.0.0
## Generated: 2026-08-26
## DO NOT EDIT BY HAND.  Run `npm run api-surface -w sdk` to regenerate.
## CI fails when this file diverges from a fresh generation.

### CLASSES

SyncroError
  constructor(problem: ProblemDetails | string, options?: { code?: string; retryable?: boolean })

ValidationError   — code: `SYNCRO_VALIDATION`, retryable: false
AuthError        — code: `SYNCRO_AUTH`, retryable: false
NetworkError     — code: `SYNCRO_NETWORK`, retryable: true
RpcError         — code: `SYNCRO_RPC`, retryable: true
ContractError    — code: `SYNCRO_CONTRACT`, retryable: false  (exposes .contractName, .errorCode, .variant)
NotFoundError    — code: `SYNCRO_NOT_FOUND`, retryable: false

### FUNCTIONS

init(config: SyncroSDKInitConfig): SyncroSDK — *removed in v3; subscription SDK no longer shipped*
createApiError(status: number, data: unknown, retryAfter?: number): SyncroError
withRetry<T>(fn: () => Promise<T>, policy?: RetryPolicy, idempotencyKey?: string): Promise<T>
computeBackoffDelay(attempt: number, policy: RetryPolicy): number
resolveContractErrorVariant(contractName: string, code: number): string
verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean
parseWebhookHeaders(headers: WebhookHeaderInput): SyncroWebhookDeliveryHeaders
parseVerifiedWebhookEvent(rawBody: string, signature: string, secret: string): SyncroWebhookEvent | null
createWebhookHandler(secret: string, handlers: Partial<...>): (rawBody: string, headers: ...) => Promise<void>
decodeReceiptHeader(headerValue: string): PaidReceipt
verifyReceipt(receipt: PaidReceipt): boolean
buildSyncroMemo(operation: SyncroMemoOperation, subscriptionId: string): string
parseSyncroMemo(memo: string): ParsedSyncroMemo | null
validateSyncroMemo(memo: string, operation: SyncroMemoOperation, subscriptionId: string): boolean
verifyTransactionMemo(receipt: StellarTransactionReceipt, operation: SyncroMemoOperation, subscriptionId: string): boolean
hashSubscriptionId(subscriptionId: string): string
buildContractInvoke<T extends keyof GeneratedContractMap>(contract: T, method: string, params: ...): BuiltTransaction
pricing(input: PricingDeclarationInput | Record<string, any>): RoutePricing
metered(options: MeteredOptions): RoutePricing
hostedGateway(config: HostedGatewayConfig): RoutePricing

### CONSTANTS

SYNCRO_WEBHOOK_HEADERS: SyncroWebhookDeliveryHeaders (keys: signature, deliveryId, retryCount, replayId)
SYNCRO_MEMO_VERSION: string
CHANNEL_SCOPE: symbol

### TYPES (exported for consumer use)

RetryOptions
StellarWallet
StellarKeypair
PaidReceipt
PaidReceiptPayload
RetryPolicy
ProblemDetails
SyncroWebhookEventType
SyncroWebhookEventPayloadMap
SyncroWebhookEnvelope
SyncroWebhookEvent
SyncroWebhookDeliveryHeaders
WebhookHeaderInput
SyncroMemoTypeCode
SyncroMemoParts
ParsedSyncroMemo
SyncroMemoOperation
StellarTransactionReceipt
GeneratedContractMap
ContractInvokeParams<TArgs>
BuiltTransaction
RoutePricingRule
PricingDeclarationInput
PricingDeclaration
RoutePricing
SyncroReceipt
FailureMode
FailureHandler
MeteredOptions
HostedGatewayConfig
AutoTopUpConfig
ChallengePeriod
ChannelBalance
ChannelClientOptions
ChannelInvocation
ChannelLifecycleState
ChannelOperation
ChannelScope
ChannelTransport
ChannelView
CloseResult
EnsureFundedResult
InitiateCloseInput
OpenChannelInput

### CHANNELS

ChannelClient
  constructor(options: ChannelClientOptions)
  open(input: OpenChannelInput): Promise<ChannelView>
  topUp(channelId: bigint, amount: bigint): Promise<ChannelView>
  getBalance(channelId: bigint): Promise<ChannelBalance>
  getBurnRate(channelId: bigint): Promise<bigint | null>
  ensureFunded(channelId: bigint): Promise<EnsureFundedResult>
  initiateClose(input: InitiateCloseInput): Promise<CloseResult>
  finalize(channelId: bigint, expectedSequence: bigint): Promise<ChannelView>
ChannelScopeError   extends AuthError

### EXPERIMENTAL (namespaced — intentionally unstable)
## These exports are grouped under sdk/experimental and may change in any release.
## Do NOT depend on them in production code.

(none currently — see sdk/src/experimental/index.ts when added)

### DEPRECATED — removed in v3

The following symbols were part of the subscription SDK and have been removed:

- `SyncroSDK` class and `init()` function
- `Subscription`, `CancellationResult`, `SubscriptionRecord`, `SubscriptionFilters`, `PaginatedResult`
- `CreateSubscriptionInput`, `UpdateSubscriptionInput`
- `AnalyticsSummary`, `RenewalEvent`
- `CreateWebhookInput`, `Webhook`, `AppNotification`, `GiftCardEvent`, `GiftCardEventType`
- `SyncroSDKConfig`, `SyncroSDKInitConfig`
- `AuthenticationError`, `ForbiddenError`, `RateLimitError`, `ConflictError` (deprecated aliases)
- `buildSubscriptionRegistryCreateSubscription`, `buildSubscriptionRegistryUpdateSubscription`, `buildSubscriptionRegistryCancelSubscription`, `buildSubscriptionLoggingRecordLog`, `buildSubscriptionRenewalRenew`
- All subscription-related contract bindings

Migration: the v3 payments API (`@syncro/sdk/v3`) is a separate surface with no upgrade path from the subscription SDK. Existing subscription integrations must be rewritten against the v3 payments API.
