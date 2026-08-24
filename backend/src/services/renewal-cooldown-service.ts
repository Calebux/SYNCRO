import { supabase, databaseRepository } from "../config/database";
import logger from "../config/logger";

export interface CooldownCheckResult {
  canRetry: boolean;
  isOnCooldown: boolean;
  timeRemainingSeconds: number;
  lastAttemptAt: Date | null;
  nextRetryAt?: Date;
}

export interface CooldownUpdateResult {
  previous_attempt_at: string | null;
  new_attempt_at: string;
}

/**
 * Service to manage renewal attempt cooldown periods
 * Prevents rapid repeated retry attempts from spamming the network
 */
export class RenewalCooldownService {
  /**
   * Default cooldown period in minutes
   */
  private static readonly DEFAULT_COOLDOWN_MINUTES = 5;

  /**
   * Check if a renewal attempt can proceed or if cooldown is still active
   * Queries the database function check_renewal_cooldown for accurate time calculations
   */
  async checkCooldown(
    subscriptionId: string,
    customCooldownMinutes?: number,
  ): Promise<CooldownCheckResult> {
    try {
      const cooldownMinutes = customCooldownMinutes || RenewalCooldownService.DEFAULT_COOLDOWN_MINUTES;

      // First, fetch the subscription to get last_renewal_attempt_at
      const { data: subscription, error: fetchError } = await databaseRepository
        .from("subscriptions")
        .select("last_renewal_attempt_at, renewal_cooldown_minutes")
        .eq("id", subscriptionId)
        .single();

      if (fetchError || !subscription) {
        throw new Error(`Failed to fetch subscription: ${fetchError?.message || "Not found"}`);
      }

      // If no previous attempt, cooldown is not active
      if (!subscription.last_renewal_attempt_at) {
        return {
          canRetry: true,
          isOnCooldown: false,
          timeRemainingSeconds: 0,
          lastAttemptAt: null,
        };
      }

      const lastAttempt = new Date(subscription.last_renewal_attempt_at);
      const cooldownMs = (cooldownMinutes || subscription.renewal_cooldown_minutes || RenewalCooldownService.DEFAULT_COOLDOWN_MINUTES) * 60 * 1000;
      const now = new Date();
      const timeSinceLastAttempt = now.getTime() - lastAttempt.getTime();
      const isOnCooldown = timeSinceLastAttempt < cooldownMs;
      const timeRemainingMs = Math.max(0, cooldownMs - timeSinceLastAttempt);

      return {
        canRetry: !isOnCooldown,
        isOnCooldown,
        timeRemainingSeconds: Math.ceil(timeRemainingMs / 1000),
        lastAttemptAt: lastAttempt,
        nextRetryAt: new Date(lastAttempt.getTime() + cooldownMs),
      };
    } catch (error) {
      logger.error("Error checking renewal cooldown:", error);
      throw error;
    }
  }

