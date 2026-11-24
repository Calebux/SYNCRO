import {
  OnChainAgentRegistryReader,
  expiryToIso,
  scopeMaskToScopes,
} from '../src/v3/onchain-agent-registry-reader';
import { ScopeEnforcer } from '../src/v3/scope-enforcer';
import { ScopeRejectionError } from '../src/v3/types';

describe('OnChainAgentRegistryReader', () => {
  it('maps the on-chain expiry (seconds) into expiresAt', async () => {
    const reader = new OnChainAgentRegistryReader({
      async getAgent() {
        return { scopeMask: 0b001, expiresAtSec: 1_900_000_000n };
      },
    });

    const grant = await reader.getGrant('agent-1');
    expect(grant.expiresAt).toBe(new Date(1_900_000_000 * 1000).toISOString());
    expect(grant.scopes).toEqual(['renewals']);
    expect(grant.revokedAt).toBeNull();
  });

  it('maps "no expiry" to null', async () => {
    const reader = new OnChainAgentRegistryReader({
      async getAgent() {
        return { scopeMask: 0b110, expiresAtSec: null };
      },
    });

    const grant = await reader.getGrant('agent-1');
    expect(grant.expiresAt).toBeNull();
    expect(grant.scopes).toEqual(['giftcards', 'approvals']);
  });

  it('fails when the agent is not registered on-chain', async () => {
    const reader = new OnChainAgentRegistryReader({
      async getAgent() {
        return null;
      },
    });
    await expect(reader.getGrant('ghost')).rejects.toThrow('grant not found');
  });

  it('makes ScopeEnforcer reject an expired on-chain grant', async () => {
    const pastSec = Math.floor(Date.now() / 1000) - 60;
    const enforcer = new ScopeEnforcer(
      new OnChainAgentRegistryReader(
        {
          async getAgent() {
            return { scopeMask: 0b001, expiresAtSec: pastSec };
          },
        },
        ['POST:/paid'],
      ),
    );

    await expect(
      enforcer.assertAllowed({ agentId: 'agent-1', routeScope: 'POST:/paid' }),
    ).rejects.toMatchObject<Partial<ScopeRejectionError>>({ code: 'grant_expired' });
  });

  it('accepts a grant that has not expired yet', async () => {
    const futureSec = Math.floor(Date.now() / 1000) + 3600;
    const enforcer = new ScopeEnforcer(
      new OnChainAgentRegistryReader(
        {
          async getAgent() {
            return { scopeMask: 0b001, expiresAtSec: futureSec };
          },
        },
        ['POST:/paid'],
      ),
    );

    await expect(
      enforcer.assertAllowed({ agentId: 'agent-1', routeScope: 'POST:/paid' }),
    ).resolves.toBeUndefined();
  });

  it('rejects nonsense expiries', () => {
    expect(() => expiryToIso(-1)).toThrow();
    expect(scopeMaskToScopes(0)).toEqual([]);
  });
});
