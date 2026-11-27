process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

import { Keypair } from '@stellar/stellar-sdk';
import {
  AgentConsoleService,
  InMemoryAgentConsoleStore,
} from '../src/v3/agent-console-service';

describe('agent console persistence (issue #1703)', () => {
  it('agents and authority survive a restart via the store', () => {
    const store = new InMemoryAgentConsoleStore();
    const now = Date.now();
    const service = new AgentConsoleService(() => now, { store });
    const principal = Keypair.random().publicKey();
    const agentKey = Keypair.random().publicKey();

    const created = service.registerAgent(principal, { publicKey: agentKey, label: 'api' });
    expect(created.publicKey).toBe(agentKey);

    // Simulate a restart: a new service over the same store sees the agent.
    const restarted = new AgentConsoleService(() => now, { store });
    const agents = restarted.listAgents(principal, () => 0);
    expect(agents.map((a) => a.publicKey)).toContain(agentKey);
    expect(store.load()?.agents.length).toBe(1);
  });

  it('a failed chain write leaves no orphaned database row', () => {
    const store = new InMemoryAgentConsoleStore();
    const failingChain = {
      registerAgent: () => {
        throw new Error('chain unavailable');
      },
      closeAgent: () => {},
    };
    const service = new AgentConsoleService(() => Date.now(), { store, chainRegistry: failingChain });
    const principal = Keypair.random().publicKey();

    expect(() =>
      service.registerAgent(principal, { publicKey: Keypair.random().publicKey() }),
    ).toThrow('chain unavailable');
    const saved = store.load();
    expect(saved?.agents.length ?? 0).toBe(0);
  });
});
