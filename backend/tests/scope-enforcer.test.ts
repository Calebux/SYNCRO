import { ScopeEnforcer } from '../src/v3/scope-enforcer';
import { ScopeRejectionError } from '../src/v3/types';

describe('ScopeEnforcer', () => {
  it('rejects missing scope distinctly', async () => {
    const enforcer = new ScopeEnforcer({
      async getGrant() {
        return {
          agentId: 'agent-1',
          scopes: ['GET:/allowed'],
          expiresAt: null,
          revokedAt: null,
        };
      },
    });

    await expect(
      enforcer.assertAllowed({ agentId: 'agent-1', routeScope: 'POST:/paid' }),
    ).rejects.toMatchObject<Partial<ScopeRejectionError>>({
      code: 'missing_scope',
    });
  });

  it('distinguishes expiry from missing scope', async () => {
    const enforcer = new ScopeEnforcer({
      async getGrant() {
        return {
          agentId: 'agent-1',
          scopes: ['POST:/paid'],
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
          revokedAt: null,
        };
      },
    });

    await expect(
      enforcer.assertAllowed({ agentId: 'agent-1', routeScope: 'POST:/paid' }),
    ).rejects.toMatchObject<Partial<ScopeRejectionError>>({
      code: 'grant_expired',
    });
  });

  it('distinguishes revocation from missing scope', async () => {
    const enforcer = new ScopeEnforcer({
      async getGrant() {
        return {
          agentId: 'agent-1',
          scopes: ['POST:/paid'],
          expiresAt: null,
          revokedAt: new Date(Date.now() - 1_000).toISOString(),
        };
      },
    });

    await expect(
      enforcer.assertAllowed({ agentId: 'agent-1', routeScope: 'POST:/paid' }),
    ).rejects.toMatchObject<Partial<ScopeRejectionError>>({
      code: 'grant_revoked',
    });
  });

  it('fails closed when registry read fails on stale cache refresh', async () => {
    let callCount = 0;
    const enforcer = new ScopeEnforcer(
      {
        async getGrant() {
          callCount += 1;
          if (callCount === 1) {
            return {
              agentId: 'agent-1',
              scopes: ['POST:/paid'],
              expiresAt: null,
              revokedAt: null,
            };
          }
          throw new Error('registry down');
        },
      },
      {
        cacheSoftTtlMs: 1,
        cacheTtlMs: 5_000,
      },
    );

    await expect(
      enforcer.assertAllowed({ agentId: 'agent-1', routeScope: 'POST:/paid' }),
    ).resolves.toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(
      enforcer.assertAllowed({ agentId: 'agent-1', routeScope: 'POST:/paid' }),
    ).rejects.toMatchObject<Partial<ScopeRejectionError>>({
      code: 'registry_unavailable',
    });
  });
});

