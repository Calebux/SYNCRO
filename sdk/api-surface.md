## @syncro/sdk — Public API Surface Report
## Version: 1.2.0
## Generated: 2026-08-26
## DO NOT EDIT BY HAND.  Run `npm run api-surface -w sdk` to regenerate.
## CI fails when this file diverges from a fresh generation.

### CLASSES

SyncroSDK (default export, named export)
  constructor(config: SyncroSDKConfig)
  cancelSubscription(subscriptionId: string): Promise<CancellationResult>
  createSubscription(input: CreateSubscriptionInput, options?: { idempotencyKey?: string }): Promise<SubscriptionRecord>
  createWebhook(input: CreateWebhookInput): Promise<Webhook>
  deleteSubscription(id: string): Promise<void>
  deleteWebhook(id: string): Promise<void>
  getAnalyticsSummary(): Promise<AnalyticsSummary>
  getNotifications(options?: { unreadOnly?: boolean }): Promise<AppNotification[]>
  getRenewalHistory(subscriptionId: string): Promise<RenewalEvent[]>
  getSpendAnalytics(): Promise<unknown>
  getSubscription(id: string): Promise<SubscriptionRecord>
  getUserSubscriptions(): Promise<Subscription[]>
  healthCheck(): Promise<unknown>
  listSubscriptions(filters?: SubscriptionFilters): Promise<PaginatedResult<SubscriptionRecord>>
  listWebhooks(): Promise<Webhook[]>
  markNotificationRead(id: string): Promise<void>
  updateSubscription(id: string, input: UpdateSubscriptionInput, options?: { idempotencyKey?: string }): Promise<SubscriptionRecord>

### ERRORS (stable — part of the public surface)

SyncroError         code: "SYNCRO_ERROR"       retryable: false
ValidationError     code: "SYNCRO_VALIDATION"  retryable: false  (also: ConflictError alias)
AuthError           code: "SYNCRO_AUTH"        retryable: false  (also: AuthenticationError, ForbiddenError aliases)
NetworkError        code: "SYNCRO_NETWORK"     retryable: true   (also: RateLimitError alias)
RpcError            code: "SYNCRO_RPC"         retryable: true
ContractError       code: "SYNCRO_CONTRACT"    retryable: false  (exposes .contractName, .errorCode, .variant)
NotFoundError       code: "SYNCRO_NOT_FOUND"   retryable: false

### DEPRECATED ALIASES (backwards-compat, will be removed in v2.0)

AuthenticationError → AuthError
ForbiddenError      → AuthError
RateLimitError      → NetworkError
ConflictError       → ValidationError

### FUNCTIONS

init(config: SyncroSDKInitConfig): SyncroSDK
createApiError(status: number, data: unknown, retryAfter?: number): SyncroError
withRetry<T>(fn: () => Promise<T>, policy?: RetryPolicy, idempotencyKey?: string): Promise<T>
computeBackoffDelay(attempt: number, policy: RetryPolicy): number
resolveContractErrorVariant(contractName: string, code: number): string
verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean
parseWebhookHeaders(headers: WebhookHeaderInput): SyncroWebhookDeliveryHeaders
parseVerifiedWebhookEvent(rawBody: string, signature: string, secret: string): SyncroWebhookEvent
createWebhookHandler(secret: string, handlers: Partial<...>): (rawBody: string, headers: ...) => Promise<void>
buildSyncroMemo(operation: SyncroMemoOperation, subscriptionId: string): string
parseSyncroMemo(memo: string): ParsedSyncroMemo | null
validateSyncroMemo(memo: string, operation: SyncroMemoOperation, subscriptionId: string): boolean
verifyTransactionMemo(receipt: StellarTransactionReceipt, operation: SyncroMemoOperation, subscriptionId: string): boolean
hashSubscriptionId(subscriptionId: string): string
buildContractInvoke<T extends keyof GeneratedContractMap>(contract: T, method: string, params: ...): BuiltTransaction
buildSubscriptionRegistryCreateSubscription(contractId: string, sourceAccount: string, args: ...): BuiltTransaction
buildSubscriptionRegistryUpdateSubscription(contractId: string, sourceAccount: string, args: ...): BuiltTransaction
buildSubscriptionRegistryCancelSubscription(contractId: string, sourceAccount: string, args: ...): BuiltTransaction
buildSubscriptionLoggingRecordLog(contractId: string, sourceAccount: string, args: ...): BuiltTransaction
buildSubscriptionRenewalRenew(contractId: string, sourceAccount: string, args: ...): BuiltTransaction

### CONSTANTS

SYNCRO_WEBHOOK_HEADERS: SyncroWebhookDeliveryHeaders (keys: signature, deliveryId, retryCount, replayId)
SYNCRO_MEMO_VERSION: string

### TYPES (exported for consumer use)

SyncroSDKConfig
SyncroSDKInitConfig
RetryOptions
RetryPolicy
StellarWallet
StellarKeypair
Subscription
CancellationResult
CreateSubscriptionInput
UpdateSubscriptionInput
SubscriptionFilters
SubscriptionRecord
PaginatedResult<T>
AnalyticsSummary
RenewalEvent
CreateWebhookInput
Webhook
AppNotification
GiftCardEvent
GiftCardEventType
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
SubscriptionRegistryContract
SubscriptionLoggingContract
SubscriptionRenewalContract
BuiltTransaction
ContractInvokeParams<TArgs>

### EXPERIMENTAL (namespaced — intentionally unstable)
## These exports are grouped under sdk/experimental and may change in any release.
## Do NOT depend on them in production code.

(none currently — see sdk/src/experimental/index.ts when added)
