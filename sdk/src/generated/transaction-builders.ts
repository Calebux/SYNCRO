/**
 * AUTO-GENERATED typed transaction builder helpers.
 * Source: shared/src/generated/soroban-abi.json
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
  args: { user: string; service_id: string; billing_interval: bigint; expected_amount: bigint; next_renewal: bigint },
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
  args: { subscription_id: Uint8Array; user: string; service_id: unknown | null; billing_interval: unknown | null; expected_amount: unknown | null; next_renewal: unknown | null },
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
  args: { subscription_id: Uint8Array; caller: string },
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
  args: { sub_id: bigint; event: string; data: string },
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
  args: { owner: string; sub_id: bigint; approval_id: bigint; amount: bigint; max_retries: bigint; cooldown_ledgers: bigint; cycle_id: bigint; succeed: boolean },
): BuiltTransaction {
  return {
    contractId,
    method: "renew",
    args,
    sourceAccount,
  };
}
