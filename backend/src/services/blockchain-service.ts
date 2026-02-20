import logger from '../config/logger';
import { supabase } from '../config/database';
import { NotificationPayload } from '../types/reminder';

export interface BlockchainLogEntry {
  user_id: string;
  event_type: string;
  event_data: Record<string, any>;
}

/**
 * Blockchain logging service for reminder events
 * This service writes reminder events to on-chain logs via Soroban contracts
 */
export class BlockchainService {
  private contractAddress: string | null;
  private networkUrl: string;

  constructor() {
    this.contractAddress = process.env.SOROBAN_CONTRACT_ADDRESS || null;
    this.networkUrl = process.env.STELLAR_NETWORK_URL || 'https://soroban-testnet.stellar.org';
    
    if (!this.contractAddress) {
      logger.warn('Blockchain contract address not configured. Events will be logged to database only.');
    }
  }

  /**
   * Log reminder event to blockchain and database
   */
  async logReminderEvent(
    userId: string,
    payload: NotificationPayload,
    deliveryChannels: string[]
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    const eventData = {
      subscriptionId: payload.subscription.id,
      subscriptionName: payload.subscription.name,
      reminderType: payload.reminderType,
      renewalDate: payload.renewalDate,
      daysBefore: payload.daysBefore,
      price: payload.subscription.price,
      billingCycle: payload.subscription.billing_cycle,
      deliveryChannels,
      timestamp: new Date().toISOString(),
    };

    // First, log to database
    try {
      const { data: dbLog, error: dbError } = await supabase
        .from('blockchain_logs')
        .insert({
          user_id: userId,
          event_type: 'reminder_sent',
          event_data: eventData,
          status: 'pending',
        })
        .select()
        .single();

      if (dbError) {
        logger.error('Failed to log event to database:', dbError);
        throw dbError;
      }

      logger.info('Event logged to database', { logId: dbLog.id });

      // If contract address is configured, attempt to write to blockchain
      if (this.contractAddress) {
        try {
          const result = await this.writeToBlockchain(eventData);
          
          // Update database log with transaction hash
          if (result.transactionHash) {
            await supabase
              .from('blockchain_logs')
              .update({
                transaction_hash: result.transactionHash,
                status: 'confirmed',
                updated_at: new Date().toISOString(),
              })
              .eq('id', dbLog.id);

            logger.info('Event written to blockchain', {
              logId: dbLog.id,
              transactionHash: result.transactionHash,
            });
          }

          return {
            success: true,
            transactionHash: result.transactionHash,
          };
        } catch (blockchainError) {
          // Log blockchain error but don't fail the operation
          const errorMessage =
            blockchainError instanceof Error
              ? blockchainError.message
              : String(blockchainError);

          logger.error('Failed to write to blockchain:', errorMessage);

          // Update database log with error
          await supabase
            .from('blockchain_logs')
            .update({
              status: 'failed',
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('id', dbLog.id);

          // Still return success since database logging succeeded
          return {
            success: true,
            error: errorMessage,
          };
        }
      }

      // If no contract address, just log to database
      return {
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('Failed to log reminder event:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Write event data to Soroban contract
   * This is a placeholder implementation - actual implementation depends on your Soroban contract
   */
  private async writeToBlockchain(
    eventData: Record<string, any>
  ): Promise<{ transactionHash: string }> {
    // TODO: Implement actual Soroban contract interaction
    // This would typically use @stellar/stellar-sdk or a Soroban SDK
    // Example structure:
    //
    // 1. Initialize Soroban client
    // 2. Load contract
    // 3. Invoke contract method to log event
    // 4. Submit transaction
    // 5. Wait for confirmation
    // 6. Return transaction hash

    logger.info('Blockchain write not fully implemented. Using mock transaction hash.');
    
    // For now, return a mock transaction hash
    // In production, implement actual Soroban contract interaction
    return {
      transactionHash: `0x${Buffer.from(JSON.stringify(eventData)).toString('hex').slice(0, 64)}`,
    };
  }

  /**
   * Get blockchain log entries for a user
   */
  async getUserLogs(userId: string, limit: number = 100) {
    const { data, error } = await supabase
      .from('blockchain_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch blockchain logs:', error);
      throw error;
    }

    return data;
  }

  /**
   * Sync subscription operation to blockchain
   * Handles create, update, and delete operations
   */
  async syncSubscription(
    userId: string,
    subscriptionId: string,
    operation: 'create' | 'update' | 'delete',
    subscriptionData: any
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    const eventData = {
      subscriptionId,
      operation,
      subscriptionName: subscriptionData.name,
      price: subscriptionData.price,
      billingCycle: subscriptionData.billing_cycle,
      status: subscriptionData.status,
      timestamp: new Date().toISOString(),
    };

    // First, log to database
    try {
      const { data: dbLog, error: dbError } = await supabase
        .from('blockchain_logs')
        .insert({
          user_id: userId,
          event_type: `subscription_${operation}`,
          event_data: eventData,
          status: 'pending',
        })
        .select()
        .single();

      if (dbError) {
        logger.error('Failed to log subscription event to database:', dbError);
        throw dbError;
      }

      logger.info('Subscription event logged to database', {
        logId: dbLog.id,
        operation,
        subscriptionId,
      });

      // If contract address is configured, attempt to write to blockchain
      if (this.contractAddress) {
        try {
          const result = await this.writeSubscriptionToBlockchain(
            operation,
            eventData
          );

          // Update database log with transaction hash
          if (result.transactionHash) {
            await supabase
              .from('blockchain_logs')
              .update({
                transaction_hash: result.transactionHash,
                status: 'confirmed',
                updated_at: new Date().toISOString(),
              })
              .eq('id', dbLog.id);

            logger.info('Subscription event written to blockchain', {
              logId: dbLog.id,
              transactionHash: result.transactionHash,
              operation,
            });
          }

          return {
            success: true,
            transactionHash: result.transactionHash,
          };
        } catch (blockchainError) {
          // Log blockchain error but don't fail the operation
          const errorMessage =
            blockchainError instanceof Error
              ? blockchainError.message
              : String(blockchainError);

          logger.error('Failed to write subscription to blockchain:', errorMessage);

          // Update database log with error
          await supabase
            .from('blockchain_logs')
            .update({
              status: 'failed',
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('id', dbLog.id);

          // Still return success since database logging succeeded
          return {
            success: true,
            error: errorMessage,
          };
        }
      }

      // If no contract address, just log to database
      return {
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('Failed to sync subscription event:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Write subscription operation to Soroban contract
   * This is a placeholder implementation - actual implementation depends on your Soroban contract
   */
  private async writeSubscriptionToBlockchain(
    operation: 'create' | 'update' | 'delete',
    eventData: Record<string, any>
  ): Promise<{ transactionHash: string }> {
    // TODO: Implement actual Soroban contract interaction
    // This would typically use @stellar/stellar-sdk or a Soroban SDK
    // Example structure:
    //
    // 1. Initialize Soroban client
    // 2. Load contract
    // 3. Invoke contract method based on operation:
    //    - create: contract.createSubscription(subscriptionData)
    //    - update: contract.updateSubscription(subscriptionId, updates)
    //    - delete: contract.deleteSubscription(subscriptionId)
    // 4. Submit transaction
    // 5. Wait for confirmation
    // 6. Return transaction hash

    logger.info('Blockchain write not fully implemented. Using mock transaction hash.', {
      operation,
    });

    // For now, return a mock transaction hash
    // In production, implement actual Soroban contract interaction
    const operationPrefix = operation === 'create' ? 'c' : operation === 'update' ? 'u' : 'd';
    return {
      transactionHash: `${operationPrefix}x${Buffer.from(JSON.stringify(eventData)).toString('hex').slice(0, 62)}`,
    };
  }

  // ── Cancellation logging ────────────────────────────────────────────────────

  /**
   * Log a subscription cancellation event to the database and optionally on-chain.
   * Mirrors the same non-blocking dual-write pattern used by syncSubscription().
   *
   * @param userId           - Authenticated user ID
   * @param subscriptionId   - UUID of the subscription being cancelled
   * @param subscriptionData - Full subscription record (for event payload)
   * @param cancellationUrl  - Optional merchant cancellation redirect URL
   */
  async logCancellation(
    userId: string,
    subscriptionId: string,
    subscriptionData: any,
    cancellationUrl?: string
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    const eventData = {
      subscriptionId,
      subscriptionName: subscriptionData.name,
      price: subscriptionData.price,
      billingCycle: subscriptionData.billing_cycle,
      cancellationUrl: cancellationUrl || null,
      timestamp: new Date().toISOString(),
    };

    try {
      // 1. Write to database first (authoritative log)
      const { data: dbLog, error: dbError } = await supabase
        .from('blockchain_logs')
        .insert({
          user_id: userId,
          event_type: 'subscription_cancelled',
          event_data: eventData,
          status: 'pending',
        })
        .select()
        .single();

      if (dbError) {
        logger.error('Failed to log cancellation event to database:', dbError);
        throw dbError;
      }

      logger.info('Cancellation event logged to database', {
        logId: dbLog.id,
        subscriptionId,
      });

      // 2. Optionally write to Soroban contract (cancel_sub)
      if (this.contractAddress) {
        try {
          const result = await this.writeCancellationToBlockchain(eventData);

          if (result.transactionHash) {
            await supabase
              .from('blockchain_logs')
              .update({
                transaction_hash: result.transactionHash,
                status: 'confirmed',
                updated_at: new Date().toISOString(),
              })
              .eq('id', dbLog.id);

            logger.info('Cancellation written to blockchain', {
              logId: dbLog.id,
              transactionHash: result.transactionHash,
            });
          }

          return { success: true, transactionHash: result.transactionHash };
        } catch (blockchainError) {
          const errorMessage =
            blockchainError instanceof Error
              ? blockchainError.message
              : String(blockchainError);

          logger.error('Failed to write cancellation to blockchain:', errorMessage);

          await supabase
            .from('blockchain_logs')
            .update({
              status: 'failed',
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('id', dbLog.id);

          // DB log succeeded – operation is not fully failed
          return { success: true, error: errorMessage };
        }
      }

      // No contract configured – DB-only log is sufficient
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to log cancellation event:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Invoke the Soroban contract's `cancel_sub` function.
   * Placeholder – replace with real @stellar/stellar-sdk calls once the contract is deployed.
   *
   * Steps (production):
   *  1. Build transaction: invoke cancel_sub(sub_id, cancellation_url)
   *  2. Sign with server keypair / user's own keypair (self-custodial)
   *  3. Submit & wait for confirmation
   *  4. Return transaction hash
   */
  private async writeCancellationToBlockchain(
    eventData: Record<string, any>
  ): Promise<{ transactionHash: string }> {
    logger.info(
      'Blockchain cancellation write not fully implemented. Using mock transaction hash.'
    );

    return {
      transactionHash: `cx${Buffer.from(JSON.stringify(eventData)).toString('hex').slice(0, 62)}`,
    };
  }
}

export const blockchainService = new BlockchainService();

