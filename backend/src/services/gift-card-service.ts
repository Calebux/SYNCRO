import { supabase, databaseRepository } from '../config/database';
import { blockchainService } from './blockchain-service';
import logger from '../config/logger';

/**
 * Validates gift card hash format.
 * Accepts hex strings 32-64 chars (SHA-256 or similar).
 */
const GIFT_CARD_HASH_REGEX = /^[a-fA-F0-9]{32,64}$/;

export interface AttachGiftCardResult {
  success: boolean;
  data?: {
    id: string;
    subscriptionId: string;
    giftCardHash: string;
    provider: string;
    transactionHash?: string;
    status: string;
  };
  error?: string;
  blockchainResult?: {
    transactionHash?: string;
    error?: string;
  };
}

export class GiftCardService {
  /**
   * Validate gift card hash format
   */
  validateGiftCardHash(hash: string): boolean {
    if (typeof hash !== 'string' || hash.length < 32 || hash.length > 64) {
      return false;
    }
    return GIFT_CARD_HASH_REGEX.test(hash);
  }

  /**
   * Attach a gift card to a subscription
   */
  async attachGiftCard(
    userId: string,
    subscriptionId: string,
    giftCardHash: string,
    provider: string
  ): Promise<AttachGiftCardResult> {
    if (!this.validateGiftCardHash(giftCardHash)) {
      return {
        success: false,
        error: 'Invalid gift card format. Hash must be 32-64 hex characters.',
      };
    }

    const trimmedProvider = String(provider || '').trim();
    if (!trimmedProvider) {
      return {
        success: false,
        error: 'Provider is required',
      };
    }

    try {
      // Verify subscription ownership
      const { data: subscription, error: fetchError } = await databaseRepository
        .from('subscriptions')
        .select('id')
        .eq('id', subscriptionId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !subscription) {
        return {
          success: false,
          error: 'Subscription not found or access denied',
        };
      }

      // Insert gift card attachment
      const { data: attachment, error: insertError } = await databaseRepository
        .from('subscription_gift_cards')
        .insert({
          subscription_id: subscriptionId,
          user_id: userId,
          gift_card_hash: giftCardHash.toLowerCase(),
          provider: trimmedProvider,
          status: 'attached',
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          return {
            success: false,
            error: 'This gift card is already attached to this subscription',
          };
        }
        logger.error('Failed to insert gift card attachment:', insertError);
        return {
          success: false,
          error: `Failed to attach gift card: ${insertError.message}`,
        };
      }

      // Log on-chain reference
      const blockchainResult = await blockchainService.logGiftCardAttached(
        userId,
        subscriptionId,
        giftCardHash,
        trimmedProvider
      );

      // Update attachment with transaction hash if available
      if (blockchainResult.transactionHash) {
        await databaseRepository
          .from('subscription_gift_cards')
          .update({
            transaction_hash: blockchainResult.transactionHash,
            updated_at: new Date().toISOString(),
          })
          .eq('id', attachment.id);
      }

      logger.info('Gift card attached', {
        subscriptionId,
        provider: trimmedProvider,
        transactionHash: blockchainResult.transactionHash,
      });

      return {
        success: true,
        data: {
          id: attachment.id,
          subscriptionId: attachment.subscription_id,
          giftCardHash: attachment.gift_card_hash,
          provider: attachment.provider,
          transactionHash: blockchainResult.transactionHash || attachment.transaction_hash,
          status: attachment.status,
        },
        blockchainResult: {
          transactionHash: blockchainResult.transactionHash,
          error: blockchainResult.error,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('Attach gift card error:', error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const giftCardService = new GiftCardService();
