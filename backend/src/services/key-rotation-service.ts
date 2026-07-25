import { supabase } from '../config/database';
import { deriveKeyHex } from '../../../shared/src/crypto/key-derivation';
import logger from '../config/logger';

export interface KeyRotationInitResult {
  success: boolean;
  rotationId?: string;
  totalSubscriptions: number;
  error?: string;
}

export interface KeyRotationProgressResult {
  inProgress: boolean;
  totalSubscriptions: number;
  completedSubscriptions: number;
  failedSubscriptions: number;
  percentComplete: number;
  oldWalletPublicKey?: string;
  newWalletPublicKey?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ReEncryptionResult {
  success: boolean;
  subscriptionId: string;
  error?: string;
}

/**
 * Service to handle encryption key rotation when user changes wallet
 */
export class KeyRotationService {
  /**
   * Derives an encryption key from a Stellar wallet public key using HKDF-SHA256
   */
  private deriveEncryptionKeyFromWallet(
    publicKey: string,
    salt: string = 'syncro-encryption'
  ): string {
    const encoder = new TextEncoder();
    const saltBytes = encoder.encode(salt);
    const info = encoder.encode('subscription-metadata-encryption-v1');

    return deriveKeyHex(publicKey, {
      salt: saltBytes,
      info: info,
      length: 32,
    });
  }

