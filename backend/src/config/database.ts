import { createClient } from '@supabase/supabase-js';
import logger from './logger';
import { env } from './env';

const isTest = env.NODE_ENV === 'test';
const supabaseUrl = env.SUPABASE_URL || (isTest ? 'http://localhost' : '');
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY || (isTest ? 'test-key' : '');

if (!supabaseUrl || !supabaseServiceKey) {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }
}

export const supabase = createClient(supabaseUrl || 'http://localhost', supabaseServiceKey || 'test-key', {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ---------------------------------------------------------------------------
// Connection pool monitoring (issue #278)
// ---------------------------------------------------------------------------

const POOL_SIZE = 10;
const LEAK_THRESHOLD_MS = 30_000;

export interface PoolMetrics {
  activeConnections: number;
  idleConnections: number;
  totalRequests: number;
  leakWarnings: number;
}

const _pool: PoolMetrics = {
  activeConnections: 0,
  idleConnections: POOL_SIZE,
  totalRequests: 0,
  leakWarnings: 0,
};

/** Returns a snapshot of current connection pool metrics. */
export function monitorPool(): PoolMetrics {
  return { ..._pool };
}

/**
 * Call before a DB operation. Returns a release function to call when done.
 * Logs a warning if the connection is held for longer than LEAK_THRESHOLD_MS.
 */
export function trackDbRequest(): () => void {
  _pool.activeConnections = Math.min(_pool.activeConnections + 1, POOL_SIZE);
  _pool.idleConnections = Math.max(0, POOL_SIZE - _pool.activeConnections);
  _pool.totalRequests++;

  const leakTimer = setTimeout(() => {
    _pool.leakWarnings++;
    logger.warn('Possible DB connection leak: request held for >' + LEAK_THRESHOLD_MS + 'ms', {
      activeConnections: _pool.activeConnections,
      leakWarnings: _pool.leakWarnings,
    });
  }, LEAK_THRESHOLD_MS);

  return () => {
    _pool.activeConnections = Math.max(0, _pool.activeConnections - 1);
    _pool.idleConnections = Math.min(POOL_SIZE, _pool.idleConnections + 1);
    clearTimeout(leakTimer);
  };
}

