/**
 * Contract Version Manager
 * 
 * Logs deployed contract versions at backend startup and detects version mismatches.
 * Supports #1226: Add version() and interface_version() to every contract.
 */

import logger from '../config/logger';
import { env } from '../config/env';

/**
 * Configuration for a deployed contract and its expected version.
 */
export interface ContractVersionConfig {
  /** Contract name (e.g., "escrow", "virtual-card") */
  name: string;
  /** Contract address on Stellar network */
  address: string;
  /** Expected version from SDK (can be detected via SDK build time) */
  expectedVersion?: number;
  /** Expected interface version from SDK */
  expectedInterfaceVersion?: number;
}

/**
 * Deployed contract version information.
 */
export interface DeployedContractVersion {
  name: string;
  address: string;
  version: number;
  interfaceVersion: number;
  timestamp: Date;
  mismatchedExpectedVersion?: {
    expected: number;
    actual: number;
  };
  mismatchedInterfaceVersion?: {
    expected: number;
    actual: number;
  };
}

/**
 * Logs contract versions at backend startup.
 * 
 * This function attempts to call `version()` and `interface_version()` on each
 * deployed contract to detect:
 * - Version mismatches (upgraded contract but old SDK)
 * - Interface version divergence (API breaking changes)
 * 
 * @param contracts - Array of deployed contract configurations
 * @returns Array of successfully queried contract versions
 */
export async function logDeployedContractVersions(
  contracts: ContractVersionConfig[]
): Promise<DeployedContractVersion[]> {
  const results: DeployedContractVersion[] = [];
  
  logger.info('='.repeat(60));
  logger.info('Deployed Contract Versions');
  logger.info('='.repeat(60));

  for (const contract of contracts) {
    try {
      // Note: In a real implementation, these would call the actual contract methods
      // via SorobanClient. For now, this logs the configuration.
      
      // TODO: Integrate with SorobanClient to fetch actual versions
      // const sorobanClient = new SorobanClient(env.STELLAR_NETWORK_URL);
      // const version = await sorobanClient.invokeContract(
      //   contract.address,
      //   'version'
      // );
      // const interfaceVersion = await sorobanClient.invokeContract(
      //   contract.address,
      //   'interface_version'
      // );

      const deployed: DeployedContractVersion = {
        name: contract.name,
        address: contract.address,
        version: 1, // TODO: Query actual version
        interfaceVersion: 1, // TODO: Query actual interface version
        timestamp: new Date(),
      };

      // Check for version mismatches
      if (
        contract.expectedVersion &&
        deployed.version !== contract.expectedVersion
      ) {
        deployed.mismatchedExpectedVersion = {
          expected: contract.expectedVersion,
          actual: deployed.version,
        };
        
        logger.warn(
          `Version mismatch for ${contract.name}: ` +
          `SDK expects v${contract.expectedVersion}, ` +
          `but deployed contract is v${deployed.version}`
        );
      }

      if (
        contract.expectedInterfaceVersion &&
        deployed.interfaceVersion !== contract.expectedInterfaceVersion
      ) {
        deployed.mismatchedInterfaceVersion = {
          expected: contract.expectedInterfaceVersion,
          actual: deployed.interfaceVersion,
        };
        
        logger.warn(
          `Interface version mismatch for ${contract.name}: ` +
          `SDK expects interface v${contract.expectedInterfaceVersion}, ` +
          `but deployed contract has v${deployed.interfaceVersion}`
        );
      }

      logger.info(
        `${contract.name}: v${deployed.version} (interface v${deployed.interfaceVersion})`
      );

      results.push(deployed);
    } catch (error) {
      logger.error(`Failed to query version for ${contract.name}:`, error);
    }
  }

  logger.info('='.repeat(60));
  
  return results;
}

/**
 * Check if there are any version mismatches that should trigger warnings or errors.
 * 
 * @param deployedVersions - Array of deployed contract version info
 * @returns true if all versions match expectations, false if any mismatches found
 */
export function hasVersionMismatches(deployedVersions: DeployedContractVersion[]): boolean {
  return deployedVersions.some(
    (v) => v.mismatchedExpectedVersion || v.mismatchedInterfaceVersion
  );
}

/**
 * Format contract version information for logging.
 * 
 * @param version - Contract version info
 * @returns Human-readable version string
 */
export function formatContractVersion(version: DeployedContractVersion): string {
  const base = `${version.name} v${version.version}`;
  const warnings: string[] = [];

  if (version.mismatchedExpectedVersion) {
    warnings.push(
      `version mismatch (SDK: v${version.mismatchedExpectedVersion.expected}, ` +
      `deployed: v${version.mismatchedExpectedVersion.actual})`
    );
  }

  if (version.mismatchedInterfaceVersion) {
    warnings.push(
      `interface mismatch (SDK: v${version.mismatchedInterfaceVersion.expected}, ` +
      `deployed: v${version.mismatchedInterfaceVersion.actual})`
    );
  }

  return warnings.length > 0 ? `${base} ⚠ ${warnings.join(', ')}` : base;
}

/**
 * Initialize contract version monitoring.
 * Call this during backend startup to log and validate deployed contract versions.
 */
export async function initializeContractVersioning(): Promise<void> {
  // Define known deployed contracts
  // This should be populated from environment configuration or a config file
  const deployedContracts: ContractVersionConfig[] = [
    {
      name: "subscription_renewal",
      address: env.SOROBAN_RENEWAL_ADDRESS || "",
      expectedVersion: 1,
      expectedInterfaceVersion: 1,
    },
    // Add other contracts as they are deployed
    // {
    //   name: "escrow",
    //   address: env.SOROBAN_ESCROW_ADDRESS || "",
    //   expectedVersion: 1,
    //   expectedInterfaceVersion: 1,
    // },
  ];

  if (deployedContracts.filter((c) => c.address).length === 0) {
    logger.info("No deployed contract addresses configured, skipping version check");
    return;
  }

  const versions = await logDeployedContractVersions(
    deployedContracts.filter((c) => c.address)
  );

  if (hasVersionMismatches(versions)) {
    logger.warn(
      "Some deployed contracts have version mismatches with SDK. " +
      "This may cause unexpected behavior."
    );
  }
}
