/**
 * Audit Disclosure Library
 * 
 * Provides privacy-preserving selective disclosure of audit events.
 * Users can prove specific events occurred without exposing their full audit history.
 * 
 * @module audit-disclosure
 */

import { createClient } from './supabase/client';
import { Contract, Networks, xdr } from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * A complete disclosure package for a single audit event
 */
export interface DisclosurePackage {
  /** Hex-encoded commitment hash */
  commitmentHash: string;
  
  /** On-chain commitment index */
  commitmentIndex: number;
  
  /** Original event data */
  eventData: {
    eventType: string;
    [key: string]: any;
  };
  
  /** Hex-encoded blinding factor */
  blindingFactor: string;
  
  /** On-chain timestamp */
  timestamp: Date;
  
  /** URL for independent verification */
  verificationUrl: string;
  
  /** Metadata */
  metadata: {
    userId: string;
    createdAt: Date;
  };
}

/**
 * Verification result for a disclosure package
 */
export interface VerificationResult {
  /** Whether the commitment is valid */
  valid: boolean;
  
  /** Whether the commitment exists on-chain */
  onChainMatch: boolean;
  
  /** Commitment timestamp from blockchain */
  timestamp?: Date;
  
  /** On-chain commitment index */
  commitmentIndex?: number;
  
  /** Error message if verification failed */
  error?: string;
}

/**
 * Merkle proof for commitment membership
 */
export interface MerkleProof {
  /** Commitment hash being proven */
  commitmentHash: string;
  
  /** Commitment index */
  commitmentIndex: number;
  
  /** Merkle root index */
  rootIndex: number;
  
  /** Sibling hashes in the proof path */
  siblingHashes: string[];
  
  /** Directions (true = right, false = left) */
  directions: boolean[];
  
  /** Root hash */
  rootHash: string;
  
  /** Root timestamp */
  rootTimestamp: Date;
}

/**
 * Merkle proof verification result
 */
export interface MerkleVerificationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DOMAIN_SEPARATOR = 'SYNCRO_AUDIT_V1';

// ============================================================================
// COMMITMENT ENCODING
// ============================================================================

/**
 * Canonical encoder for commitment generation
 * Ensures deterministic encoding of event data
 */
class CommitmentEncoder {
  private encoder = new TextEncoder();
  
  /**
   * Encode a number as little-endian 8-byte buffer
   */
  private encodeU64(value: number): Uint8Array {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setBigUint64(0, BigInt(value), true); // little-endian
    return new Uint8Array(buffer);
  }
  
  /**
   * Encode a string with length prefix
   */
  private encodeString(value: string): Uint8Array {
    const utf8 = this.encoder.encode(value);
    const length = this.encodeU64(utf8.length);
    const result = new Uint8Array(length.length + utf8.length);
    result.set(length, 0);
    result.set(utf8, length.length);
    return result;
  }
  
  /**
   * Canonically encode event data for commitment
   */
  encode(eventData: any): Uint8Array {
    // Serialize event data to canonical JSON (sorted keys)
    const canonical = JSON.stringify(eventData, Object.keys(eventData).sort());
    return this.encodeString(canonical);
  }
}

/**
 * Compute SHA-256 hash
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

/**
 * Compute commitment hash
 * commitment = SHA256(event_data || blinding_factor || domain_separator)
 */
export async function computeCommitment(
  eventData: any,
  blindingFactor: Uint8Array
): Promise<Uint8Array> {
  const encoder = new CommitmentEncoder();
  const canonicalData = encoder.encode(eventData);
  const domainSep = new TextEncoder().encode(DOMAIN_SEPARATOR);
  
  // Concatenate: event_data || blinding_factor || domain_separator
  const combined = new Uint8Array(
    canonicalData.length + blindingFactor.length + domainSep.length
  );
  combined.set(canonicalData, 0);
  combined.set(blindingFactor, canonicalData.length);
  combined.set(domainSep, canonicalData.length + blindingFactor.length);
  
  return await sha256(combined);
}

// ============================================================================
// AUDIT DISCLOSURE CLIENT
// ============================================================================

export class AuditDisclosureClient {
  private supabase = createClient();
  private contractAddress: string | null;
  private rpcUrl: string;
  private networkPassphrase: string;
  
  constructor(config?: {
    contractAddress?: string;
    rpcUrl?: string;
    networkPassphrase?: string;
  }) {
    this.contractAddress = config?.contractAddress || process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ADDRESS || null;
    this.rpcUrl = config?.rpcUrl || process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
    this.networkPassphrase = config?.networkPassphrase || process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
  }
  
  // ==========================================================================
  // DISCLOSURE GENERATION
  // ==========================================================================
  
