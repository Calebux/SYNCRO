import { stellarWallet } from './stellar-wallet';
import {
  encryptSubscriptionMetadata,
  decryptSubscriptionMetadata,
  type SubscriptionMetadata,
  type EncryptedData,
} from '../../shared/src/crypto/metadata-encryption';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface KeyRotationProgress {
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

export interface EncryptedSubscription {
  id: string;
  encrypted_name?: string;
  encrypted_price?: string;
  encrypted_category?: string;
  encrypted_renewal_url?: string;
  is_encrypted: boolean;
}

/**
 * Client service for handling encryption key rotation
 */
export class KeyRotationClient {
  /**
   * Initiate key rotation with backend
   */
  async initiateKeyRotation(
    oldWalletPublicKey: string,
    newWalletPublicKey: string
  ): Promise<{ success: boolean; totalSubscriptions: number; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/key-rotation/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          oldWalletPublicKey,
          newWalletPublicKey,
        }),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        totalSubscriptions: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get current rotation progress
   */
  async getRotationProgress(): Promise<KeyRotationProgress> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/key-rotation/progress`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      const result = await response.json();
      return result.data;
    } catch (error) {
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
   * Re-encrypt a single subscription with new key
   */
  async reEncryptSubscription(
    subscription: EncryptedSubscription,
    oldEncryptionKey: string,
    newEncryptionKey: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Decrypt with old key and re-encrypt with new key
      const reEncryptedData: {
        encrypted_name?: string;
        encrypted_price?: string;
        encrypted_category?: string;
        encrypted_renewal_url?: string;
      } = {};

      if (subscription.encrypted_name) {
        const encryptedName = JSON.parse(subscription.encrypted_name) as EncryptedData;
        const decrypted = await decryptSubscriptionMetadata(oldEncryptionKey, encryptedName);
        const reEncrypted = await encryptSubscriptionMetadata(newEncryptionKey, decrypted);
        reEncryptedData.encrypted_name = JSON.stringify(reEncrypted);
      }

      if (subscription.encrypted_price) {
        const encryptedPrice = JSON.parse(subscription.encrypted_price) as EncryptedData;
        const plaintext = await import('../../shared/src/crypto/metadata-encryption').then((m) =>
          m.decryptMetadata(encryptedPrice, oldEncryptionKey)
        );
        const reEncrypted = await import('../../shared/src/crypto/metadata-encryption').then((m) =>
          m.encryptMetadata(plaintext, newEncryptionKey)
        );
        reEncryptedData.encrypted_price = JSON.stringify(reEncrypted);
      }

      if (subscription.encrypted_category) {
        const encryptedCategory = JSON.parse(subscription.encrypted_category) as EncryptedData;
        const plaintext = await import('../../shared/src/crypto/metadata-encryption').then((m) =>
          m.decryptMetadata(encryptedCategory, oldEncryptionKey)
        );
        const reEncrypted = await import('../../shared/src/crypto/metadata-encryption').then((m) =>
          m.encryptMetadata(plaintext, newEncryptionKey)
        );
        reEncryptedData.encrypted_category = JSON.stringify(reEncrypted);
      }

      if (subscription.encrypted_renewal_url) {
        const encryptedUrl = JSON.parse(subscription.encrypted_renewal_url) as EncryptedData;
        const plaintext = await import('../../shared/src/crypto/metadata-encryption').then((m) =>
          m.decryptMetadata(encryptedUrl, oldEncryptionKey)
        );
        const reEncrypted = await import('../../shared/src/crypto/metadata-encryption').then((m) =>
          m.encryptMetadata(plaintext, newEncryptionKey)
        );
        reEncryptedData.encrypted_renewal_url = JSON.stringify(reEncrypted);
      }

      // Send re-encrypted data to backend
      const response = await fetch(`${API_BASE_URL}/api/key-rotation/reencrypt-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          subscriptionId: subscription.id,
          encryptedData: reEncryptedData,
        }),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Complete key rotation
   */
  async completeKeyRotation(
    newWalletPublicKey: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/key-rotation/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          newWalletPublicKey,
        }),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cancel key rotation
   */
  async cancelKeyRotation(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/key-rotation/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      const data = await response.json();
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Fetch all encrypted subscriptions for re-encryption
   */
  async fetchEncryptedSubscriptions(): Promise<EncryptedSubscription[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/subscriptions?encrypted_only=true`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching encrypted subscriptions:', error);
      return [];
    }
  }

  /**
   * Orchestrate full re-encryption process for all subscriptions
   */
  async performReEncryption(
    oldWalletPublicKey: string,
    newWalletPublicKey: string,
    onProgress?: (completed: number, total: number) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Derive keys from wallet public keys
      const oldKey = stellarWallet.deriveEncryptionKey(oldWalletPublicKey);
      const newKey = stellarWallet.deriveEncryptionKey(newWalletPublicKey);

      // Fetch all encrypted subscriptions
      const subscriptions = await this.fetchEncryptedSubscriptions();
      const total = subscriptions.length;

      let completed = 0;
      const errors: string[] = [];

      // Re-encrypt each subscription
      for (const subscription of subscriptions) {
        const result = await this.reEncryptSubscription(subscription, oldKey, newKey);

        if (result.success) {
          completed++;
          onProgress?.(completed, total);
        } else {
          errors.push(`Subscription ${subscription.id}: ${result.error}`);
        }
      }

      if (errors.length > 0) {
        return {
          success: false,
          error: `Failed to re-encrypt ${errors.length} subscriptions: ${errors.join(', ')}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const keyRotationClient = new KeyRotationClient();
