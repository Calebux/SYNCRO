/**
 * AUTO-GENERATED — do not edit manually.
 * Run: npm run generate:contracts -w sdk
 */

export interface SubscriptionRegistryContract {
  create_subscription(args: { arg0: string; arg1: string; arg2: bigint; arg3: bigint; arg4: bigint }): Promise<unknown>;
  update_subscription(args: { arg0: Uint8Array; arg1: string; arg2: unknown | null; arg3: unknown | null; arg4: unknown | null; arg5: unknown | null }): Promise<unknown>;
  cancel_subscription(args: { arg0: Uint8Array; arg1: string }): Promise<unknown>;
}

export interface SubscriptionLoggingContract {
  record_log(args: { arg0: bigint; arg1: string; arg2: string }): Promise<unknown>;
}

export interface SubscriptionRenewalContract {
  renew(args: { arg0: string; arg1: bigint; arg2: bigint; arg3: bigint; arg4: bigint; arg5: bigint; arg6: bigint; arg7: boolean }): Promise<unknown>;
}

export interface GeneratedContractMap {
  "SubscriptionRegistry": SubscriptionRegistryContract;
  "SubscriptionLogging": SubscriptionLoggingContract;
  "SubscriptionRenewal": SubscriptionRenewalContract;
}
