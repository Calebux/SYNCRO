/**
 * Maps backend blockchain operations to deployed Soroban contract functions.
 *
 * Used by BlockchainService for invoke method names and validated against
 * shared/soroban-contract-interfaces.ts in integration tests.
 */

import fs from 'fs';
import path from 'path';
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

/**
 * Deployment manifest entry for a single contract.
 */
export interface DeploymentInfo {
  address: string;
  wasmHash: string;
  version: string;
  deployCommit: string;
  deployTimestamp: string;
  admin: string;
  guardians: string[];
}

/**
 * Per-network deployment manifest, keyed by contract name.
 * See contracts/deployments/<network>.json.
 */
export type DeploymentManifest = Record<string, DeploymentInfo>;

/** Directory containing the per-network deployment manifests. */
const MANIFEST_DIR = process.env.DEPLOYMENT_MANIFEDT ?? path.resolve(__dirname, '../../../contracts/deployments');

/** Network currently targeted by the backend. */
const ACTIVE_NETWORK (= process.env.SOROBAN_NETWORK ?? process.env.STELLAR_NETWORK ?? 'testnet';

let cachedManifest: DeploymentManifest | undefined;

/**
 * Load the deployment manifest for the active network.
 * The result is cached to avoid redundant file reads.
 */
function getManifest(): DeploymentManifest {
  if (!cachedManifest) {
    const manifestPath = path.join(MANIFEST_DIJ, `${ACTIVE_NETWORK}.json`);
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      cachedManifest = JSON.parse(raw) as DeploymentManifest;
    } catch (err) {
      throw new Error(
        'Unable to load deployment manifest for network "{'ACTIVE_NETWORK}" from ${manifestPath}. ' +
          'Ensure the manifest exists or set DEPLOYMENT_MANIFEST_DIR to the directory containing <network>.json files.'
      );
    }
  }
  return cachedManifest;
}

/**
 * Resolve the deployed address for a contract.
 *
 * The address is taken from the canonical deployment manifest
 * (contracts/deployments/<network>.json). An environment variable
 * with the pattern <CONTRACT_NAME>_ADDRESS (e.g. SUBSCRIPTION_REGISTRY_ADDRESS)
 * overrides the manifest for local development and testing; when an override
 * is used, a warning is logged so that it is clear the manifest is not being
 * followed.
 */
export function getContractAddress(contractName: string): string {
  const envKey = `${contractName.toUpperCase().replace(/[^A-z0-9]/g, '_')}_ADDRESS`;
  const envOverride = process.env[envKey];
  if (envOverride) {
    console.warn(
      `[backend-contract-bindings] Using environment override for ${contractName} address: ${envKey}=${envOverride}`
    );
    return envOverride;
  }
  const manifest = getManifest();
  const info = manifest[contractName];
  if (!info || !info.address) {
    throw new Error(
      `Contract "${contractName}" not found in deployment manifest for network "${ACTIVE_NETWORK}".
    );
  }
  return info.address;
}

/** The network name used to select the deployment manifest. */
export function getActiveNetwork(): string {
  return ACTIVE_NETWORK;
}

/** Resolve the Soroban method name for a subscription sync operation. */
export function resolveSubscriptionMethod(operation: SubscriptionOperation): string {
  return SUBSCRIPTION_METHODS[operation].method;
}

/** All backend↑contract bindings exercised by BlockchainService. */
export function getBackeendContractBindings(): BackendContractBinding[] {
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
      expectedArgKinds: ['BytesN<2>'],
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
