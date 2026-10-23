import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentConsole } from '@/components/agents/AgentConsole';
import { generateKeypair } from '@/lib/agent-keys';
import type { AgentSummary, CallType } from '@/lib/agent-console';

const callTypes: CallType[] = [
  { id: 'llm:call', label: 'Language model calls', detail: 'Requests that ask a model to generate or transform text.' },
  { id: 'compute:run', label: 'Compute jobs', detail: 'Requests that run a job and return a result.' },
  { id: 'data:read', label: 'Data lookups', detail: 'Requests that read data without changing it.' },
];

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    agentId: 'agent-1',
    label: 'Research',
    publicKey: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
    status: 'active',
    revokedAt: null,
    inFlightCalls: 1,
    allowedCalls: [],
    scopeIds: [],
    spendAndLimit: {
      spentPlain: '4.50 USDC today',
      limitPlain: '25.00 USDC every day',
      together: '4.50 USDC spent toward a 25.00 USDC limit every day.',
    },
    revocation: {
      stops: 'New paid calls are refused immediately.',
      continues: 'Calls already in progress still finish. Money already spent stays spent.',
    },
    ...overrides,
  };
}

describe('AgentConsole', () => {
  const requests: { url: string; method: string; body?: Record<string, unknown> }[] = [];

  beforeEach(() => {
    requests.length = 0;
    sessionStorage.clear();
    sessionStorage.setItem('syncro.principal.session', JSON.stringify({
      token: 'session-token',
      publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    }));
  });

  function installFetch(handler: (url: string, method: string, body?: Record<string, unknown>) => unknown) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      requests.push({ url, method, body });
      const data = handler(url, method, body);
      const failed = data && typeof data === 'object' && 'error' in (data as object);
      return {
        ok: !failed,
        status: failed ? 403 : 200,
        json: async () => (failed ? data : { data }),
      };
    }));
  }

  it('shows spend beside the limit and states what revocation does to in-flight calls', async () => {
    installFetch(() => ({ callTypes, agents: [agent()] }));
    render(<AgentConsole apiBase="http://agents.test" />);

    const spend = await screen.findByRole('region', { name: 'Spend and limit' });
    expect(spend).toHaveTextContent('4.50 USDC spent toward a 25.00 USDC limit every day.');
    expect(spend).toHaveTextContent('4.50 USDC today');
    expect(spend).toHaveTextContent('25.00 USDC every day');
    expect(screen.getByText('New paid calls are refused immediately.')).toBeInTheDocument();
    expect(screen.getByText('Calls already in progress still finish. Money already spent stays spent.')).toBeInTheDocument();
    expect(screen.getByText('1 call is already in progress and will still finish.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(screen.getByRole('dialog', { name: 'Revoke this agent now?' })).toHaveTextContent(
      'Calls already in progress still finish. Money already spent stays spent.',
    );
    expect(screen.queryByRole('button', { name: 'Sign and apply' })).not.toBeInTheDocument();
  });

  it('registers a generated key without sending the secret', async () => {
    installFetch((url, method) => {
      if (method === 'GET') return { callTypes, agents: [] };
      if (method === 'POST' && url.endsWith('/api/v3/agents')) {
        const body = requests.at(-1)?.body;
        return agent({
          publicKey: String(body?.publicKey),
          label: 'Research',
          spendAndLimit: {
            spentPlain: 'Nothing spent yet',
            limitPlain: 'No spending limit yet',
            together: 'No spending limit yet, so spend has nothing to sit beside.',
          },
          inFlightCalls: 0,
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    render(<AgentConsole apiBase="http://agents.test" />);
    await screen.findByRole('region', { name: 'Register an agent' });
    await userEvent.click(screen.getByRole('button', { name: 'Generate a new agent key' }));
    const identity = await screen.findAllByText(/^G[A-Z2-7]{55}$/);
    expect(identity.length).toBeGreaterThan(0);
    expect(screen.getByText(/^S[A-Z2-7]{55}$/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Register this agent' }));
    await waitFor(() => {
      const post = requests.find((item) => item.method === 'POST');
      expect(post?.body?.publicKey).toMatch(/^G/);
      expect(JSON.stringify(post?.body)).not.toMatch(/"S[A-Z2-7]{55}"/);
    });
  });

  it('shows the change before it is signed and confirms identity before a new grant', async () => {
    const principal = await generateKeypair();
    const current = agent({ inFlightCalls: 0 });
    installFetch((url, method) => {
      if (method === 'GET') return { callTypes, agents: [current] };
      if (url.endsWith('/authority/preview')) {
        return {
          statement: 'SYNCRO agent spending authority\nAgent: GTEST\nAllowed calls: Language model calls\nLimit: 25.00 USDC every day\nPreviously: No spending authority',
          before: 'No spending authority',
          after: 'Language model calls, up to 25.00 USDC every day',
          requiresReauthentication: true,
          confirmation: 'This allows more spending or a new kind of call. Confirm it is you, then sign.',
          agentPublicKey: current.publicKey,
        };
      }
      if (url.endsWith('/reauth/challenge')) {
        return { challengeId: 'chal-1', message: 'SYNCRO confirm it is you\nChallenge: abc' };
      }
      if (url.endsWith('/reauth')) {
        return { reauthToken: 'reauth-token' };
      }
      if (url.endsWith('/authority')) {
        return agent({
          allowedCalls: ['Language model calls'],
          scopeIds: ['llm:call'],
          spendAndLimit: {
            spentPlain: '0.00 USDC today',
            limitPlain: '25.00 USDC every day',
            together: '0.00 USDC spent toward a 25.00 USDC limit every day.',
          },
          inFlightCalls: 0,
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const user = userEvent.setup();
    render(<AgentConsole apiBase="http://agents.test" />);
    await user.click(await screen.findByRole('button', { name: 'Set spending authority' }));
    expect(screen.queryByRole('button', { name: 'Sign and apply' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Language model calls/ }));
    await user.type(screen.getByLabelText('Amount in USDC'), '25');
    await user.selectOptions(screen.getByLabelText('How often this limit resets'), 'day');
    await user.click(screen.getByRole('button', { name: 'Review change' }));

    expect(await screen.findByText('No spending authority')).toBeInTheDocument();
    expect(screen.getByText('Language model calls, up to 25.00 USDC every day')).toBeInTheDocument();
    expect(screen.getByText('This allows more spending or a new kind of call. Confirm it is you, then sign.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Principal secret key'), principal.secretKey);
    await user.click(screen.getByRole('button', { name: 'Sign and apply' }));

    await waitFor(() => {
      expect(requests.some((item) => item.url.endsWith('/reauth/challenge'))).toBe(true);
      expect(requests.some((item) => item.url.endsWith('/reauth') && item.body?.reauthToken === undefined)).toBe(true);
      const applied = requests.find((item) => item.url.endsWith('/authority') && item.method === 'POST');
      expect(applied?.body?.reauthToken).toBe('reauth-token');
      expect(applied?.body?.statement).toContain('Limit: 25.00 USDC every day');
    });
  });
});
