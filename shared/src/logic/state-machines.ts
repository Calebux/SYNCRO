/**
 * State transition validators for domain entities.
 *
 * Layer 1 (logic): pure functions, no side effects.
 * Imports only from types/.
 */

import type { SubscriptionStatus } from '../types/subscription';
import type { CanonicalRenewalState } from '../types/domain-glossary';

/**
 * Validate subscription status transitions.
 *
 * Allowed transitions:
 * - active → paused, cancelled, expired
 * - trial → active
 * - paused → active
 * - expired → active (reactivation)
 * - cancelled → (terminal state)
 */
export function isValidSubscriptionTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  const transitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
    active: ['paused', 'cancelled', 'expired'],
    trial: ['active', 'cancelled', 'expired'],
    paused: ['active', 'cancelled', 'expired'],
    expired: ['active', 'cancelled'],
    cancelled: [], // terminal
  };

  return transitions[from]?.includes(to) ?? false;
}

/**
 * Validate renewal status transitions.
 *
 * Allowed transitions:
 * - pending → processing, cancelled
 * - processing → succeeded, failed
 * - succeeded → (terminal)
 * - failed → pending (retry), cancelled
 * - cancelled → (terminal)
 */
export function isValidRenewalTransition(from: CanonicalRenewalState, to: CanonicalRenewalState): boolean {
  const transitions: Record<CanonicalRenewalState, CanonicalRenewalState[]> = {
    scheduled: ['cooldown'],
    cooldown: ['pending_approval', 'executing'],
    pending_approval: ['approved'],
    approved: ['executing'],
    executing: ['settled', 'failed'],
    settled: [],
    failed: ['scheduled', 'dead_lettered'],
    dead_lettered: [],
  };

  return transitions[from]?.includes(to) ?? false;
}
