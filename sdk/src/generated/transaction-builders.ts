/**
 * AUTO-GENERATED typed transaction builder helpers.
 * Run: npm run generate:contracts -w sdk
 */

import type { GeneratedContractMap } from './contracts.js';

export interface ContractInvokeParams<TArgs> {
  contractId: string;
  method: string;
  args: TArgs;
  sourceAccount: string;
}

export interface BuiltTransaction {
  contractId: string;
  method: string;
  args: unknown;
  sourceAccount: string;
}

export function buildContractInvoke<T extends keyof GeneratedContractMap>(
  _contract: T,
  method: string,
  params: Omit<ContractInvokeParams<unknown>, "method">,
): BuiltTransaction {
  return {
    contractId: params.contractId,
    method,
    args: params.args,
    sourceAccount: params.sourceAccount,
  };
}

export function buildSubscriptionRegistryCreateSubscription(
  contractId: string,
  sourceAccount: string,
  args: { arg0: string; arg1: string; arg2: bigint; arg3: bigint; arg4: bigint },
): BuiltTransaction {
  return {
    contractId,
    method: "create_subscription",
    args,
    sourceAccount,
  };
}

export function buildSubscriptionRegistryUpdateSubscription(
  contractId: string,
  sourceAccount: string,
  args: { arg0: Uint8Array; arg1: string; arg2: unknown | null; arg3: unknown | null; arg4: unknown | null; arg5: unknown | null },
): BuiltTransaction {
  return {
    contractId,
    method: "update_subscription",
    args,
    sourceAccount,
  };
}

export function buildSubscriptionRegistryCancelSubscription(
  contractId: string,
  sourceAccount: string,
  args: { arg0: Uint8Array; arg1: string },
): BuiltTransaction {
  return {
    contractId,
    method: "cancel_subscription",
    args,
    sourceAccount,
  };
}

export function buildSubscriptionLoggingRecordLog(
  contractId: string,
  sourceAccount: string,
  args: { arg0: bigint; arg1: string; arg2: string },
): BuiltTransaction {
  return {
    contractId,
    method: "record_log",
    args,
    sourceAccount,
  };
}

export function buildSubscriptionRenewalRenew(
  contractId: string,
  sourceAccount: string,
  args: { arg0: string; arg1: bigint; arg2: bigint; arg3: bigint; arg4: bigint; arg5: bigint; arg6: bigint; arg7: boolean },
): BuiltTransaction {
  return {
    contractId,
    method: "renew",
    args,
    sourceAccount,
  };
}
