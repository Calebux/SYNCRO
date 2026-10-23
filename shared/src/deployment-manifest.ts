/**
 * Deployment manifest types and utilities
 * 
 * This module provides type-safe access to contract deployment information
 * across backend, SDK, and client applications.
 */

export interface ContractDeployment {
  contract_id: string | null;
  wasm_hash: string | null;
  version: string | null;
}

export interface DeploymentManifest {
  network: 'testnet' | 'mainnet';
  deployed_at: string | null;
  deployed_ledger: number | null;
  deployer_address: string | null;
  commit_sha: string | null;
  contracts: {
    zk_payment_verifier: ContractDeployment;
    contract_upgrade: ContractDeployment;
  };
}

export type NetworkName = 'testnet' | 'mainnet';

/**
 * Load deployment manifest for a specific network
 * @param network - The network to load ('testnet' or 'mainnet')
 * @returns Deployment manifest for the specified network
 */
export function loadDeploymentManifest(network: NetworkName): DeploymentManifest {
  // Dynamic import based on network
  // In actual implementation, this would use require() or fs.readFileSync()
  // depending on the runtime environment (Node.js vs browser)
  try {
    // Path is relative from the shared package root
    const manifest = require(`../../../deployments/${network}.json`) as DeploymentManifest;
    return manifest;
  } catch (error) {
    throw new Error(`Failed to load deployment manifest for ${network}: ${error}`);
  }
}

/**
 * Get contract ID for a specific contract on a network
 */
export function getContractId(
  network: NetworkName,
  contractName: keyof DeploymentManifest['contracts']
): string {
  const manifest = loadDeploymentManifest(network);
  const contractId = manifest.contracts[contractName]?.contract_id;
  
  if (!contractId) {
    throw new Error(`Contract ID not found for ${contractName} on ${network}`);
  }
  
  return contractId;
}

/**
 * Validate that all required contract deployments are present
 */
export function validateDeployment(manifest: DeploymentManifest): boolean {
  const requiredContracts: (keyof DeploymentManifest['contracts'])[] = [
    'zk_payment_verifier',
    'contract_upgrade',
  ];

  for (const contractName of requiredContracts) {
    const contract = manifest.contracts[contractName];
    if (!contract?.contract_id || !contract?.wasm_hash) {
      console.error(`Missing deployment info for ${contractName}`);
      return false;
    }
  }

  return true;
}