  /**
   * Initialize key rotation process when user changes wallet
   */
  async initiateKeyRotation(
    userId: string,
    oldWalletPublicKey: string,
    newWalletPublicKey: string
  ): Promise<KeyRotationInitResult> {
    try {
      // 1. Get all encrypted subscriptions for user
      const { data: subscriptions, error: fetchError } = await supabase
        .from('subscriptions')
        .select('id, is_encrypted')
        .eq('user_id', userId)
        .eq('is_encrypted', true);

      if (fetchError) {
        logger.error('Error fetching subscriptions for key rotation:', fetchError);
        return {
          success: false,
          totalSubscriptions: 0,
          error: 'Failed to fetch subscriptions',
        };
      }

      const totalSubscriptions = subscriptions?.length || 0;

      // 2. Update user preferences to mark rotation in progress
      const { error: prefsError } = await supabase
        .from('user_preferences')
        .update({
          previous_wallet_public_key: oldWalletPublicKey,
          rotation_in_progress: true,
          rotation_started_at: new Date().toISOString(),
          rotation_completed_at: null,
        })
        .eq('user_id', userId);

      if (prefsError) {
        logger.error('Error updating user preferences for key rotation:', prefsError);
        return {
          success: false,
          totalSubscriptions: 0,
          error: 'Failed to start rotation',
        };
      }

      // 3. Create progress tracking records for each subscription
      if (totalSubscriptions > 0) {
        const progressRecords = subscriptions!.map(sub => ({
          user_id: userId,
          subscription_id: sub.id,
          status: 'pending',
          old_wallet_public_key: oldWalletPublicKey,
          new_wallet_public_key: newWalletPublicKey,
        }));

        const { error: progressError } = await supabase
          .from('subscription_reencryption_progress')
          .upsert(progressRecords, {
            onConflict: 'user_id, subscription_id, new_wallet_public_key',
            ignoreDuplicates: false,
          });

        if (progressError) {
          logger.error('Error creating progress records:', progressError);
          return {
            success: false,
            totalSubscriptions: 0,
            error: 'Failed to initialize progress tracking',
          };
        }
      }

      logger.info('Key rotation initiated', {
        userId,
        totalSubscriptions,
        oldWallet: oldWalletPublicKey.substring(0, 10) + '...',
        newWallet: newWalletPublicKey.substring(0, 10) + '...',
      });

      return {
        success: true,
        totalSubscriptions,
      };
    } catch (error) {
      logger.error('Error initiating key rotation:', error);
      return {
        success: false,
        totalSubscriptions: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Re-encrypt a single subscription with new key derived from new wallet
   */
  async reEncryptSubscription(
    userId: string,
    subscriptionId: string,
    oldEncryptionKey: string,
    newEncryptionKey: string
  ): Promise<ReEncryptionResult> {
    try {
      // 1. Update progress status to in_progress
      await supabase
        .from('subscription_reencryption_progress')
        .update({
          status: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('subscription_id', subscriptionId);

      // 2. Fetch encrypted subscription data
      const { data: subscription, error: fetchError } = await supabase
        .from('subscriptions')
        .select('id, encrypted_name, encrypted_price, encrypted_category, encrypted_renewal_url')
        .eq('id', subscriptionId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !subscription) {
        throw new Error('Failed to fetch subscription data');
      }

      // 3. Decrypt with old key and re-encrypt with new key
      // Note: The actual encryption/decryption is done client-side
      // This service coordinates the process and tracks progress

      // 4. Mark as completed (actual re-encryption done client-side)
      const { error: progressError } = await supabase
        .from('subscription_reencryption_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('subscription_id', subscriptionId);

      if (progressError) {
        throw new Error('Failed to update progress');
      }

      return {
        success: true,
        subscriptionId,
      };
    } catch (error) {
      logger.error('Error re-encrypting subscription:', error);

      // Mark as failed
      await supabase
        .from('subscription_reencryption_progress')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('subscription_id', subscriptionId);

      return {
        success: false,
        subscriptionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get key rotation progress for a user
   */
  async getRotationProgress(userId: string): Promise<KeyRotationProgressResult> {
    try {
      // Check if rotation is in progress
      const { data: prefs, error: prefsError } = await supabase
        .from('user_preferences')
        .select(
          'rotation_in_progress, rotation_started_at, rotation_completed_at, previous_wallet_public_key'
        )
        .eq('user_id', userId)
        .single();

      if (prefsError || !prefs) {
        return {
          inProgress: false,
          totalSubscriptions: 0,
          completedSubscriptions: 0,
          failedSubscriptions: 0,
          percentComplete: 100,
        };
      }

      if (!prefs.rotation_in_progress) {
        return {
          inProgress: false,
          totalSubscriptions: 0,
          completedSubscriptions: 0,
          failedSubscriptions: 0,
          percentComplete: 100,
        };
      }

      // Get progress details
      const { data: progressRecords, error: progressError } = await supabase
        .from('subscription_reencryption_progress')
        .select('status, old_wallet_public_key, new_wallet_public_key')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (progressError) {
        logger.error('Error fetching rotation progress:', progressError);
        return {
          inProgress: true,
          totalSubscriptions: 0,
          completedSubscriptions: 0,
          failedSubscriptions: 0,
          percentComplete: 0,
          startedAt: prefs.rotation_started_at,
        };
      }

      const totalSubscriptions = progressRecords?.length || 0;
      const completedSubscriptions =
        progressRecords?.filter(r => r.status === 'completed').length || 0;
      const failedSubscriptions =
        progressRecords?.filter(r => r.status === 'failed').length || 0;

      const percentComplete =
        totalSubscriptions > 0 ? Math.round((completedSubscriptions / totalSubscriptions) * 100) : 0;

      const firstRecord = progressRecords?.[0];

      return {
        inProgress: true,
        totalSubscriptions,
        completedSubscriptions,
        failedSubscriptions,
        percentComplete,
        oldWalletPublicKey: firstRecord?.old_wallet_public_key,
        newWalletPublicKey: firstRecord?.new_wallet_public_key,
        startedAt: prefs.rotation_started_at,
        completedAt: prefs.rotation_completed_at,
      };
    } catch (error) {
      logger.error('Error getting rotation progress:', error);
      return {
        inProgress: false,
        totalSubscriptions: 0,
        completedSubscriptions: 0,
        failedSubscriptions: 0,
        percentComplete: 0,
      };
    }
  }

  /**
   * Complete key rotation process
   */
  async completeKeyRotation(userId: string, newWalletPublicKey: string): Promise<boolean> {
    try {
      // 1. Derive new encryption key from new wallet
      const newEncryptionKey = this.deriveEncryptionKeyFromWallet(newWalletPublicKey);

      // 2. Update user preferences
      const { error: prefsError } = await supabase
        .from('user_preferences')
        .update({
          encryption_key: newEncryptionKey,
          rotation_in_progress: false,
          rotation_completed_at: new Date().toISOString(),
          previous_wallet_public_key: null,
          previous_encryption_key: null,
        })
        .eq('user_id', userId);

      if (prefsError) {
        logger.error('Error completing key rotation:', prefsError);
        return false;
      }

      logger.info('Key rotation completed successfully', {
        userId,
        newWallet: newWalletPublicKey.substring(0, 10) + '...',
      });

      return true;
    } catch (error) {
      logger.error('Error completing key rotation:', error);
      return false;
    }
  }

  /**
   * Cancel key rotation and revert to old wallet
   */
  async cancelKeyRotation(userId: string): Promise<boolean> {
    try {
      // 1. Delete progress records
      await supabase
        .from('subscription_reencryption_progress')
        .delete()
        .eq('user_id', userId);

      // 2. Reset rotation flags
      const { error: prefsError } = await supabase
        .from('user_preferences')
        .update({
          rotation_in_progress: false,
          rotation_started_at: null,
          rotation_completed_at: null,
          previous_wallet_public_key: null,
        })
        .eq('user_id', userId);

      if (prefsError) {
        logger.error('Error canceling key rotation:', prefsError);
        return false;
      }

      logger.info('Key rotation canceled', { userId });
      return true;
    } catch (error) {
      logger.error('Error canceling key rotation:', error);
      return false;
    }
  }
}

export const keyRotationService = new KeyRotationService();
