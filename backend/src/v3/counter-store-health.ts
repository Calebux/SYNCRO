/**
 * Health of the meter's counter store (Issue #1444).
 *
 * The counter store is whatever `Meter.reserve()` counts against — in-memory
 * today, Redis or a primary store behind the `DurableMeter` later. When it is
 * unreachable the gateway has exactly two options: refuse paid traffic or
 * serve it unbilled. Which one it does is decided per provider by
 * `DegradedAdmissionController`; this object only answers the question the
 * decision hangs on: *is the store up right now?*
 *
 * Availability is held as a flag rather than probed, because it is read once
 * per admission on the hot path — a probe there would put the outage on the
 * request path too. Whoever owns the connection (the store client, a health
 * probe, an operator kill-switch) calls `setAvailable()`; tests flip it
 * directly.
 */

export class CounterStoreHealth {
  private available = true;

  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Report the observed store state. Idempotent: repeated calls with the same
   * value never re-trigger a degraded-mode transition.
   */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  /** Convenience for connection handlers: `onError(() => health.markDown())`. */
  markDown(): void {
    this.available = false;
  }

  markUp(): void {
    this.available = true;
  }
}

/** Process-wide health flag; injected into the degraded-admission controller. */
export const counterStoreHealth = new CounterStoreHealth();
