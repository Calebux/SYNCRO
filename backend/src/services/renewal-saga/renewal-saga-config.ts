export const RENEWAL_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** A saga whose current step hasn't advanced in this long is considered stuck/orphaned. */
export const RENEWAL_SAGA_STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes