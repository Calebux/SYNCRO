/**
 * Shared shutdown state for graceful drain signaling.
 */

export interface ShutdownTimelineEntry {
  phase: string;
  timestamp: string;
  elapsedMs: number;
}

let draining = false;
let shutdownStartedAt: number | null = null;
const timeline: ShutdownTimelineEntry[] = [];

export function isDraining(): boolean {
  return draining;
}

export function beginDrain(): void {
  if (draining) {
    return;
  }
  draining = true;
  shutdownStartedAt = Date.now();
  recordPhase('drain_started');
}

export function recordPhase(phase: string): void {
  const startedAt = shutdownStartedAt ?? Date.now();
  timeline.push({
    phase,
    timestamp: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
  });
}

export function getShutdownTimeline(): readonly ShutdownTimelineEntry[] {
  return timeline;
}

export function resetShutdownStateForTests(): void {
  draining = false;
  shutdownStartedAt = null;
  timeline.length = 0;
}

export function drainAwareStatus(baseStatus: string): { status: string; draining: boolean } {
  if (isDraining()) {
    return { status: 'draining', draining: true };
  }
  return { status: baseStatus, draining: false };
}
