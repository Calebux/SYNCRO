/**
 * TTL-specific contract helper methods.
 *
 * Provides safe, idempotent contract invocations for:
 * - extend_ttl: Extend a contract entry's time-to-live
 * - get_ttl: Read the current TTL of a contract entry
 * - mark_archived: Mark an entry as archived with snapshot hash proof
 *
 * These methods wrap the core BlockchainService.invokeContractWithRetry()
 * to enforce TTL-specific validation and error handling.
 */

import logger from '../config/logger';
import { xdr } from '@stellar/stellar-sdk';

export interface ExtendTTLResult {
  success: boolean;
  txHash?: string;
  sequence?: number;
  newTtl?: number;
  error?: string;
  durationMs: number;
}

export interface GetTTLResult {
  success: boolean;
  ttl?: number;
  error?: string;
  durationMs: number;
}

export interface MarkArchivedResult {
  success: boolean;
  txHash?: string;
  sequence?: number;
  error?: string;
  durationMs: number;
}

/**
 * Contract entrypoint names for TTL operations.
 * These must match the contract's Soroban interface.
 */
export const TTL_CONTRACT_METHODS = {
  extendTTL: 'extend_ttl',
  getTTL: 'get_ttl',
  markArchived: 'mark_archived',
} as const;

/**
 * Validates that an entry key is a valid contract storage key.
 */
export function validateEntryKey(entryKey: string): boolean {
  // Entry key should be a hex string of even length (represents bytes)
  if (typeof entryKey !== 'string') {
    return false;
  }
  // Allow 0x prefix or raw hex
  const hex = entryKey.startsWith('0x') ? entryKey.slice(2) : entryKey;
  return /^[0-9a-fA-F]*$/.test(hex) && hex.length > 0 && hex.length % 2 === 0;
}

/**
 * Validates that a TTL (ledger sequence) is a positive integer.
 */
export function validateTTL(ttl: number): boolean {
  return Number.isInteger(ttl) && ttl > 0;
}

/**
 * Validates that a snapshot hash is a valid SHA-256 hex string.
 */
export function validateSnapshotHash(hash: string): boolean {
  if (typeof hash !== 'string') {
    return false;
  }
  const hex = hash.startsWith('0x') ? hash.slice(2) : hash;
  // SHA-256 produces 32 bytes = 64 hex characters
  return /^[0-9a-fA-F]{64}$/.test(hex);
}

/**
 * Convert a hex string to xdr.ScVal.scvBytes().
 */
export function hexToScvBytes(hex: string): xdr.ScVal {
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  const buffer = Buffer.from(cleaned, 'hex');
  return xdr.ScVal.scvBytes(buffer);
}

/**
 * Convert a number to xdr.ScVal.scvU64().
 */
export function numberToScvU64(value: number): xdr.ScVal {
  if (!validateTTL(value)) {
    throw new Error(`Invalid TTL value: ${value}`);
  }
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(value)));
}

/**
 * Extract a u64 value from an xdr.ScVal result.
 */
export function extractU64FromScVal(scval: xdr.ScVal): number {
  if (scval.switch().name !== 'scvU64') {
    throw new Error(`Expected ScVal type u64, got ${scval.switch().name}`);
  }
  const u64val = scval.u64();
  if (!u64val) {
    throw new Error('Failed to extract u64 from ScVal');
  }
  return parseInt(u64val.toString(), 10);
}

/**
 * Prepare arguments for extend_ttl contract call.
 * Args: entry_key (Bytes), new_ttl (u64)
 */
export function prepareExtendTTLArgs(entryKey: string, newTtl: number): xdr.ScVal[] {
  if (!validateEntryKey(entryKey)) {
    throw new Error(`Invalid entry key: ${entryKey}`);
  }
  if (!validateTTL(newTtl)) {
    throw new Error(`Invalid TTL value: ${newTtl}`);
  }

  return [hexToScvBytes(entryKey), numberToScvU64(newTtl)];
}

/**
 * Prepare arguments for get_ttl contract call.
 * Args: entry_key (Bytes)
 */
export function prepareGetTTLArgs(entryKey: string): xdr.ScVal[] {
  if (!validateEntryKey(entryKey)) {
    throw new Error(`Invalid entry key: ${entryKey}`);
  }

  return [hexToScvBytes(entryKey)];
}

/**
 * Prepare arguments for mark_archived contract call.
 * Args: entry_key (Bytes), snapshot_hash (Bytes)
 */
export function prepareMarkArchivedArgs(entryKey: string, snapshotHash: string): xdr.ScVal[] {
  if (!validateEntryKey(entryKey)) {
    throw new Error(`Invalid entry key: ${entryKey}`);
  }
  if (!validateSnapshotHash(snapshotHash)) {
    throw new Error(`Invalid snapshot hash: ${snapshotHash}`);
  }

  return [hexToScvBytes(entryKey), hexToScvBytes(snapshotHash)];
}

/**
 * Parse transaction details from a Soroban RPC response.
 * Extracts transaction hash and ledger sequence.
 */
export function parseTransactionResult(
  txHash: string,
  rpcResponse: any,
): { sequence: number } {
  // Extract sequence from RPC response or fallback to 0
  // In production, this would parse the actual ledger sequence from the confirmed transaction
  const sequence = rpcResponse?.ledger_sequence || 0;
  return { sequence };
}

/**
 * Estimate gas cost for an extend_ttl operation.
 * Returns approximate gas units for budgeting.
 */
export function estimateExtendTTLGas(): number {
  // Soroban extend_ttl typically costs 500-1000 gas depending on contract implementation
  // Conservative estimate: 1000 gas
  return 1000;
}

/**
 * Estimate gas cost for a get_ttl operation.
 * Returns approximate gas units for budgeting.
 */
export function estimateGetTTLGas(): number {
  // Soroban read operations typically cost 100-300 gas
  // Conservative estimate: 300 gas
  return 300;
}

/**
 * Estimate gas cost for a mark_archived operation.
 * Returns approximate gas units for budgeting.
 */
export function estimateMarkArchivedGas(): number {
  // Soroban mark_archived typically costs 1000-2000 gas (write operation)
  // Conservative estimate: 2000 gas
  return 2000;
}

/**
 * Idempotency check for extend_ttl.
 * If new_ttl <= current_ttl, the operation is a no-op.
 * This method determines if the operation should be skipped.
 */
export function shouldSkipExtendTTL(currentTtl: number, newTtl: number): boolean {
  // Only extend if new_ttl > currentTtl (idempotent contract requirement)
  return newTtl <= currentTtl;
}

export const TTL_CONTRACT_HELPERS = {
  validateEntryKey,
  validateTTL,
  validateSnapshotHash,
  hexToScvBytes,
  numberToScvU64,
  extractU64FromScVal,
  prepareExtendTTLArgs,
  prepareGetTTLArgs,
  prepareMarkArchivedArgs,
  parseTransactionResult,
  estimateExtendTTLGas,
  estimateGetTTLGas,
  estimateMarkArchivedGas,
  shouldSkipExtendTTL,
};
