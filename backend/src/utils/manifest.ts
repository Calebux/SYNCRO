import fs from 'fs';
import path from 'path';

export interface DeploymentManifest {
  network: string;
  sorobanContractAddress?: string | null;
  sorobanRpcUrl?: string | null;
  stellarNetworkUrl?: string | null;
  deployedAt?: string | null;
  commitSha?: string | null;
}

/**
 * Resolve the canonical manifest path for a network.
 * Searches at repo root: /deploy/manifests/<network>.json
 */
export function resolveManifestPath(network: string): string {
  return path.resolve(__dirname, '..', '..', '..', 'deploy', 'manifests', `${network}.json`);
}

/**
 * Load manifest for the given network if present.
 * Does not override existing env vars — only populates missing ones.
 */
export function loadManifestIntoEnv(network: string): DeploymentManifest | null {
  try {
    const manifestPath = resolveManifestPath(network);
    if (!fs.existsSync(manifestPath)) return null;

    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as DeploymentManifest;

    if (manifest.sorobanContractAddress && !process.env.SOROBAN_CONTRACT_ADDRESS) {
      process.env.SOROBAN_CONTRACT_ADDRESS = manifest.sorobanContractAddress;
    }
    if (manifest.sorobanRpcUrl && !process.env.SOROBAN_RPC_URL) {
      process.env.SOROBAN_RPC_URL = manifest.sorobanRpcUrl;
    }
    if (manifest.stellarNetworkUrl && !process.env.STELLAR_NETWORK_URL) {
      process.env.STELLAR_NETWORK_URL = manifest.stellarNetworkUrl;
    }

    return manifest;
  } catch (err) {
    // Swallow errors — manifest loading should be best-effort and non-fatal.
    return null;
  }
}
