import { supabase } from '../config/database';
import logger from '../config/logger';
import crypto from 'crypto';

export interface SignerLease {
  channelId: string;
  instanceId: string;
  leaseAcquiredAt: Date;
  leaseExpiresAt: Date;
  lastNonceAllocated: number;
}

export interface LeaseAcquisitionResult {
  success: boolean;
  currentNonce: number;
  leaseExpiresAt: Date;
  message: string;
}

export interface NonceAllocationResult {
  success: boolean;
  nonce: number;
  message: string;
}

/**
 * ChannelSignerLeaseService
 * 
 * Manages exclusive signing leases per channel to prevent concurrent state signing.
 * This is part of the solution to prevent duplicate nonces when multiple engine instances
 * attempt to sign states for the same channel concurrently.
 * 
 * Key features:
 * - Single active signer per channel via database-backed lease
 * - Bounded lease term with automatic expiry
 * - Atomic nonce allocation tied to lease ownership
 * - Stale lease detection and takeover
 */
export class ChannelSignerLeaseService {
  private readonly instanceId: string;
  private readonly defaultLeaseDurationSeconds: number = 30;

  constructor() {
    // Generate a unique instance ID for this process
    this.instanceId = `instance-${crypto.randomBytes(8).toString('hex')}-${process.pid}`;
    logger.info('Channel signer lease service initialized', { instanceId: this.instanceId });
  }

  /**
   * Get the current instance ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Attempts to acquire or renew a signing lease for a channel
   * 
   * @param channelId - The channel ID to acquire lease for
   * @param leaseDurationSeconds - Duration of the lease (default: 30 seconds)
   * @returns LeaseAcquisitionResult indicating success and current nonce
   */
  async acquireLease(
    channelId: string,
    leaseDurationSeconds: number = this.defaultLeaseDurationSeconds
  ): Promise<LeaseAcquisitionResult> {
    try {
      const { data, error } = await supabase.rpc('acquire_channel_signer_lease', {
        p_channel_id: channelId,
        p_instance_id: this.instanceId,
        p_lease_duration_seconds: leaseDurationSeconds,
      });

      if (error) {
        logger.error('Failed to acquire signer lease', { 
          channelId, 
          instanceId: this.instanceId, 
          error 
        });
        throw error;
      }

      const result = data[0];
      
      logger.info('Signer lease acquisition attempt', {
        channelId,
        instanceId: this.instanceId,
        success: result.success,
        message: result.message,
        currentNonce: result.current_nonce,
      });

      return {
        success: result.success,
        currentNonce: result.current_nonce,
        leaseExpiresAt: new Date(result.lease_expires_at),
        message: result.message,
      };
    } catch (error) {
      logger.error('Exception acquiring signer lease', { channelId, instanceId: this.instanceId, error });
      throw error;
    }
  }

  /**
   * Atomically allocates the next nonce for signing
   * Verifies lease ownership and validity before allocation
   * 
   * @param channelId - The channel ID to allocate nonce for
   * @returns NonceAllocationResult with allocated nonce or failure reason
   */
  async allocateNonce(channelId: string): Promise<NonceAllocationResult> {
    try {
      const { data, error } = await supabase.rpc('allocate_next_nonce', {
        p_channel_id: channelId,
        p_instance_id: this.instanceId,
      });

      if (error) {
        logger.error('Failed to allocate nonce', { 
          channelId, 
          instanceId: this.instanceId, 
          error 
        });
        throw error;
      }

      const result = data[0];

      if (!result.success) {
        logger.warn('Nonce allocation rejected', {
          channelId,
          instanceId: this.instanceId,
          reason: result.message,
        });
      } else {
        logger.info('Nonce allocated', {
          channelId,
          instanceId: this.instanceId,
          nonce: result.nonce,
        });
      }

      return {
        success: result.success,
        nonce: result.nonce,
        message: result.message,
      };
    } catch (error) {
      logger.error('Exception allocating nonce', { channelId, instanceId: this.instanceId, error });
      throw error;
    }
  }

  /**
   * Releases a signing lease held by this instance
   * 
   * @param channelId - The channel ID to release lease for
   * @returns true if lease was successfully released
   */
  async releaseLease(channelId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('release_channel_signer_lease', {
        p_channel_id: channelId,
        p_instance_id: this.instanceId,
      });

      if (error) {
        logger.error('Failed to release signer lease', { 
          channelId, 
          instanceId: this.instanceId, 
          error 
        });
        throw error;
      }

      const released = data as boolean;

      if (released) {
        logger.info('Signer lease released', { channelId, instanceId: this.instanceId });
      } else {
        logger.warn('Signer lease release failed - not owned by this instance', { 
          channelId, 
          instanceId: this.instanceId 
        });
      }

      return released;
    } catch (error) {
      logger.error('Exception releasing signer lease', { channelId, instanceId: this.instanceId, error });
      throw error;
    }
  }

  /**
   * Attempts to sign a channel state with lease protection
   * This is a safe wrapper that ensures:
   * 1. Lease is held before signing
   * 2. Nonce is atomically allocated
   * 3. Signing fails if lease is lost
   * 
   * @param channelId - The channel ID
   * @param signFn - Function that performs the actual signing given a nonce
   * @returns The signed state or throws if lease check fails
   */
  async signWithLease<T>(
    channelId: string,
    signFn: (nonce: number) => Promise<T>
  ): Promise<T> {
    // First, try to acquire or renew the lease
    const leaseResult = await this.acquireLease(channelId);
    
    if (!leaseResult.success) {
      throw new Error(`Cannot sign: ${leaseResult.message}`);
    }

    // Allocate a nonce atomically
    const nonceResult = await this.allocateNonce(channelId);
    
    if (!nonceResult.success) {
      throw new Error(`Cannot allocate nonce: ${nonceResult.message}`);
    }

    // Perform the signing with the allocated nonce
    try {
      return await signFn(nonceResult.nonce);
    } catch (error) {
      logger.error('Signing failed after nonce allocation', {
        channelId,
        instanceId: this.instanceId,
        nonce: nonceResult.nonce,
        error,
      });
      throw error;
    }
  }

  /**
   * Checks if this instance currently holds a valid lease for a channel
   * 
   * @param channelId - The channel ID to check
   * @returns true if this instance holds a valid lease
   */
  async holdsLease(channelId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('channel_signer_lease')
        .select('instance_id, lease_expires_at')
        .eq('channel_id', channelId)
        .single();

      if (error || !data) {
        return false;
      }

      const isOwnedByThisInstance = data.instance_id === this.instanceId;
      const isNotExpired = new Date(data.lease_expires_at) > new Date();

      return isOwnedByThisInstance && isNotExpired;
    } catch (error) {
      logger.error('Exception checking lease ownership', { channelId, instanceId: this.instanceId, error });
      return false;
    }
  }
}

export const channelSignerLeaseService = new ChannelSignerLeaseService();
