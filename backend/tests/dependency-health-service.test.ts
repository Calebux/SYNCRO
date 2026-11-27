import {
  computeReadiness,
  type DependencyStatus,
} from '../src/services/dependency-health-service';

// Keep the heavy/stateful transitive imports out of this pure-logic test.
jest.mock('../src/config/database', () => ({ supabase: {} }));
jest.mock('../src/config/redis', () => ({ redis: null }));
jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/services/scheduler', () => ({
  schedulerService: { getStatus: jest.fn() },
}));

const healthy = (name: string): DependencyStatus => ({ name, status: 'healthy' });
const degraded = (name: string): DependencyStatus => ({ name, status: 'degraded' });
const unhealthy = (name: string): DependencyStatus => ({ name, status: 'unhealthy' });

describe('computeReadiness', () => {
  it('reports ready when every critical dependency is healthy', () => {
    const result = computeReadiness([
      healthy('database'),
      healthy('redis'),
      healthy('rpc_horizon'),
      healthy('fx_provider'),
    ]);

    expect(result.status).toBe('ready');
    expect(result.message).toBe('All critical dependencies healthy');
  });

  it('reports ready (with a note) when only non-critical dependencies are degraded', () => {
    const result = computeReadiness([
      healthy('database'),
      healthy('redis'),
      healthy('rpc_horizon'),
      healthy('fx_provider'),
      degraded('queue'),
      degraded('providers'),
      degraded('scheduler'),
    ]);

    expect(result.status).toBe('ready');
    expect(result.message).toBe('Some dependencies degraded: queue, providers, scheduler');
  });

  it('reports not_ready when a critical dependency is unhealthy', () => {
    const result = computeReadiness([
      unhealthy('database'),
      healthy('redis'),
      healthy('rpc_horizon'),
      healthy('fx_provider'),
    ]);

    expect(result.status).toBe('not_ready');
    expect(result.message).toContain('database');
    expect(result.message).toContain('unhealthy');
  });

  it('reports not_ready when a critical dependency is degraded (not only unhealthy)', () => {
    const result = computeReadiness([
      healthy('database'),
      degraded('redis'),
      healthy('rpc_horizon'),
      healthy('fx_provider'),
    ]);

    expect(result.status).toBe('not_ready');
    expect(result.message).toContain('redis');
    expect(result.message).toContain('degraded');
  });

  it('reports not_ready listing every critical dependency that is not healthy', () => {
    const result = computeReadiness([
      unhealthy('database'),
      degraded('redis'),
      degraded('rpc_horizon'),
      healthy('fx_provider'),
    ]);

    expect(result.status).toBe('not_ready');
    expect(result.message).toContain('database');
    expect(result.message).toContain('redis');
    expect(result.message).toContain('rpc_horizon');
    expect(result.message).not.toContain('fx_provider');
  });
});