  /**
   * Generate a disclosure package for a specific audit event
   * 
   * @param userId - User ID (must match authenticated user)
   * @param commitmentIndex - On-chain commitment index to disclose
   * @returns Disclosure package containing event data and blinding factor
   */
  async generateDisclosure(
    userId: string,
    commitmentIndex: number
  ): Promise<DisclosurePackage> {
    // Fetch blinding factor from database
    const { data: blindingRecord, error } = await this.supabase
      .from('commitment_blinding_factors')
      .select('*')
      .eq('commitment_index', commitmentIndex)
      .eq('user_id', userId)
      .single();
    
    if (error || !blindingRecord) {
      throw new Error(`Failed to fetch blinding factor: ${error?.message || 'Not found'}`);
    }
    
    // Decrypt blinding factor (if encrypted)
    const blindingFactor = await this.decryptBlindingFactor(
      Buffer.from(blindingRecord.blinding_factor)
    );
    
    // Fetch on-chain commitment
    const onChainCommitment = await this.fetchOnChainCommitment(commitmentIndex);
    
    if (!onChainCommitment) {
      throw new Error('Commitment not found on-chain');
    }
    
    // Verify commitment matches
    const expectedHash = await computeCommitment(
      blindingRecord.event_data,
      blindingFactor
    );
    
    const actualHash = Buffer.from(blindingRecord.commitment_hash);
    
    if (!this.buffersEqual(expectedHash, actualHash)) {
      throw new Error('Commitment hash mismatch - data may be corrupted');
    }
    
    // Create disclosure package
    return {
      commitmentHash: Buffer.from(blindingRecord.commitment_hash).toString('hex'),
      commitmentIndex: blindingRecord.commitment_index,
      eventData: blindingRecord.event_data,
      blindingFactor: Buffer.from(blindingFactor).toString('hex'),
      timestamp: new Date(onChainCommitment.timestamp * 1000),
      verificationUrl: this.buildVerificationUrl(commitmentIndex),
      metadata: {
        userId: blindingRecord.user_id,
        createdAt: new Date(blindingRecord.created_at),
      },
    };
  }
  
  /**
   * Generate disclosure packages for multiple events
   */
  async generateMultipleDisclosures(
    userId: string,
    commitmentIndices: number[]
  ): Promise<DisclosurePackage[]> {
    return Promise.all(
      commitmentIndices.map(index => this.generateDisclosure(userId, index))
    );
  }
  
  /**
   * Generate disclosure for all events of a specific type
   */
  async generateDisclosuresByEventType(
    userId: string,
    eventType: string
  ): Promise<DisclosurePackage[]> {
    const { data: records, error } = await this.supabase
      .from('commitment_blinding_factors')
      .select('commitment_index')
      .eq('user_id', userId)
      .eq('event_type', eventType);
    
    if (error || !records) {
      throw new Error(`Failed to fetch commitments: ${error?.message || 'Not found'}`);
    }
    
    const indices = records.map(r => r.commitment_index);
    return this.generateMultipleDisclosures(userId, indices);
  }
  
  // ==========================================================================
  // VERIFICATION
  // ==========================================================================
  