  /**
   * Record a renewal attempt and update the last_renewal_attempt_at timestamp
   * Should be called after any renewal attempt (successful or failed)
   */
  async recordRenewalAttempt(
    subscriptionId: string,
    success: boolean,
    errorMessage?: string,
    attemptType: "automatic" | "manual" | "retry" = "automatic",
  ): Promise<CooldownUpdateResult> {
    try {
      // Update the subscription's last_renewal_attempt_at timestamp
      const { data: updateResult, error: updateError } = await databaseRepository
        .from("subscriptions")
        .update({
          last_renewal_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscriptionId)
        .select("last_renewal_attempt_at")
        .single();

      if (updateError) {
        throw new Error(`Failed to update last renewal attempt: ${updateError.message}`);
      }

      // Record the attempt in the renewal_attempts table
      const { error: logError } = await databaseRepository
        .from("subscription_renewal_attempts")
        .insert({
          subscription_id: subscriptionId,
          success,
          error_message: errorMessage || null,
          attempt_type: attemptType,
          attempt_date: new Date().toISOString(),
          updated_subscription_record: true,
        });

      if (logError) {
        logger.warn("Failed to log renewal attempt:", logError);
        // Don't throw here - the main operation succeeded even if logging failed
      }

      logger.info("Renewal attempt recorded", {
        subscription_id: subscriptionId,
        success,
        attempt_type: attemptType,
        timestamp: new Date().toISOString(),
      });

      return {
        previous_attempt_at: null, // Could be fetched separately if needed
        new_attempt_at: updateResult?.last_renewal_attempt_at || new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error recording renewal attempt:", error);
      throw error;
    }
  }

  /**
   * Set custom cooldown period for a specific subscription
   */
  async setCooldownPeriod(
    subscriptionId: string,
    cooldownMinutes: number,
  ): Promise<{ success: boolean; previousCooldown: number; newCooldown: number }> {
    try {
      if (cooldownMinutes < 0 || cooldownMinutes > 1440) {
        throw new Error("Cooldown period must be between 0 and 1440 minutes (24 hours)");
      }

      const { data: subscription, error: fetchError } = await databaseRepository
        .from("subscriptions")
        .select("renewal_cooldown_minutes")
        .eq("id", subscriptionId)
        .single();

      if (fetchError) {
        throw new Error(`Failed to fetch subscription: ${fetchError.message}`);
      }

      const previousCooldown = subscription.renewal_cooldown_minutes || RenewalCooldownService.DEFAULT_COOLDOWN_MINUTES;

      const { error: updateError } = await databaseRepository
        .from("subscriptions")
        .update({
          renewal_cooldown_minutes: cooldownMinutes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscriptionId);

      if (updateError) {
        throw new Error(`Failed to update cooldown period: ${updateError.message}`);
      }

      logger.info("Cooldown period updated", {
        subscription_id: subscriptionId,
        previous_cooldown: previousCooldown,
        new_cooldown: cooldownMinutes,
      });

      return {
        success: true,
        previousCooldown,
        newCooldown: cooldownMinutes,
      };
    } catch (error) {
      logger.error("Error setting cooldown period:", error);
      throw error;
    }
  }

  /**
   * Get renewal cooldown configuration for a subscription
   */
  async getCooldownConfig(subscriptionId: string): Promise<{
    cooldownMinutes: number;
    lastAttemptAt: Date | null;
    nextRetryAt?: Date;
  }> {
    try {
      const { data: subscription, error } = await databaseRepository
        .from("subscriptions")
        .select("renewal_cooldown_minutes, last_renewal_attempt_at")
        .eq("id", subscriptionId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch subscription: ${error.message}`);
      }

      const cooldownMinutes = subscription.renewal_cooldown_minutes || RenewalCooldownService.DEFAULT_COOLDOWN_MINUTES;
      const lastAttemptAt = subscription.last_renewal_attempt_at ? new Date(subscription.last_renewal_attempt_at) : null;
      const nextRetryAt = lastAttemptAt ? new Date(lastAttemptAt.getTime() + cooldownMinutes * 60 * 1000) : undefined;

      return {
        cooldownMinutes,
        lastAttemptAt,
        nextRetryAt,
      };
    } catch (error) {
      logger.error("Error getting cooldown config:", error);
      throw error;
    }
  }

  /**
   * Reset the last renewal attempt timestamp (admin/system function)
   * Use with caution - this immediately allows another retry
   */
  async resetCooldown(subscriptionId: string): Promise<{ success: boolean }> {
    try {
      const { error } = await databaseRepository
        .from("subscriptions")
        .update({
          last_renewal_attempt_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscriptionId);

      if (error) {
        throw new Error(`Failed to reset cooldown: ${error.message}`);
      }

      logger.info("Cooldown reset", { subscription_id: subscriptionId });
      return { success: true };
    } catch (error) {
      logger.error("Error resetting cooldown:", error);
      throw error;
    }
  }
}

// Export singleton instance
export const renewalCooldownService = new RenewalCooldownService();
