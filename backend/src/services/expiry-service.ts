import { supabase, databaseRepository } from '../config/database';
import logger from '../config/logger';
import { loadExpiryConfig, getThresholdForCycle } from '../config/expiry';
import { daysUntilExpiry } from '../utils/expiry';

export interface ExpiryResult {
  processed: number;
  expired: number;
  warnings: number;
  errors: number;
}

export class ExpiryService {
  /**
   * Process all active subscriptions for expiry and warning notifications.
   * Thresholds are read from env vars per billing cycle; lifetime subs are skipped.
   */
  async processExpiries(): Promise<ExpiryResult> {
    logger.info('Processing subscription expiries');

    const result: ExpiryResult = { processed: 0, expired: 0, warnings: 0, errors: 0 };

    try {
      const config = loadExpiryConfig();

      // Determine which billing cycles have thresholds configured
      const enabledCycles: string[] = [];
      if (config.monthly !== null) enabledCycles.push('monthly');
      if (config.quarterly !== null) enabledCycles.push('quarterly');
      if (config.yearly !== null) enabledCycles.push('yearly');

      if (enabledCycles.length === 0) {
        logger.info('No expiry thresholds configured, skipping');
        return result;
      }

      // Fetch candidates: active subscriptions with enabled billing cycles
      const { data: candidates, error } = await databaseRepository
        .from('subscriptions')
        .select('id, user_id, name, billing_cycle, last_used_at, created_at')
        .eq('status', 'active')
        .in('billing_cycle', enabledCycles);

      if (error) {
        logger.error('Failed to fetch expiry candidates:', error);
        throw error;
      }

      if (!candidates || candidates.length === 0) {
        logger.info('No expiry candidates found');
        return result;
      }

      logger.info(`Found ${candidates.length} expiry candidates`);
      result.processed = candidates.length;

      for (const sub of candidates) {
        try {
          const threshold = getThresholdForCycle(config, sub.billing_cycle);
          if (threshold === null) continue;

          const remaining = daysUntilExpiry(sub.last_used_at, sub.created_at, threshold);

          if (remaining <= 0) {
            // Expire the subscription
            await this.expireSubscription(sub, threshold);
            result.expired++;
          } else {
            // Check warning tiers
            const warned = await this.checkWarnings(sub, remaining, config.warningDays);
            if (warned) result.warnings++;
          }
        } catch (err) {
          logger.error(`Error processing expiry for subscription ${sub.id}:`, err);
          result.errors++;
        }
      }
    } catch (error) {
      logger.error('Error processing expiries:', error);
      throw error;
    }

    logger.info(
      `Expiry processing complete: ${result.processed} processed, ${result.expired} expired, ${result.warnings} warnings, ${result.errors} errors`
    );
    return result;
  }

  private async expireSubscription(
    sub: { id: string; user_id: string; name: string; billing_cycle: string },
    thresholdDays: number
  ): Promise<void> {
    const now = new Date().toISOString();

    const { error: updateError } = await databaseRepository
      .from('subscriptions')
      .update({
        status: 'expired',
        expired_at: now,
        updated_at: now,
      })
      .eq('id', sub.id)
      .eq('status', 'active');

    if (updateError) {
      logger.error(`Failed to expire subscription ${sub.id}:`, updateError);
      throw updateError;
    }

    // Insert expiry notification
    const { error: notifError } = await databaseRepository
      .from('notifications')
      .insert({
        user_id: sub.user_id,
        title: 'Subscription Expired',
        description: `${sub.name} has been automatically expired due to ${thresholdDays} days of inactivity.`,
        type: 'alert',
        subscription_data: {
          subscription_id: sub.id,
          name: sub.name,
          expired_at: now,
          threshold_days: thresholdDays,
        },
      });

    if (notifError) {
      logger.warn(`Failed to create notification for expired subscription ${sub.id}:`, notifError);
    }

    logger.info(`Expired subscription ${sub.id} (${sub.name}) after ${thresholdDays} days of inactivity`);
  }

  private async checkWarnings(
    sub: { id: string; user_id: string; name: string },
    daysRemaining: number,
    warningTiers: number[]
  ): Promise<boolean> {
    // Find the applicable warning tier (highest tier that daysRemaining falls within)
    const tier = warningTiers.find((t) => daysRemaining <= t);
    if (!tier) return false;

    // Check if this warning was already sent (dedup via subscription_data containment)
    const { data: existing, error: checkError } = await databaseRepository
      .from('notifications')
      .select('id')
      .eq('user_id', sub.user_id)
      .contains('subscription_data', {
        subscription_id: sub.id,
        warning_type: 'expiry_warning',
        warning_tier: tier,
      })
      .limit(1);

    if (checkError) {
      logger.warn(`Failed to check existing warnings for subscription ${sub.id}:`, checkError);
      return false;
    }

    if (existing && existing.length > 0) {
      return false; // Already sent this tier
    }

    // Insert warning notification
    const { error: notifError } = await databaseRepository
      .from('notifications')
      .insert({
        user_id: sub.user_id,
        title: 'Subscription Expiring Soon',
        description: `${sub.name} will expire in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} due to inactivity.`,
        type: 'warning',
        subscription_data: {
          subscription_id: sub.id,
          name: sub.name,
          warning_type: 'expiry_warning',
          warning_tier: tier,
          days_remaining: daysRemaining,
        },
      });

    if (notifError) {
      logger.warn(`Failed to create warning notification for subscription ${sub.id}:`, notifError);
      return false;
    }

    logger.info(`Sent ${tier}-day expiry warning for subscription ${sub.id} (${sub.name}), ${daysRemaining} days remaining`);
    return true;
  }
}

export const expiryService = new ExpiryService();
