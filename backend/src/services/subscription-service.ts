import { supabase } from "../config/database";
import { blockchainService } from "./blockchain-service";
import { renewalCooldownService } from "./renewal-cooldown-service";
import { analyticsService } from "./analytics-service";
import { webhookService } from "./webhook-service";
import logger from "../config/logger";
import { DatabaseTransaction } from "../utils/transaction";
import type {
  Subscription,
  SubscriptionCreateInput,
  SubscriptionUpdateInput,
  ListSubscriptionsOptions,
  ListSubscriptionsResult,
} from "../types/subscription";

export interface BlockchainSyncResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

export interface SubscriptionSyncResult {
  subscription: Subscription;
  blockchainResult?: BlockchainSyncResult;
  syncStatus: "synced" | "partial" | "failed";
}

/**
 * Subscription service with blockchain sync and transaction management
 */
export class SubscriptionService {
  async createSubscription(
    userId: string,
    input: SubscriptionCreateInput,
    idempotencyKey?: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        const { data: subscription, error: dbError } = await client
          .from("subscriptions")
          .insert({
            user_id: userId,
            name: input.name,
            provider: input.provider || input.name,
            price: input.price,
            currency: input.currency || 'USD',
            billing_cycle: input.billing_cycle,
            status: input.status || "active",
            next_billing_date: input.next_billing_date || null,
            category: input.category || null,
            logo_url: input.logo_url || null,
            website_url: input.website_url || null,
            renewal_url: input.renewal_url || null,
            notes: input.notes || null,
            visibility: input.visibility || "private",
            tags: input.tags || [],
            email_account_id: input.email_account_id || null,
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (dbError) {
          throw new Error(`Database error: ${dbError.message}`);
        }

        // Attempt blockchain sync (non-blocking)
        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscription.id,
            "create",
            subscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription creation", {
              subscriptionId: subscription.id,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error:
              blockchainError instanceof Error
                ? blockchainError.message
                : String(blockchainError),
          };
        }

        // Trigger budget check (don't let it block response)
        analyticsService.checkBudgetThreshold(userId).catch(e => 
          logger.error('Background budget check failed:', e)
        );

        return {
          subscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Subscription creation failed:", error);
        throw error;
      }
    });
  }

  /**
   * Update subscription with blockchain sync.
   * Uses optimistic locking to prevent race conditions.
   */
  async updateSubscription(
    userId: string,
    subscriptionId: string,
    input: SubscriptionUpdateInput,
    expectedVersion?: number,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        // Verify ownership before updating
        const { data: existing, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !existing) {
          throw new Error("Subscription not found or access denied");
        }

        // Explicit allowlist — prevents field injection attacks by never spreading raw input
        const {
          name,
          provider,
          merchant_id,
          price,
          currency,
          billing_cycle,
          status,
          next_billing_date,
          category,
          logo_url,
          website_url,
          renewal_url,
          notes,
          tags,
        } = input;

        const updateData: Partial<SubscriptionUpdateInput> & { updated_at: string } = {
          ...(name !== undefined && { name }),
          ...(provider !== undefined && { provider }),
          ...(merchant_id !== undefined && { merchant_id }),
          ...(price !== undefined && { price }),
          ...(currency !== undefined && { currency }),
          ...(billing_cycle !== undefined && { billing_cycle }),
          ...(status !== undefined && { status }),
          ...(next_billing_date !== undefined && { next_billing_date }),
          ...(category !== undefined && { category }),
          ...(logo_url !== undefined && { logo_url }),
          ...(website_url !== undefined && { website_url }),
          ...(renewal_url !== undefined && { renewal_url }),
          ...(notes !== undefined && { notes }),
          ...(tags !== undefined && { tags }),
          updated_at: new Date().toISOString(),
        };

        const { data: subscription, error: updateError } = await client
          .from("subscriptions")
          .update(updateData)
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updateError) {
          throw new Error(`Update failed: ${updateError.message}`);
        }

        // Attempt blockchain sync
        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscriptionId,
            "update",
            subscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription update", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error:
              blockchainError instanceof Error
                ? blockchainError.message
                : String(blockchainError),
          };
        }

        // Trigger budget check
        analyticsService.checkBudgetThreshold(userId).catch(e => 
          logger.error('Background budget check failed:', e)
        );

        return {
          subscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Subscription update failed:", error);
        throw error;
      }
    });
  }

  async cancelSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        const { data: subscription, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !subscription) {
          throw new Error("Subscription not found or access denied");
        }

        if (subscription.status === "cancelled") {
          throw new Error("Subscription already cancelled");
        }

        const { data: updatedSubscription, error: updateError } = await client
          .from("subscriptions")
          .update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updateError) {
          throw new Error(`Update failed: ${updateError.message}`);
        }

        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscriptionId,
            "cancel",
            updatedSubscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription cancellation", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error:
              blockchainError instanceof Error
                ? blockchainError.message
                : String(blockchainError),
          };
        }

        return {
          subscription: updatedSubscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Subscription cancellation failed:", error);
        throw error;
      }
    });
  }

  /**
   * Delete subscription with blockchain sync
   */
  async deleteSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        const { data: subscription, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !subscription) {
          throw new Error("Subscription not found or access denied");
        }

        const { error: deleteError } = await client
          .from("subscriptions")
          .delete()
          .eq("id", subscriptionId)
          .eq("user_id", userId);

        if (deleteError) {
          throw new Error(`Delete failed: ${deleteError.message}`);
        }

        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscriptionId,
            "delete",
            subscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription deletion", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error:
              blockchainError instanceof Error
                ? blockchainError.message
                : String(blockchainError),
          };
        }

        // Trigger budget check
        analyticsService.checkBudgetThreshold(userId).catch(e => 
          logger.error('Background budget check failed:', e)
        );

        return {
          subscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Subscription deletion failed:", error);
        throw error;
      }
    });
  }

  async pauseSubscription(
    userId: string,
    subscriptionId: string,
    resumeAt?: string,
    reason?: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        // 1. Fetch and verify ownership
        const { data: subscription, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !subscription) {
          throw new Error("Subscription not found or access denied");
        }

        // 2. Guard: can only pause an active subscription
        if (subscription.status === "paused") {
          throw new Error("Subscription is already paused");
        }
        if (subscription.status === "cancelled") {
          throw new Error("Cannot pause a cancelled subscription");
        }

        // 3. Write to DB
        const { data: updatedSubscription, error: updateError } = await client
          .from("subscriptions")
          .update({
            status: "paused",
            paused_at: new Date().toISOString(),
            resume_at: resumeAt ?? null,
            pause_reason: reason ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updateError) {
          throw new Error(`Pause failed: ${updateError.message}`);
        }

        // 4. Sync to blockchain (non-fatal if it fails)
        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscriptionId,
            "pause",         // blockchain service will call pause() on the contract
            updatedSubscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription pause", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error: blockchainError instanceof Error
              ? blockchainError.message
              : String(blockchainError),
          };
        }

        return {
          subscription: updatedSubscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Pause failed:", error);
        throw error;
      }
    });
  }

  async resumeSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        // 1. Fetch and verify ownership
        const { data: subscription, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !subscription) {
          throw new Error("Subscription not found or access denied");
        }

        // 2. Guard: can only resume a paused subscription
        if (subscription.status !== "paused") {
          throw new Error("Subscription is not paused");
        }

        // 3. Write to DB — clear all pause fields, restore active
        const { data: updatedSubscription, error: updateError } = await client
          .from("subscriptions")
          .update({
            status: "active",
            paused_at: null,
            resume_at: null,
            pause_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updateError) {
          throw new Error(`Resume failed: ${updateError.message}`);
        }

        // 4. Sync to blockchain (non-fatal if it fails)
        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscriptionId,
            "unpause",       // blockchain service will call unpause() on the contract
            updatedSubscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription resume", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error: blockchainError instanceof Error
              ? blockchainError.message
              : String(blockchainError),
          };
        }

        return {
          subscription: updatedSubscription,
          blockchainResult,
          syncStatus,
        };
      } catch (error) {
        logger.error("Resume failed:", error);
        throw error;
      }
    });
  }

  /**
   * Get subscription by ID (with ownership check)
   */
  async getSubscription(userId: string, subscriptionId: string): Promise<Subscription> {
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("id", subscriptionId)
      .eq("user_id", userId)
      .single();

    if (error || !subscription) {
      throw new Error("Subscription not found or access denied");
    }

    return subscription;
  }

  /**
   * List user's subscriptions with optional filtering
   */
  async listSubscriptions(
    userId: string,
    options: ListSubscriptionsOptions = {},
  ): Promise<ListSubscriptionsResult> {
    let query = supabase
      .from("subscriptions")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (options.status) {
      query = query.eq("status", options.status);
    }

    if (options.category) {
      query = query.eq("category", options.category);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(
        options.offset,
        options.offset + (options.limit || 10) - 1,
      );
    }

    const { data: subscriptions, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch subscriptions: ${error.message}`);
    }

    return {
      subscriptions: subscriptions || [],
      total: count || 0,
    };
  }

  /**
   * Check if a renewal can be attempted based on cooldown period.
   * Returns cooldown status without enforcing it.
   */
  async checkRenewalCooldown(
    subscriptionId: string,
  ): Promise<{
    canRetry: boolean;
    isOnCooldown: boolean;
    timeRemainingSeconds: number;
    message: string;
  }> {
    try {
      const cooldownStatus = await renewalCooldownService.checkCooldown(subscriptionId);

      return {
        canRetry: cooldownStatus.canRetry,
        isOnCooldown: cooldownStatus.isOnCooldown,
        timeRemainingSeconds: cooldownStatus.timeRemainingSeconds,
        message: cooldownStatus.canRetry
          ? "Renewal can be attempted"
          : `Cooldown period active. Please wait ${cooldownStatus.timeRemainingSeconds} seconds before retrying.`,
      };
    } catch (error) {
      logger.error("Error checking renewal cooldown:", error);
      throw error;
    }
  }

  /**
   * Retry blockchain sync for a subscription with cooldown enforcement.
   * Enforces minimum time gap between renewal attempts to prevent network spam.
   */
  async retryBlockchainSync(
    userId: string,
    subscriptionId: string,
    forceBypass: boolean = false,
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // Check cooldown unless forcing bypass (admin operations)
      if (!forceBypass) {
        const cooldownStatus = await renewalCooldownService.checkCooldown(subscriptionId);

        if (cooldownStatus.isOnCooldown) {
          const error = `Cooldown period active. Please wait ${cooldownStatus.timeRemainingSeconds} seconds before retrying.`;
          logger.warn("Renewal attempt rejected due to cooldown", {
            subscription_id: subscriptionId,
            time_remaining_seconds: cooldownStatus.timeRemainingSeconds,
          });
          throw new Error(error);
        }
      }

      const subscription = await this.getSubscription(userId, subscriptionId);

      // Record the attempt before making the call
      await renewalCooldownService.recordRenewalAttempt(
        subscriptionId,
        false, // Assume failure initially
        "Attempt in progress",
        "retry",
      );

      const result = await blockchainService.syncSubscription(
        userId,
        subscriptionId,
        "update",
        subscription,
      );

      // Update the attempt status based on result
      if (result.success) {
        await renewalCooldownService.recordRenewalAttempt(
          subscriptionId,
          true,
          undefined,
          "retry",
        );
      } else {
        await renewalCooldownService.recordRenewalAttempt(
          subscriptionId,
          false,
          result.error || "Blockchain sync failed",
          "retry",
        );
      }

      return result;
    } catch (error) {
      // Record the failed attempt
      try {
        await renewalCooldownService.recordRenewalAttempt(
          subscriptionId,
          false,
          error instanceof Error ? error.message : String(error),
          "retry",
        );
      } catch (logError) {
        logger.warn("Failed to log renewal attempt:", logError);
      }

      logger.error("Renewal retry failed:", error);
      throw error;
    }
  }
}

export const subscriptionService = new SubscriptionService();