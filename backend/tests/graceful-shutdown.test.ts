import {
  beginDrain,
  drainAwareStatus,
  getShutdownTimeline,
  isDraining,
  recordPhase,
  resetShutdownStateForTests,
} from '../src/lib/shutdown-state';

describe('shutdown-state', () => {
  beforeEach(() => {
    resetShutdownStateForTests();
  });

  it('starts not draining', () => {
    expect(isDraining()).toBe(false);
  });

  it('enters draining state once', () => {
    beginDrain();
    beginDrain();
    expect(isDraining()).toBe(true);
  });

  it('records shutdown timeline phases', () => {
    beginDrain();
    recordPhase('bullmq_shutdown_complete');

    const timeline = getShutdownTimeline();
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline[0]?.phase).toBe('drain_started');
    expect(timeline.at(-1)?.phase).toBe('bullmq_shutdown_complete');
    expect(timeline.at(-1)?.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('drainAwareStatus', () => {
  beforeEach(() => {
    resetShutdownStateForTests();
  });

  it('returns draining status while shutting down', () => {
    beginDrain();
    expect(drainAwareStatus('ok')).toEqual({ status: 'draining', draining: true });
  });

  it('returns base status when not draining', () => {
    expect(drainAwareStatus('ok')).toEqual({ status: 'ok', draining: false });
  });
});
