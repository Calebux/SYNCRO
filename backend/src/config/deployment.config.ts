/**
 * Deployment configuration loader
 * 
 * Loads contract deployment information from network-specific manifest files.
 * This replaces scattered environment variables with a single source of truth.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

interface ContractDeployment {
  contract_id: string | null;
  wasm_hash: string | null;
  version: string | null;
}

interface DeploymentManifest {
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

/**
 * Load deployment manifest for the current network
 */
export function loadDeploymentConfig(): DeploymentManifest {
  const network = process.env.STELLAR_NETWORK || 'testnet';
  const manifestPath = resolve(__dirname, `../../../deployments/${network}.json`);
  
  try {
    const manifestContent = readFileSync(manifestPath, 'utf-8');
    const manifest: DeploymentManifest = JSON.parse(manifestContent);
    
    // Validate required contracts are deployed
    if (!manifest.contracts.zk_payment_verifier?.contract_id) {
      throw new Error('ZK Payment Verifier contract ID not found in deployment manifest');
    }
    
    if (!manifest.contracts.contract_upgrade?.contract_id) {
      throw new Error('Contract Upgrade contract ID not found in deployment manifest');
    }
    
    return manifest;
  } catch (error) {
    console.error(`Failed to load deployment manifest from ${manifestPath}:`, error);
    
    // Fallback to environment variables (legacy support)
    console.warn('Falling back to environment variables for contract configuration');
    
    return {
      network: network as 'testnet' | 'mainnet',
      deployed_at: null,
      deployed_ledger: null,
      deployer_address: null,
      commit_sha: null,
      contracts: {
        zk_payment_verifier: {
          contract_id: process.env.SOROBAN_ZK_VERIFIER_ADDRESS || null,
          wasm_hash: null,
          version: null,
        },
        contract_upgrade: {
          contract_id: process.env.SOROBAN_UPGRADE_ADDRESS || null,
          wasm_hash: null,
          version: null,
        },
      },
    };
  }
}

// Export contract IDs for easy access
export const deployment = loadDeploymentConfig();
export const zkVerifierContractId = deployment.contracts.zk_payment_verifier.contract_id!;
export const upgradeContractId = deployment.contracts.contract_upgrade.contract_id!;
