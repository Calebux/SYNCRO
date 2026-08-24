import logger from '../config/logger';
import { supabase, databaseRepository, databaseRepository } from '../config/database';

export class RenewalLockService {
  /**
   * Acquire a renewal lock for a subscription/cycle pair.
   * Uses PostgreSQL unique partial index for atomic locking.
   */
  async acquireLock(
    subscriptionId: string,
    cycleId: number,
    lockHolder: string,
    ttlMs: number
  ): Promise<boolean> {
    // First, clean up any expired locks for this subscription/cycle
    await this.releaseExpiredLocksForSubscription(subscriptionId, cycleId);

    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    const { error } = await databaseRepository.from('renewal_locks').insert({
      subscription_id: subscriptionId,
      cycle_id: cycleId,
      lock_holder: lockHolder,
      expires_at: expiresAt,
      status: 'active',
    });

    if (error) {
      // PostgreSQL unique violation = lock held by another worker
      if (error.code === '23505') {
        logger.warn('Renewal lock already held', {
          subscriptionId,
          cycleId,
          lockHolder,
        });
        return false;
      }
      logger.error('Failed to acquire renewal lock', { error, subscriptionId, cycleId });
      throw error;
    }

    logger.info('Renewal lock acquired', { subscriptionId, cycleId, lockHolder, expiresAt });
    return true;
  }

  /**
   * Release a renewal lock (marks as released for audit trail).
   */
  async releaseLock(subscriptionId: string, cycleId: number): Promise<void> {
    const { error } = await databaseRepository
      .from('renewal_locks')
      .update({ status: 'released' })
      .eq('subscription_id', subscriptionId)
      .eq('cycle_id', cycleId)
      .eq('status', 'active');

    if (error) {
      logger.error('Failed to release renewal lock', { error, subscriptionId, cycleId });
      throw error;
    }

    logger.info('Renewal lock released', { subscriptionId, cycleId });
  }

  /**
   * Release all globally expired active locks (for cron cleanup).
   */
  async releaseExpiredLocks(): Promise<number> {
    const now = new Date().toISOString();

    const { data, error } = await databaseRepository
      .from('renewal_locks')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .lt('expires_at', now)
      .select('id');

    if (error) {
      logger.error('Failed to release expired locks', { error });
      throw error;
    }

    const count = data?.length ?? 0;
    if (count > 0) {
      logger.info('Released expired renewal locks', { count });
    }
    return count;
  }

  /**
   * Check if a subscription currently has an active, non-expired lock.
   */
  async isLocked(subscriptionId: string): Promise<boolean> {
    const now = new Date().toISOString();

    const { data, error } = await databaseRepository
      .from('renewal_locks')
      .select('id')
      .eq('subscription_id', subscriptionId)
      .eq('status', 'active')
      .gte('expires_at', now)
      .limit(1);

    if (error) {
      logger.error('Failed to check renewal lock', { error, subscriptionId });
      throw error;
    }

    return (data?.length ?? 0) > 0;
  }

  /**
   * Release expired locks for a specific subscription/cycle (used before acquiring).
   */
  private async releaseExpiredLocksForSubscription(
    subscriptionId: string,
    cycleId: number
  ): Promise<void> {
    const now = new Date().toISOString();

    await databaseRepository
      .from('renewal_locks')
      .update({ status: 'expired' })
      .eq('subscription_id', subscriptionId)
      .eq('cycle_id', cycleId)
      .eq('status', 'active')
      .lt('expires_at', now);
  }
}

export const renewalLockService = new RenewalLockService();
