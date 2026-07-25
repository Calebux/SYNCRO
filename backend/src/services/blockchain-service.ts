import logger from "../config/logger";
import { supabase } from "../config/database";
import { NotificationPayload } from "../types/reminder";
import { getRequestId } from "../middleware/requestContext";
import crypto from 'crypto';
import { calculateBackoffDelay } from "../utils/retry";
import {
  Contract,
  Keypair,
  Memo,
  Networks,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { createClient, RedisClientType } from "redis";
import { secretProvider } from "./secret-provider";
import {
  getBlockchainFlags,
  resolveStellarNetwork,
} from "../../../shared/blockchain-flags";
import { agentWalletRotationService } from './agent-wallet-rotation';
import { EXTERNAL_SERVICE_POLICIES } from "../config/external-services";
import {
  BLOCKCHAIN_INVOKE_METHODS,
  resolveSubscriptionMethod,
} from "../blockchain/backend-contract-bindings";
import { commitmentStorageService } from "./commitment-storage-service";
import {
  buildSyncroMemo,
  resolveMemoOperationFromMethod,
  verifyTransactionMemo,
} from "@syncro/shared/stellar/memo";

export type PayloadVersion = '1.0';

export interface SubscriptionEventPayload {
  subscriptionId: string;
  operation: string;
  subscriptionName: string;
  price: string | number;
  billingCycle: string;
  status: string;
  timestamp: string;
}

export interface ReminderEventPayload {
  subscriptionId: string;
  subscriptionName: string;
  reminderType: string;
  renewalDate: string;
  daysBefore: number;
  price: string | number;
  billingCycle: string;
  deliveryChannels: string[];
  timestamp: string;
}

export interface GiftCardEventPayload {
  subscriptionId: string;
  giftCardHash: string;
  provider: string;
  eventType: string;
  timestamp: string;
}

export interface DLQPayload<T = unknown> {
  version: PayloadVersion;
  eventType: string;
  payload: T;
  failedAt: string;
  errorReason: string;
  retryCount: number;
  contractAddress?: string | null;
  rpcUrl?: string;
}

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
  private rpcUrl: string;
  private networkPassphrase: string;
  private redisClient: RedisClientType | null = null;
  private readonly policy = EXTERNAL_SERVICE_POLICIES.stellar_rpc;

  constructor() {
    this.contractAddress = process.env.SOROBAN_CONTRACT_ADDRESS || null;

    const flags = getBlockchainFlags();
    const network = resolveStellarNetwork();

    // Resolve RPC URL — never silently fall back to testnet in production.
    const configuredRpc = process.env.SOROBAN_RPC_URL;
    if (!configuredRpc && flags.isProduction) {
      throw new Error(
        "[blockchain] SOROBAN_RPC_URL must be explicitly set in production. " +
          "Refusing to fall back to the testnet RPC endpoint.",
      );
    }
    this.rpcUrl = configuredRpc || "https://soroban-testnet.stellar.org";

    // Resolve network passphrase — never silently use testnet passphrase in production.
    const configuredPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
    if (!configuredPassphrase && flags.isProduction) {
      throw new Error(
        "[blockchain] STELLAR_NETWORK_PASSPHRASE must be explicitly set in production. " +
          "Refusing to fall back to the testnet network passphrase.",
      );
    }
    this.networkPassphrase =
      configuredPassphrase ||
      (network === "mainnet"
        ? Networks.PUBLIC
        : network === "futurenet"
          ? Networks.FUTURENET
          : Networks.TESTNET);

    if (!this.contractAddress) {
      logger.warn(
        "Blockchain contract address not configured. Events will be logged to database only.",
      );
    }

    if (!flags.blockchainEnabled) {
      logger.warn(
        "ENABLE_BLOCKCHAIN=false — on-chain writes are disabled. " +
          "All events will be logged to the database only.",
      );
    }

    // Initialize optional Redis client for DLQ if REDIS_URL present
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redisClient = createClient({ url: redisUrl });
        // Connect lazily; fire-and-forget
        this.redisClient.connect().catch((err) => {
          logger.warn("Redis DLQ connection failed; DLQ disabled:", err);
          this.redisClient = null;
        });
      } catch (err) {
        logger.warn("Redis DLQ initialization failed; DLQ disabled:", err);
        this.redisClient = null;
      }
    }
  }

  /**
   * Log reminder event to blockchain and database
   */
  async logReminderEvent(
    userId: string,
    payload: NotificationPayload,
    deliveryChannels: string[],
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
      correlationId: getRequestId(),
      timestamp: new Date().toISOString(),
    };

    // First, log to database
    try {
      const { data: dbLog, error: dbError } = await supabase
        .from("blockchain_logs")
        .insert({
          user_id: userId,
          event_type: "reminder_sent",
          event_data: eventData,
          status: "pending",
        })
        .select()
        .single();

      if (dbError) {
        logger.error("Failed to log event to database:", dbError);
        throw dbError;
      }

      logger.info("Event logged to database", { logId: dbLog.id });

      // Create privacy-preserving commitment (non-blocking)
      this.createAndRecordEventCommitment({
        userId,
        eventType: "reminder_sent",
        eventData,
      }).catch((err) => logger.warn("Non-blocking commitment creation failed:", err));

      // If contract address is configured, attempt to write to blockchain
      if (this.contractAddress) {
        try {
          const { privacyService } = require('./privacy-service');
          const useCommitments = await privacyService.isPrivacyFeatureEnabled(userId, 'PRIVACY_AUDIT_COMMITMENTS');

          let result;
          if (useCommitments) {
            const userCommitment = this.computePedersenCommitment(userId, userId);
            const eventCommitment = this.computePedersenCommitment(JSON.stringify(eventData), userId);
            const coarsenedTime = this.getCoarsenedTimestamp(eventData.timestamp);
            
            result = await this.invokeContractWithRetry(
              "log_commitment",
              [
                xdr.ScVal.scvBytes(userCommitment),
                xdr.ScVal.scvBytes(eventCommitment),
                xdr.ScVal.scvU64(xdr.Uint64.fromString(String(coarsenedTime))),
              ]
            );
          } else {
            result = await this.writeToBlockchain(eventData);
          }

          // Update database log with transaction hash
          if (result.transactionHash) {
            await supabase
              .from("blockchain_logs")
              .update({
                transaction_hash: result.transactionHash,
                status: "confirmed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", dbLog.id);

            logger.info("Event written to blockchain", {
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

          logger.error("Failed to write to blockchain:", errorMessage);

          // Update database log with error
          await supabase
            .from("blockchain_logs")
            .update({
              status: "failed",
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dbLog.id);

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
      logger.error("Failed to log reminder event:", errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Write event data to Soroban contract
   */
  private async writeToBlockchain(
    eventData: ReminderEventPayload,
  ): Promise<{ transactionHash: string }> {
    return this.invokeContractWithRetry(
      BLOCKCHAIN_INVOKE_METHODS.logReminder,
      this.encodeReminderArgs(eventData),
      eventData.subscriptionId,
    );
  }

  /**
   * Get blockchain log entries for a user
   */
  async getUserLogs(userId: string, limit: number = 100) {
    const { data, error } = await supabase
      .from("blockchain_logs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error("Failed to fetch blockchain logs:", error);
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
    operation:  "create" | "update" | "delete" | "cancel" | "pause" | "unpause",
    subscriptionData: any,
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    const eventData = {
      subscriptionId,
      operation,
      subscriptionName: subscriptionData.name,
      price: subscriptionData.price,
      billingCycle: subscriptionData.billing_cycle,
      status: subscriptionData.status,
      correlationId: getRequestId(),
      timestamp: new Date().toISOString(),
    };

    // First, log to database
    try {
      const { data: dbLog, error: dbError } = await supabase
        .from("blockchain_logs")
        .insert({
          user_id: userId,
          event_type: `subscription_${operation}`,
          event_data: eventData,
          status: "pending",
        })
        .select()
        .single();

      if (dbError) {
        logger.error("Failed to log subscription event to database:", dbError);
        throw dbError;
      }

      logger.info("Subscription event logged to database", {
        logId: dbLog.id,
        operation,
        subscriptionId,
      });

      // Create privacy-preserving commitment (non-blocking)
      this.createAndRecordEventCommitment({
        userId,
        eventType: `subscription_${operation}`,
        eventData,
      }).catch((err) => logger.warn("Non-blocking commitment creation failed:", err));

      // If contract address is configured, attempt to write to blockchain
      if (this.contractAddress) {
        try {
          const { privacyService } = require('./privacy-service');
          const useCommitments = await privacyService.isPrivacyFeatureEnabled(userId, 'PRIVACY_AUDIT_COMMITMENTS');

          let result;
          if (useCommitments) {
            const userCommitment = this.computePedersenCommitment(userId, userId);
            const eventCommitment = this.computePedersenCommitment(JSON.stringify(eventData), userId);
            const coarsenedTime = this.getCoarsenedTimestamp(eventData.timestamp);

            result = await this.invokeContractWithRetry(
              "log_commitment",
              [
                xdr.ScVal.scvBytes(userCommitment),
                xdr.ScVal.scvBytes(eventCommitment),
                xdr.ScVal.scvU64(xdr.Uint64.fromString(String(coarsenedTime))),
              ]
            );
          } else {
            result = await this.writeSubscriptionToBlockchain(
              operation,
              eventData,
            );
          }

          // Update database log with transaction hash
          if (result.transactionHash) {
            await supabase
              .from("blockchain_logs")
              .update({
                transaction_hash: result.transactionHash,
                status: "confirmed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", dbLog.id);

            logger.info("Subscription event written to blockchain", {
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

          logger.error(
            "Failed to write subscription to blockchain:",
            errorMessage,
          );

          // Update database log with error
          await supabase
            .from("blockchain_logs")
            .update({
              status: "failed",
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dbLog.id);

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
      logger.error("Failed to sync subscription event:", errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Write subscription operation to Soroban contract
   */
  private async writeSubscriptionToBlockchain(
    operation: "create" | "update" | "delete" | "cancel" | "pause" | "unpause",
    eventData: SubscriptionEventPayload,
  ): Promise<{ transactionHash: string }> {
    const method = resolveSubscriptionMethod(operation);
    return this.invokeContractWithRetry(
      method,
      this.encodeSubscriptionArgs(eventData),
      eventData.subscriptionId,
    );
  }

  /**
   * Log gift card attachment to blockchain and database
   */
  async logGiftCardAttached(
    userId: string,
    subscriptionId: string,
    giftCardHash: string,
    provider: string
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    const eventData = {
      subscriptionId,
      giftCardHash,
      provider,
      eventType: 'gift_card_attached',
      correlationId: getRequestId(),
      timestamp: new Date().toISOString(),
    };

    try {
      const { data: dbLog, error: dbError } = await supabase
        .from('blockchain_logs')
        .insert({
          user_id: userId,
          event_type: 'gift_card_attached',
          event_data: eventData,
          status: 'pending',
        })
        .select()
        .single();

      if (dbError) {
        logger.error('Failed to log gift card event to database:', dbError);
        throw dbError;
      }

      // Create privacy-preserving commitment (non-blocking)
      this.createAndRecordEventCommitment({
        userId,
        eventType: 'gift_card_attached',
        eventData,
      }).catch((err) => logger.warn("Non-blocking commitment creation failed:", err));

      if (this.contractAddress) {
        try {
          const result = await this.writeGiftCardToBlockchain(eventData);

          if (result.transactionHash) {
            await supabase
              .from('blockchain_logs')
              .update({
                transaction_hash: result.transactionHash,
                status: 'confirmed',
                updated_at: new Date().toISOString(),
              })
              .eq('id', dbLog.id);
          }

          return {
            success: true,
            transactionHash: result.transactionHash,
          };
        } catch (blockchainError) {
          const errorMessage =
            blockchainError instanceof Error
              ? blockchainError.message
              : String(blockchainError);
          logger.error('Failed to write gift card to blockchain:', errorMessage);
          await supabase
            .from('blockchain_logs')
            .update({
              status: 'failed',
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('id', dbLog.id);
          return {
            success: true,
            error: errorMessage,
          };
        }
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('Failed to log gift card event:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async writeGiftCardToBlockchain(
    eventData: GiftCardEventPayload
  ): Promise<{ transactionHash: string }> {
    return this.invokeContractWithRetry(
      BLOCKCHAIN_INVOKE_METHODS.giftCardAttached,
      this.encodeGiftCardArgs(eventData),
      eventData.subscriptionId,
    );
  }

  /**
   * Core Soroban invocation with retry & optional DLQ
   */
  private async invokeContractWithRetry(
    method: string,
    args: xdr.ScVal[],
    subscriptionId?: string,
  ): Promise<{ transactionHash: string }> {
    const correlationId = getRequestId();
    
    if (!this.contractAddress) {
      logger.error('Contract invocation failed: SOROBAN_CONTRACT_ADDRESS not configured', { 
        method, 
        correlationId 
      });
      throw new Error("SOROBAN_CONTRACT_ADDRESS not configured");
    }

    // Honour the ENABLE_BLOCKCHAIN master switch
    const flags = getBlockchainFlags();
    if (!flags.blockchainEnabled) {
      const errorMsg = `[blockchain] On-chain write for "${method}" was blocked: ENABLE_BLOCKCHAIN is set to false.`;
      logger.warn('Contract invocation blocked by feature flag', { 
        method, 
        correlationId,
        blockchainEnabled: flags.blockchainEnabled 
      });
      throw new Error(errorMsg);
    }

    logger.info('Starting contract invocation', { 
      method, 
      subscriptionId, 
      correlationId,
      contractAddress: this.contractAddress 
    });

    const rpc = new SorobanRpc.Server(this.rpcUrl);
    
    // Use rotated agent wallet keypair instead of a single static secret key.
    // The "executor" agent is used for contract invocations; its address rotates
    // on a configurable schedule (per-task, daily, weekly) to prevent address
    // clustering.
    let sourceKeypair: Keypair;
    try {
      const derived = await agentWalletRotationService.getActiveKeypair('executor');
      sourceKeypair = derived.keypair;
    } catch {
      // Fallback to the legacy STELLAR_SECRET_KEY if the rotation service
      // is not configured (e.g., AGENT_MASTER_SEED not set).
      const secret = await secretProvider.getSecret("STELLAR_SECRET_KEY");
      if (!secret) {
        throw new Error(
          "No signing key available: configure AGENT_MASTER_SEED (for HD wallet rotation) " +
          "or set STELLAR_SECRET_KEY (legacy fallback).",
        );
      }
      sourceKeypair = Keypair.fromSecret(secret);
    }
    const contract = new Contract(this.contractAddress);

    let lastErr: unknown = null;
    const { maxAttempts = 5, initialDelay = 1000, multiplier = 2, maxDelay = 16000, jitter = true } = this.policy.retryPolicy;

    const memoOperation = subscriptionId ? resolveMemoOperationFromMethod(method) : null;
    const expectedMemo =
      subscriptionId && memoOperation
        ? buildSyncroMemo(memoOperation, subscriptionId)
        : null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const account = await rpc.getAccount(sourceKeypair.publicKey());
        let builder = new TransactionBuilder(account, {
          fee: "100",
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(contract.call(method, ...args))
          .setTimeout(Math.floor(this.policy.timeoutMs / 1000));

        if (expectedMemo) {
          builder = builder.addMemo(Memo.text(expectedMemo));
        }

        const tx = builder.build();

        const sim = await rpc.simulateTransaction(tx);
        if (SorobanRpc.Api.isSimulationError(sim)) {
          throw new Error(`Simulation failed: ${sim.error}`);
        }

        const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
        assembled.sign(sourceKeypair);

        const send = await rpc.sendTransaction(assembled);
        if (send.status === "ERROR") {
          throw new Error(`Send failed: ${send.errorResult}`);
        }

        logger.info('Contract transaction submitted', { 
          method, 
          transactionHash: send.hash, 
          correlationId,
          subscriptionId,
          attempt: attempt + 1 
        });

        // Wait for confirmation
        const getTx = await rpc.getTransaction(send.hash);
        if (getTx.status === "NOT_FOUND") {
          // brief wait+retry fetch
          await this.sleep(initialDelay);
        } else if (
          expectedMemo &&
          subscriptionId &&
          memoOperation &&
          getTx.status === "SUCCESS" &&
          !verifyTransactionMemo(
            { memo: expectedMemo, successful: true, hash: send.hash },
            memoOperation,
            subscriptionId,
          )
        ) {
          throw new Error(`Transaction memo verification failed for method ${method}`);
        }

        logger.info('Contract transaction confirmed', { 
          method, 
          transactionHash: send.hash, 
          correlationId,
          subscriptionId,
          status: getTx.status 
        });

        return { transactionHash: send.hash };
      } catch (err) {
        lastErr = err;
        const reason = err instanceof Error ? err.message : String(err);
        const delay = calculateBackoffDelay(attempt + 1, { initialDelay, maxDelay, multiplier, jitter });
        logger.warn('Soroban tx attempt failed', {
          method,
          subscriptionId,
          attempt: attempt + 1,
          maxAttempts,
          reason,
          retryInMs: delay,
          correlationId,
        });
        await this.sleep(delay);
      }
    }

    // After all retries failed, enqueue to DLQ if available
    logger.error('Contract transaction failed after all retries', { 
      method, 
      subscriptionId, 
      maxAttempts, 
      correlationId,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr) 
    });
    
    await this.enqueueDeadLetter({
      version: '1.0',
      eventType: method,
      payload: this.previewArgs(args),
      failedAt: new Date().toISOString(),
      errorReason: lastErr instanceof Error ? lastErr.message : String(lastErr),
      retryCount: maxAttempts,
      contractAddress: this.contractAddress,
      rpcUrl: this.rpcUrl,
    });

    throw new Error(
      `Soroban transaction failed after ${maxAttempts} attempts: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  async recordCommitment(
    commitmentHash: Buffer,
  ): Promise<{ commitmentIndex: number; transactionHash?: string; error?: string }> {
    if (!this.contractAddress) {
      return { commitmentIndex: -1, error: 'SOROBAN_CONTRACT_ADDRESS not configured' };
    }

    try {
      const args = [xdr.ScVal.scvBytes(commitmentHash)];
      const result = await this.invokeContractWithRetry(
        BLOCKCHAIN_INVOKE_METHODS.recordCommitment,
        args,
      );

      const sim = await this.simulateContractCall(
        BLOCKCHAIN_INVOKE_METHODS.recordCommitment,
        args,
      );

      return {
        commitmentIndex: sim ?? -1,
        transactionHash: result.transactionHash,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Failed to record commitment on-chain:', errorMessage);
      return { commitmentIndex: -1, error: errorMessage };
    }
  }

  private async simulateContractCall(
    method: string,
    args: xdr.ScVal[],
  ): Promise<number | null> {
    try {
      if (!this.contractAddress) return null;

      const rpc = new SorobanRpc.Server(this.rpcUrl);
      const secret = await secretProvider.getSecret("STELLAR_SECRET_KEY");
      if (!secret) return null;

      const sourceKeypair = Keypair.fromSecret(secret);
      const contract = new Contract(this.contractAddress);

      const account = await rpc.getAccount(sourceKeypair.publicKey());
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const sim = await rpc.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) {
        logger.warn(`Simulation failed for ${method}: ${sim.error}`);
        return null;
      }

      const result = SorobanRpc.Api.isSimulationSuccess(sim) ? sim.result : null;
      if (result && result.retval) {
        const val = result.retval;
        if (val?.switch()?.name === 'scvU64') {
          return Number(val.u64());
        }
      }
      return null;
    } catch (err) {
      logger.warn(`Simulation error for ${method}:`, err);
      return null;
    }
  }

  async createAndRecordEventCommitment(params: {
    userId: string;
    eventType: string;
    eventData: Record<string, unknown>;
  }): Promise<{ commitmentHash: Buffer; dbId: string | null; commitmentIndex: number } | null> {
    try {
      const { commitmentHash, dbId } = await commitmentStorageService.createAndStoreCommitment(params);

      const onChain = await this.recordCommitment(commitmentHash);

      if (dbId && onChain.commitmentIndex >= 0) {
        await commitmentStorageService.updateCommitmentIndex(dbId, onChain.commitmentIndex);
      }

      return {
        commitmentHash,
        dbId,
        commitmentIndex: onChain.commitmentIndex,
      };
    } catch (err) {
      logger.error('Failed to create and record event commitment:', err);
      return null;
    }
  }

  private encodeReminderArgs(eventData: ReminderEventPayload): xdr.ScVal[] {
    return [
      xdr.ScVal.scvString(eventData.subscriptionId),
      xdr.ScVal.scvString(eventData.subscriptionName ?? ""),
      xdr.ScVal.scvString(eventData.reminderType ?? ""),
      xdr.ScVal.scvString(String(eventData.renewalDate ?? "")),
      xdr.ScVal.scvVec(
        (eventData.deliveryChannels ?? []).map((c: string) =>
          xdr.ScVal.scvString(c),
        ),
      ),
      xdr.ScVal.scvString(eventData.billingCycle ?? ""),
      xdr.ScVal.scvString(eventData.timestamp ?? new Date().toISOString()),
    ];
  }

  private encodeSubscriptionArgs(eventData: SubscriptionEventPayload): xdr.ScVal[] {
    return [
      xdr.ScVal.scvString(eventData.subscriptionId),
      xdr.ScVal.scvString(eventData.operation ?? ""),
      xdr.ScVal.scvString(eventData.subscriptionName ?? ""),
      xdr.ScVal.scvString(String(eventData.price ?? "")),
      xdr.ScVal.scvString(eventData.billingCycle ?? ""),
      xdr.ScVal.scvString(eventData.status ?? ""),
      xdr.ScVal.scvString(eventData.timestamp ?? new Date().toISOString()),
    ];
  }

  private encodeGiftCardArgs(eventData: GiftCardEventPayload): xdr.ScVal[] {
    return [
      xdr.ScVal.scvString(eventData.subscriptionId),
      xdr.ScVal.scvString(eventData.giftCardHash),
      xdr.ScVal.scvString(eventData.provider ?? ""),
      xdr.ScVal.scvString(eventData.timestamp ?? new Date().toISOString()),
    ];
  }

  private async enqueueDeadLetter<T>(payload: DLQPayload<T>): Promise<void> {
    const correlationId = getRequestId();
    const dlqKey = "dlq:blockchain_tx";
    try {
      if (this.redisClient) {
        await this.redisClient.lPush(dlqKey, JSON.stringify({ ...payload, correlationId }));
        logger.error("Enqueued to DLQ (Redis) for blockchain tx", { dlqKey, correlationId });
        return;
      }
    } catch (err) {
      logger.warn("Failed to push to Redis DLQ, will fallback to DB flag:", err);
    }

    try {
      // Fallback: write to a DB log row for observability; consumers could reprocess later
      await supabase.from("blockchain_logs").insert({
        user_id: "system",
        event_type: "blockchain_dead_letter",
        event_data: { ...payload, correlationId },
        status: "dead_letter",
      });
      logger.error("Recorded blockchain dead letter in database", { correlationId });
    } catch (dbErr) {
      logger.error("Failed to record dead letter in database:", dbErr);
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Helper to calculate a simulated Pedersen commitment (using SHA256 with blinding)
  private computePedersenCommitment(data: string, userId: string): Buffer {
    const systemSecret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'system-secret';
    const blinding = crypto.createHmac('sha256', systemSecret).update(userId).digest('hex');
    return crypto.createHash('sha256').update(`${data}:${blinding}`).digest();
  }

  // Coarsen a timestamp to day-level (00:00:00 UTC) as unix epoch seconds
  private getCoarsenedTimestamp(isoString: string): number {
    const date = new Date(isoString);
    date.setUTCHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }

  /**
   * Write encrypted subscription blob to blockchain
   */
  async storeEncryptedSubscription(
    userId: string,
    subscriptionId: string,
    encryptedBlob: string,
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      const { data: dbLog, error: dbError } = await supabase
        .from("blockchain_logs")
        .insert({
          user_id: userId,
          event_type: "subscription_encrypted_store",
          event_data: { subscriptionId, encryptedBlob, correlationId: getRequestId(), timestamp: new Date().toISOString() },
          status: "pending",
        })
        .select()
        .single();

      if (dbError) {
        logger.error("Failed to log encrypted sub event to database:", dbError);
        throw dbError;
      }

      if (this.contractAddress) {
        try {
          const result = await this.invokeContractWithRetry(
            "store_encrypted_subscription",
            [
              xdr.ScVal.scvString(subscriptionId),
              xdr.ScVal.scvString(encryptedBlob),
            ]
          );

          if (result.transactionHash) {
            await supabase
              .from("blockchain_logs")
              .update({
                transaction_hash: result.transactionHash,
                status: "confirmed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", dbLog.id);
          }

          return { success: true, transactionHash: result.transactionHash };
        } catch (blockchainError) {
          const errorMessage = blockchainError instanceof Error ? blockchainError.message : String(blockchainError);
          logger.error("Failed to write encrypted sub to blockchain:", errorMessage);

          await supabase
            .from("blockchain_logs")
            .update({
              status: "failed",
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dbLog.id);

          return { success: true, error: errorMessage };
        }
      }

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to store encrypted subscription:", errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Read encrypted subscription blob from blockchain
   */
  async getEncryptedSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<string> {
    if (!this.contractAddress) {
      throw new Error("SOROBAN_CONTRACT_ADDRESS not configured");
    }

    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    
    const secret = await secretProvider.getSecret("STELLAR_SECRET_KEY");
    if (!secret) {
      throw new Error("STELLAR_SECRET_KEY not configured");
    }
    const sourceKeypair = Keypair.fromSecret(secret);
    const account = await rpc.getAccount(sourceKeypair.publicKey());
    
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "get_encrypted_subscription",
          xdr.ScVal.scvString(subscriptionId)
        )
      )
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }

    if (sim.result && sim.result.retval) {
      const val = sim.result.retval;
      if (val.switch() === xdr.ScValType.scvString()) {
        return val.str().toString();
      }
      if (val.switch() === xdr.ScValType.scvVoid()) {
        return "";
      }
    }
    
    return "";
  }

  private previewArgs(args: xdr.ScVal[]): string {
    try {
      // Provide a light-weight, non-sensitive preview
      return JSON.stringify(
        args.map((a) => a.switch().name),
      );
    } catch {
      return "[unavailable]";
    }
  }
}

export const blockchainService = new BlockchainService();
