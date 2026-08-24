import { supabase, databaseRepository } from "../../config/database";
import { blockchainService } from "../../services/blockchain-service";
import { renewalCooldownService } from "../../services/renewal-cooldown-service";
import { analyticsService } from "../../services/analytics-service";
import { webhookService } from "../../services/webhook-service";
import { referralService } from "../../services/referral-service";
import { userPreferenceService } from "../../services/user-preference-service";
import logger from "../../config/logger";
import { DatabaseTransaction } from "../../utils/transaction";
import SERVICE_CATEGORIES from "../../services/service-categories";
import { validateCursor, encodeCursor } from "../../utils/pagination";
import { deriveStealthAddress } from "../../../../shared/src/crypto/stealth-derive";
import { encryptMetadata } from "../../../../shared/src/crypto/metadata-encryption";
import type {
  Subscription,
  SubscriptionCreateInput,
  SubscriptionUpdateInput,
  ListSubscriptionsOptions,
  ListSubscriptionsResult,
} from "../../types/subscription";
import { queryCacheService } from "../../services/query-cache-service";

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
  ): Promise<SubscriptionSyncResult> {
    const result = await DatabaseTransaction.execute(async (client) => {
      try {
        // Determine the next stealth derivation index for this user
        const { data: indexRow } = await client
          .from("subscriptions")
          .select("stealth_index")
          .eq("user_id", userId)
          .order("stealth_index", { ascending: false })
          .limit(1)
          .single();

        const stealthIndex = indexRow ? (indexRow.stealth_index as number) + 1 : 0;

        // Derive stealth address when the user has a stored stealth meta-address.
        const { data: profile, error: profileError } = await client
          .from('profiles')
          .select('stealth_meta_address')
          .eq('id', userId)
          .single();

        if (profileError) {
          throw new Error(`Failed to load user profile: ${profileError.message}`);
        }

        const metaAddress = profile?.stealth_meta_address ?? null;
        let stealthAddress: string | null = null;

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
            category: input.category || this.autoTag(input.name),
            logo_url: input.logo_url || null,
            website_url: input.website_url || null,
            renewal_url: input.renewal_url || null,
            notes: input.notes || null,
            visibility: input.visibility || "private",
            tags: input.tags || [],
            email_account_id: input.email_account_id || null,
            stealth_index: stealthIndex,
            stealth_address: null,
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (dbError) {
          throw new Error(`Database error: ${dbError.message}`);
        }

        // Now that we have the subscription id, derive and persist the stealth address
        if (metaAddress) {
          stealthAddress = deriveStealthAddress(metaAddress, subscription.id, stealthIndex);
          await client
            .from("subscriptions")
            .update({ stealth_address: stealthAddress })
            .eq("id", subscription.id);
          subscription.stealth_address = stealthAddress;
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

        // Trigger referral conversion on first subscription (non-blocking)
        referralService.markConverted(userId).catch(e =>
          logger.error('Background referral conversion check failed:', e)
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

    await this.invalidateSubscriptionCache(userId);
    return result;
  }

  /**
   * Delete subscription with blockchain sync
   * Soft delete: sets status to 'deleted' and removes reminders
   */
  async deleteSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    const result = await DatabaseTransaction.execute(async (client) => {
      try {
        // 1. Verify ownership and get subscription details
        const { data: existing, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !existing) {
          throw new Error("Subscription not found or access denied");
        }

        // If already deleted, return early
        if (existing.status === "deleted") {
          return {
            subscription: existing as Subscription,
            syncStatus: "synced",
          };
        }

        // 2. Soft delete - update status to deleted
        const { data: subscription, error: updateError } = await client
          .from("subscriptions")
          .update({
            status: "deleted",
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updateError) {
          throw new Error(`Delete failed: ${updateError.message}`);
        }

        // 3. Cancel all pending reminders for this subscription
        await client
          .from("reminder_schedules")
          .delete()
          .eq("subscription_id", subscriptionId);

        // 4. Sync to blockchain (non-fatal if it fails)
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
          logger.error("Blockchain sync error during deletion (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error:
              blockchainError instanceof Error
                ? blockchainError.message
                : String(blockchainError),
          };
        }

        // 5. Log and trigger budget check
        logger.info("Subscription deleted", { subscriptionId, userId, syncStatus });
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

    await this.invalidateSubscriptionCache(userId);
    return result;
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
            status: "deleted",
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updateError) {
          throw new Error(`Delete failed: ${updateError.message}`);
        }

        // 3. Cancel all pending reminders for this subscription
        await client
          .from("reminder_schedules")
          .delete()
          .eq("subscription_id", subscriptionId);

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
   * Restore a soft-deleted subscription
   */
  async restoreSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
      try {
        const { data: existing, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !existing) {
          throw new Error("Subscription not found or access denied");
        }

        if (existing.status !== "deleted") {
          throw new Error("Subscription is not deleted");
        }

        const { data: subscription, error: updateError } = await client
          .from("subscriptions")
          .update({
            status: "active",
            deleted_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updateError) {
          throw new Error(`Restore failed: ${updateError.message}`);
        }

        let blockchainResult;
        let syncStatus: "synced" | "partial" | "failed" = "synced";

        try {
          blockchainResult = await blockchainService.syncSubscription(
            userId,
            subscriptionId,
            "create", // We sync a restore as a create on the blockchain
            subscription,
          );

          if (!blockchainResult.success) {
            syncStatus = "partial";
            logger.warn("Blockchain sync failed for subscription restore", {
              subscriptionId,
              error: blockchainResult.error,
            });
          }
        } catch (blockchainError) {
          syncStatus = "partial";
          logger.error("Blockchain sync error during restore (non-fatal):", blockchainError);
          blockchainResult = {
            success: false,
            error: blockchainError instanceof Error ? blockchainError.message : String(blockchainError),
          };
        }

        logger.info("Subscription restored", { subscriptionId, userId, syncStatus });
        return { subscription, blockchainResult, syncStatus };
      } catch (error) {
        logger.error("Subscription restore failed:", error);
        throw error;
      }
    });
  }

  /**
   * Hard-delete subscriptions that were soft-deleted over 30 days ago
   */
  async purgeDeletedSubscriptions(daysToKeep: number = 30): Promise<{ deletedCount: number }> {
    try {
      const purgeDate = new Date();
      purgeDate.setDate(purgeDate.getDate() - daysToKeep);

      // Perform the actual hard delete from the database
      // This cascades into reminders and tags via foreign keys if configured correctly,
      // otherwise, we are just relying on the direct delete.
      const { data, error, count } = await databaseRepository
        .from("subscriptions")
        .delete({ count: "exact" })
        .eq("status", "deleted")
        .lt("deleted_at", purgeDate.toISOString());

      if (error) {
        throw new Error(`Purge failed: ${error.message}`);
      }

      const deletedCount = count || 0;
      if (deletedCount > 0) {
        logger.info(`Purged ${deletedCount} soft-deleted subscriptions (older than ${daysToKeep} days).`);
      }

      return { deletedCount };
    } catch (error) {
      logger.error("Failed to purge deleted subscriptions:", error);
      throw error;
    }
  }

  async pauseSubscription(
    userId: string,
    subscriptionId: string,
    resumeAt?: string,
    reason?: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
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
    });
  }

  async resumeSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionSyncResult> {
    return await DatabaseTransaction.execute(async (client) => {
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
    });
  }


  /**
   * Update subscription with optional optimistic locking and blockchain sync
   */
  async updateSubscription(
    userId: string,
    subscriptionId: string,
    input: SubscriptionUpdateInput,
    expectedVersion?: number,
  ): Promise<SubscriptionSyncResult> {
    const result = await DatabaseTransaction.execute(async (client) => {
      try {
        // 1. Fetch and verify ownership
        const { data: existing, error: fetchError } = await client
          .from("subscriptions")
          .select("*")
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .single();

        if (fetchError || !existing) {
          throw new Error("Subscription not found or access denied");
        }

        // 2. Optimistic locking check
        if (expectedVersion !== undefined && existing.version !== expectedVersion) {
          throw new Error("Subscription was modified by another request. Please refresh and try again.");
        }

        // 3. Write update to DB
        const { data: subscription, error: updateError } = await client
          .from("subscriptions")
          .update({
            ...input,
            version: (existing.version ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscriptionId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updateError) {
          throw new Error(`Update failed: ${updateError.message}`);
        }

        // 4. Sync to blockchain (non-fatal if it fails)
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

    await this.invalidateSubscriptionCache(userId);
    return result;
  }

  /**
   * Get subscription by ID (with ownership check)
   */
  async getSubscription(userId: string, subscriptionId: string): Promise<Subscription> {
    const cacheKey = { subscriptionId };
    const cached = await queryCacheService.get<Subscription>(userId, 'subscription_detail', cacheKey);
    if (cached) {
      return cached;
    }

    const { data: subscription, error } = await databaseRepository
      .from("subscriptions")
      .select("*")
      .eq("id", subscriptionId)
      .eq("user_id", userId)
      .single();

    if (error || !subscription) {
      throw new Error("Subscription not found or access denied");
    }

    await queryCacheService.set(
      userId,
      'subscription_detail',
      cacheKey,
      subscription,
      queryCacheService.getDefaultSubscriptionListTtl(),
    );

    return subscription;
  }

  /**
   * List user's subscriptions with optional filtering and cursor-based pagination
   */
  async listSubscriptions(
    userId: string,
    options: ListSubscriptionsOptions = {},
  ): Promise<ListSubscriptionsResult> {
    const cachePayload = { ...options };
    const cached = await queryCacheService.get<ListSubscriptionsResult>(
      userId,
      'subscription_list',
      cachePayload,
    );
    if (cached) {
      return cached;
    }

    const limit = Math.min(options.limit ?? 20, 100);

    const validatedCursor = validateCursor(options.cursor);

    let query = databaseRepository
      .from("subscriptions")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (options.status) {
      query = query.eq("status", options.status);
    } else {
      // By default exclude soft-deleted subscriptions
      query = query.neq("status", "deleted");
    }

    if (options.category) {
      query = query.eq("category", options.category);
    }

    if (options.encryptedOnly) {
      query = query.eq("is_encrypted", true);
    }

    if (validatedCursor) {
      query = query.lt("created_at", validatedCursor.createdAt);
    }

    const { data: rows, error, count } = await query;

if (error) {
      throw new Error(`Failed to fetch subscriptions: ${error.message}`);
    }

    const hasMore = (rows?.length ?? 0) > limit;
    const subscriptions = hasMore ? rows!.slice(0, limit) : (rows ?? []);

    // Build next cursor from the last item in the page
    const nextCursor =
      hasMore && subscriptions.length > 0
        ? encodeCursor({ createdAt: subscriptions[subscriptions.length - 1].created_at })
        : null;

    const result = {
      subscriptions,
      total: count ?? 0,
      hasMore,
      nextCursor,
    };

    await queryCacheService.set(
      userId,
      'subscription_list',
      cachePayload,
      result,
      queryCacheService.getDefaultSubscriptionListTtl(),
    );

    return result;
  }

  private async invalidateSubscriptionCache(userId: string): Promise<void> {
    await Promise.all([
      queryCacheService.invalidateUserNamespace(userId, 'subscription_list'),
      queryCacheService.invalidateUserNamespace(userId, 'subscription_detail'),
      queryCacheService.invalidateUserNamespace(userId, 'analytics_summary'),
    ]);
  }

  async getSubscriptionEncryptionSummary(userId: string): Promise<{
    total: number;
    encrypted: number;
    unencrypted: number;
  }> {
    const { count: totalCount, error: totalError } = await databaseRepository
      .from("subscriptions")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId);

    if (totalError) {
      throw new Error(`Failed to compute subscription summary: ${totalError.message}`);
    }

    const { count: encryptedCount, error: encryptedError } = await databaseRepository
      .from("subscriptions")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("is_encrypted", true);

    if (encryptedError) {
      throw new Error(`Failed to compute encrypted subscription summary: ${encryptedError.message}`);
    }

    const total = totalCount ?? 0;
    const encrypted = encryptedCount ?? 0;
    return {
      total,
      encrypted,
      unencrypted: Math.max(0, total - encrypted),
    };
  }

  async encryptAllUnencryptedSubscriptions(userId: string, encryptionKey?: string): Promise<{ count: number }> {
    const preferences = await userPreferenceService.getPreferences(userId);
    const key = encryptionKey?.trim() || preferences.encryption_key;

    if (!key) {
      throw new Error("Encryption key is required to encrypt subscriptions");
    }

    const { data: subscriptions, error: fetchError } = await databaseRepository
      .from("subscriptions")
      .select("id, name, price, category, renewal_url")
      .eq("user_id", userId)
      .eq("is_encrypted", false);

    if (fetchError) {
      throw new Error(`Failed to load subscriptions for encryption: ${fetchError.message}`);
    }

    if (!subscriptions || subscriptions.length === 0) {
      return { count: 0 };
    }

    const updates = await Promise.all(
      subscriptions.map(async (subscription: any) => {
        const updated: Partial<Subscription> & Record<string, unknown> = {
          is_encrypted: true,
        };

        if (typeof subscription.name === "string") {
          updated.encrypted_name = JSON.stringify(await encryptMetadata(subscription.name, key));
        }

        if (typeof subscription.price === "number") {
          updated.encrypted_price = JSON.stringify(await encryptMetadata(subscription.price.toString(), key));
        }

        if (typeof subscription.category === "string" && subscription.category.length > 0) {
          updated.encrypted_category = JSON.stringify(await encryptMetadata(subscription.category, key));
        }

        if (typeof subscription.renewal_url === "string" && subscription.renewal_url.length > 0) {
          updated.encrypted_renewal_url = JSON.stringify(await encryptMetadata(subscription.renewal_url, key));
        }

        return {
          id: subscription.id,
          update: updated,
        };
      }),
    );

    for (const { id, update } of updates) {
      const { error: updateError } = await databaseRepository
        .from("subscriptions")
        .update(update)
        .eq("id", id)
        .eq("user_id", userId);

      if (updateError) {
        throw new Error(`Failed to encrypt subscription ${id}: ${updateError.message}`);
      }
    }

    return { count: updates.length };
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

  /**
   * Get price history for a subscription
   */
  async getPriceHistory(
    userId: string,
    subscriptionId: string
  ): Promise<any[]> {
    const { data, error } = await databaseRepository
      .from("subscription_price_history")
      .select("*")
      .eq("subscription_id", subscriptionId)
      .eq("user_id", userId)
      .order("changed_at", { ascending: false });

    if (error) {
      logger.error("Failed to fetch price history:", error);
      throw new Error(`Failed to fetch price history: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Recover all stealth addresses for a user by re-deriving them from their
   * stored indices. Useful for wallet recovery without on-chain scanning.
   *
   * For each subscription with a stealth_index, computes:
   *   Address = HMAC-SHA256(metaAddress, `${subscription.id}:${stealth_index}`)
   *
   * @param userId - Owner whose subscriptions to re-derive.
   * @param metaAddress - The user's stealth meta-address (wallet-level secret).
   * @returns Array of { subscriptionId, stealthIndex, stealthAddress }.
   */
  async recoverStealthAddresses(
    userId: string,
    metaAddress: string,
  ): Promise<{ subscriptionId: string; stealthIndex: number; stealthAddress: string }[]> {
    const { data: rows, error } = await databaseRepository
      .from("subscriptions")
      .select("id, stealth_index")
      .eq("user_id", userId)
      .order("stealth_index", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch subscriptions for recovery: ${error.message}`);
    }

    return (rows ?? []).map((row) => ({
      subscriptionId: row.id as string,
      stealthIndex: row.stealth_index as number,
      stealthAddress: deriveStealthAddress(metaAddress, row.id as string, row.stealth_index as number),
    }));
  }

  /**
   * Auto-tag a subscription with a category based on its name.
   * Uses keyword mapping from SERVICE_CATEGORIES lookup table.
   * Falls back to 'other' if no match is found.
   */
  autoTag(name: string): string {
    const normalized = name
      .toLowerCase()
      .replace(/\s+(plus|pro|premium|basic|standard|enterprise|team|business)$/i, '')
      .trim();

    // Exact match first
    if (SERVICE_CATEGORIES[normalized]) {
      return SERVICE_CATEGORIES[normalized];
    }

    // Partial match — check if any key is contained in the name or vice versa
    for (const [key, category] of Object.entries(SERVICE_CATEGORIES)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return category;
      }
    }

    return 'other';
  }
}

export const subscriptionService = new SubscriptionService();