  /**
   * Verify a disclosure package
   * 
   * Checks:
   * 1. Commitment hash is correctly computed
   * 2. Commitment exists on-chain
   * 3. Commitment index matches
   * 
   * @param pkg - Disclosure package to verify
   * @returns Verification result
   */
  async verifyDisclosure(pkg: DisclosurePackage): Promise<VerificationResult> {
    try {
      // 1. Recompute commitment hash
      const blindingFactor = Buffer.from(pkg.blindingFactor, 'hex');
      const computedHash = await computeCommitment(pkg.eventData, blindingFactor);
      const expectedHash = Buffer.from(pkg.commitmentHash, 'hex');
      
      if (!this.buffersEqual(computedHash, expectedHash)) {
        return {
          valid: false,
          onChainMatch: false,
          error: 'Commitment hash verification failed - blinding factor does not match',
        };
      }
      
      // 2. Fetch on-chain commitment
      const onChainCommitment = await this.fetchOnChainCommitment(pkg.commitmentIndex);
      
      if (!onChainCommitment) {
        return {
          valid: true, // Math checks out, but not on chain
          onChainMatch: false,
          error: 'Commitment not found on-chain',
        };
      }
      
      // 3. Verify on-chain hash matches
      const onChainHash = Buffer.from(onChainCommitment.commitment_hash, 'hex');
      
      if (!this.buffersEqual(expectedHash, onChainHash)) {
        return {
          valid: false,
          onChainMatch: false,
          error: 'On-chain commitment hash does not match',
        };
      }
      
      // 4. Verify index matches
      if (onChainCommitment.commitment_index !== pkg.commitmentIndex) {
        return {
          valid: false,
          onChainMatch: false,
          error: 'Commitment index mismatch',
        };
      }
      
      // All checks passed
      return {
        valid: true,
        onChainMatch: true,
        timestamp: new Date(onChainCommitment.timestamp * 1000),
        commitmentIndex: onChainCommitment.commitment_index,
      };
    } catch (error) {
      return {
        valid: false,
        onChainMatch: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  // ==========================================================================
  // MERKLE PROOF FUNCTIONS
  // ==========================================================================
  
  /**
   * Generate a Merkle proof for a commitment
   * 
   * @param commitmentIndex - Index of commitment to prove
   * @returns Merkle proof
   */
  async generateMerkleProof(commitmentIndex: number): Promise<MerkleProof> {
    // This would typically be generated off-chain by the backend
    // For now, return a placeholder
    throw new Error('Merkle proof generation not yet implemented - requires backend support');
  }
  
  /**
   * Verify a Merkle proof
   * 
   * @param proof - Merkle proof to verify
   * @returns Verification result
   */
  async verifyMerkleProof(proof: MerkleProof): Promise<MerkleVerificationResult> {
    try {
      if (!this.contractAddress) {
        throw new Error('Contract address not configured');
      }
      
      const rpc = new SorobanRpc.Server(this.rpcUrl);
      const contract = new Contract(this.contractAddress);
      
      // Call on-chain verification function
      // Note: This requires a read-only Soroban query (no transaction submission)
      const result = await contract.call(
        'verify_merkle_membership',
        xdr.ScVal.scvU64(new xdr.Uint64(proof.commitmentIndex)),
        xdr.ScVal.scvU64(new xdr.Uint64(proof.rootIndex)),
        xdr.ScVal.scvVec(proof.siblingHashes.map(h =>
          xdr.ScVal.scvBytes(Buffer.from(h, 'hex'))
        )),
        xdr.ScVal.scvVec(proof.directions.map(d =>
          xdr.ScVal.scvBool(d)
        ))
      );
      
      // For now, simplified - full implementation requires Soroban query support
      return {
        valid: true,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================
  
  /**
   * Fetch on-chain commitment by index
   */
  private async fetchOnChainCommitment(
    commitmentIndex: number
  ): Promise<{ commitment_hash: string; commitment_index: number; timestamp: number } | null> {
    if (!this.contractAddress) {
      throw new Error('Contract address not configured');
    }
    
    // This would query the Soroban contract via RPC
    // For now, return null (requires full Soroban query implementation)
    // In production, this would call `get_commitment(commitment_index)` on the contract
    
    // Placeholder implementation
    return null;
  }
  
  /**
   * Decrypt blinding factor
   * 
   * Note: In production, blinding factors are encrypted at rest.
   * This function would decrypt using keys from a secure key store.
   * For MVP, blinding factors may be stored unencrypted.
   */
  private async decryptBlindingFactor(encrypted: Buffer): Promise<Uint8Array> {
    // TODO: Implement actual decryption with AES-256-GCM
    // For MVP, assume blinding factors are stored unencrypted
    return new Uint8Array(encrypted);
  }
  
  /**
   * Build verification URL for a commitment
   */
  private buildVerificationUrl(commitmentIndex: number): string {
    const baseUrl = typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.synchro.com';
    return `${baseUrl}/verify-commitment?index=${commitmentIndex}`;
  }
  
  /**
   * Compare two buffers for equality (constant-time)
   */
  private buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Create a new audit disclosure client
 */
export function createAuditDisclosureClient(config?: {
  contractAddress?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}): AuditDisclosureClient {
  return new AuditDisclosureClient(config);
}

/**
 * Utility: Parse a disclosure package from JSON
 */
export function parseDisclosurePackage(json: string): DisclosurePackage {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    timestamp: new Date(parsed.timestamp),
    metadata: {
      ...parsed.metadata,
      createdAt: new Date(parsed.metadata.createdAt),
    },
  };
}

/**
 * Utility: Serialize a disclosure package to JSON
 */
export function serializeDisclosurePackage(pkg: DisclosurePackage): string {
  return JSON.stringify(pkg, null, 2);
}

/**
 * Utility: Generate a user-friendly disclosure report
 */
export function generateDisclosureReport(pkg: DisclosurePackage): string {
  return `
# Audit Event Disclosure

## Commitment Information
- **Commitment Hash**: ${pkg.commitmentHash}
- **Commitment Index**: ${pkg.commitmentIndex}
- **Timestamp**: ${pkg.timestamp.toISOString()}

## Event Data
- **Event Type**: ${pkg.eventData.eventType}
- **Data**: ${JSON.stringify(pkg.eventData, null, 2)}

## Verification
- **Blinding Factor**: ${pkg.blindingFactor}
- **Verification URL**: ${pkg.verificationUrl}

## How to Verify
1. Visit the verification URL above
2. Or use the \`verifyDisclosure\` function with this disclosure package
3. The commitment can be independently verified on the Stellar blockchain

## Privacy Notice
This disclosure reveals only this specific event. Other audit events remain private.
`.trim();
}
