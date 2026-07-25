/**
 * Maps backend blockchain operations to deployed Soroban contract functions.
 *
 * Used by BlockchainService for invoke method names and validated against
 * shared/soroban-contract-interfaces.ts in integration tests.
 */

import type { SorobanArgKind } from '../../../shared/src/soroban-contract-interfaces';

export type SubscriptionOperation =
  | 'create'
  | 'update'
  | 'delete'
  | 'cancel'
  | 'pause'
  | 'unpause';

export interface BackendContractBinding {
  /** Backend operation identifier. */
  operation: string;
  /** Target Soroban contract (must match SOROBAN_CONTRACT_INTERFACES). */
  contract: string;
  /** Soroban export name invoked on-chain. */
  method: string;
  /** Expected argument kinds per the deployed contract signature. */
  expectedArgKinds: SorobanArgKind[];
}

/** Soroban method names used by BlockchainService. */
export const BLOCKCHAIN_INVOKE_METHODS = {
  logReminder: 'record_log',
  giftCardAttached: 'record_log',
  recordCommitment: 'record_commitment',
} as const;

const SUBSCRIPTION_METHODS: Record<
  SubscriptionOperation,
  Pick<BackendContractBinding, 'contract' | 'method' | 'expectedArgKinds'>
> = {
  create: {
    contract: 'SubscriptionRegistry',
    method: 'create_subscription',
    expectedArgKinds: ['Address', 'String', 'U64', 'I128', 'U64'],
  },
  update: {
    contract: 'SubscriptionRegistry',
    method: 'update_subscription',
    expectedArgKinds: ['BytesN32', 'Address', 'Option', 'Option', 'Option', 'Option'],
  },
  delete: {
    contract: 'SubscriptionRegistry',
    method: 'cancel_subscription',
    expectedArgKinds: ['BytesN32', 'Address'],
  },
  cancel: {
    contract: 'SubscriptionRegistry',
    method: 'cancel_subscription',
    expectedArgKinds: ['BytesN32', 'Address'],
  },
  pause: {
    contract: 'SubscriptionRegistry',
    method: 'cancel_subscription',
    expectedArgKinds: ['BytesN32', 'Address'],
  },
  unpause: {
    contract: 'SubscriptionRegistry',
    method: 'update_subscription',
    expectedArgKinds: ['BytesN32', 'Address', 'Option', 'Option', 'Option', 'Option'],
  },
};

/** Resolve the Soroban method name for a subscription sync operation. */
export function resolveSubscriptionMethod(operation: SubscriptionOperation): string {
  return SUBSCRIPTION_METHODS[operation].method;
}

/** All backend→contract bindings exercised by BlockchainService. */
export function getBackendContractBindings(): BackendContractBinding[] {
  const subscriptionBindings: BackendContractBinding[] = (
    Object.entries(SUBSCRIPTION_METHODS) as [SubscriptionOperation, (typeof SUBSCRIPTION_METHODS)[SubscriptionOperation]][]
  ).map(([operation, spec]) => ({
    operation: `subscription_${operation}`,
    contract: spec.contract,
    method: spec.method,
    expectedArgKinds: spec.expectedArgKinds,
  }));

  return [
    ...subscriptionBindings,
    {
      operation: 'log_reminder',
      contract: 'SubscriptionLogging',
      method: BLOCKCHAIN_INVOKE_METHODS.logReminder,
      expectedArgKinds: ['U64', 'String', 'String'],
    },
    {
      operation: 'gift_card_attached',
      contract: 'SubscriptionLogging',
      method: BLOCKCHAIN_INVOKE_METHODS.giftCardAttached,
      expectedArgKinds: ['U64', 'String', 'String'],
    },
    {
      operation: 'record_commitment',
      contract: 'SubscriptionLogging',
      method: BLOCKCHAIN_INVOKE_METHODS.recordCommitment,
      expectedArgKinds: ['BytesN<32>'],
    },
  ];
}

/** Binding lookup for a subscription operation. */
export function getSubscriptionBinding(
  operation: SubscriptionOperation,
): BackendContractBinding {
  const spec = SUBSCRIPTION_METHODS[operation];
  return {
    operation: `subscription_${operation}`,
    contract: spec.contract,
    method: spec.method,
    expectedArgKinds: spec.expectedArgKinds,
  };
}
