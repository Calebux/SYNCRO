'use client';

import { useEffect, useState } from 'react';
import { generateKeypair, type LocalKeypair } from '@/lib/agent-keys';
import {
  agentApiBase,
  applyAuthority,
  clearStoredSession,
  inspectImportedKey,
  loadAgents,
  openPrincipalSession,
  previewAuthority,
  readStoredSession,
  registerAgent,
  revokeAgent,
  type AgentSummary,
  type AuthorityDraft,
  type AuthorityPreview,
  type CallType,
  type PrincipalSession,
  type SpendPeriod,
} from '@/lib/agent-console';

const PERIODS: { id: SpendPeriod; label: string }[] = [
  { id: 'day', label: 'Every day' },
  { id: 'week', label: 'Every week' },
  { id: 'month', label: 'Every month' },
];

export function AgentConsole({ apiBase = agentApiBase() }: { apiBase?: string }) {
  const [session, setSession] = useState<PrincipalSession | null>(null);
  const [callTypes, setCallTypes] = useState<CallType[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [heldSecrets, setHeldSecrets] = useState<Record<string, string>>({});

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    loadAgents(apiBase, session.token)
      .then((result) => {
        if (cancelled) return;
        setCallTypes(result.callTypes);
        setAgents(result.agents);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load agents.');
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, session]);

  async function refresh(nextSession: PrincipalSession) {
    try {
      const result = await loadAgents(apiBase, nextSession.token);
      setCallTypes(result.callTypes);
      setAgents(result.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load agents.');
    }
  }

  if (!ready) {
    return <main className="min-h-screen bg-[#F9F6F2] text-[#1E2A35] p-8">Loading agents…</main>;
  }

  return (
    <main className="min-h-screen bg-[#F9F6F2] text-[#1E2A35]">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <p className="text-sm font-medium text-[#5C6B73]">SYNCRO</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-[#3D4C57]">
            Granting an agent the ability to spend is the most consequential action you take here.
            You will see the amount and the reset period, in plain words, before anything is signed.
          </p>
        </header>

        {error ? (
          <p role="alert" className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {session ? (
          <SignedIn
            apiBase={apiBase}
            session={session}
            callTypes={callTypes}
            agents={agents}
            busy={busy}
            heldSecrets={heldSecrets}
            onError={setError}
            onBusy={setBusy}
            onHoldSecret={(publicKey, secret) => setHeldSecrets((current) => ({ ...current, [publicKey]: secret }))}
            onDismissSecret={(publicKey) => setHeldSecrets((current) => {
              const next = { ...current };
              delete next[publicKey];
              return next;
            })}
            onSessionEnd={() => {
              clearStoredSession();
              setSession(null);
              setAgents([]);
              setError(null);
            }}
            onRefresh={() => refresh(session)}
            onReplaceAgent={(agent) => setAgents((current) => current.map((item) => item.agentId === agent.agentId ? agent : item))}
            onAddAgent={(agent) => setAgents((current) => [agent, ...current])}
          />
        ) : (
          <SignIn
            apiBase={apiBase}
            busy={busy}
            onError={setError}
            onBusy={setBusy}
            onSession={setSession}
          />
        )}
      </div>
    </main>
  );
}

function SignIn({
  apiBase,
  busy,
  onError,
  onBusy,
  onSession,
}: {
  apiBase: string;
  busy: boolean;
  onError: (message: string | null) => void;
  onBusy: (busy: boolean) => void;
  onSession: (session: PrincipalSession) => void;
}) {
  const [keypair, setKeypair] = useState<LocalKeypair | null>(null);
  const [importValue, setImportValue] = useState('');
  const [imported, setImported] = useState<{ publicKey: string; secretKey: string | null } | null>(null);

  async function signInWith(next: LocalKeypair) {
    onBusy(true);
    onError(null);
    try {
      onSession(await openPrincipalSession(apiBase, next));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      onBusy(false);
    }
  }

  return (
    <section aria-label="Principal" className="rounded-lg border border-[#E4DDD4] bg-white p-6">
      <h2 className="text-lg font-semibold">Sign in with your key</h2>
      <p className="mt-2 text-sm leading-relaxed text-[#3D4C57]">
        This key confirms it is you. It stays in this browser only long enough to sign, and it is not sent to SYNCRO.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-md bg-[#1E2A35] px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            onError(null);
            try {
              setKeypair(await generateKeypair());
              setImported(null);
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Could not generate a key.');
            }
          }}
        >
          Generate a principal key
        </button>
      </div>
      {keypair ? (
        <KeyReveal
          publicKey={keypair.publicKey}
          secretKey={keypair.secretKey}
          onContinue={() => signInWith(keypair)}
          continueLabel="I have stored this key — sign in"
          busy={busy}
        />
      ) : null}
      <form
        className="mt-6 space-y-3 border-t border-[#E4DDD4] pt-6"
        onSubmit={async (event) => {
          event.preventDefault();
          onError(null);
          try {
            const identified = await inspectImportedKey(importValue);
            setImported(identified);
            setKeypair(null);
          } catch (err) {
            setImported(null);
            onError(err instanceof Error ? err.message : 'Could not read that key.');
          }
        }}
      >
        <label className="block text-sm font-medium" htmlFor="principal-import">
          Or paste a secret key you already have
        </label>
        <textarea
          id="principal-import"
          value={importValue}
          onChange={(event) => setImportValue(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="min-h-20 w-full rounded-md border border-[#D5CDC3] px-3 py-2 font-mono text-sm"
        />
        <button type="submit" className="rounded-md border border-[#1E2A35] px-4 py-2 text-sm">
          Show public identity
        </button>
      </form>
      {imported?.secretKey ? (
        <KeyReveal
          publicKey={imported.publicKey}
          secretKey={null}
          onContinue={() => signInWith({ publicKey: imported.publicKey, secretKey: imported.secretKey! })}
          continueLabel="Sign in"
          busy={busy}
        />
      ) : null}
    </section>
  );
}

function KeyReveal({
  publicKey,
  secretKey,
  onContinue,
  continueLabel,
  busy,
}: {
  publicKey: string;
  secretKey: string | null;
  onContinue: () => void;
  continueLabel: string;
  busy: boolean;
}) {
  return (
    <div className="mt-5 space-y-4">
      <PublicIdentity publicKey={publicKey} />
      {secretKey ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#5C6B73]">Secret key</p>
          <p className="mt-1 break-all font-mono text-sm">{secretKey}</p>
          <p className="mt-2 text-sm text-[#8A4B08]">
            Copy this secret and store it somewhere safe. SYNCRO will not show it again, and it is not kept after you sign in.
          </p>
        </div>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onContinue}
        className="rounded-md bg-[#1E2A35] px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {continueLabel}
      </button>
    </div>
  );
}

function PublicIdentity({ publicKey }: { publicKey: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-[#5C6B73]">Public identity</p>
      <p className="mt-1 break-all font-mono text-base text-[#1E2A35]">{publicKey}</p>
    </div>
  );
}

function SignedIn({
  apiBase,
  session,
  callTypes,
  agents,
  busy,
  heldSecrets,
  onError,
  onBusy,
  onHoldSecret,
  onDismissSecret,
  onSessionEnd,
  onRefresh,
  onReplaceAgent,
  onAddAgent,
}: {
  apiBase: string;
  session: PrincipalSession;
  callTypes: CallType[];
  agents: AgentSummary[];
  busy: boolean;
  heldSecrets: Record<string, string>;
  onError: (message: string | null) => void;
  onBusy: (busy: boolean) => void;
  onHoldSecret: (publicKey: string, secret: string) => void;
  onDismissSecret: (publicKey: string) => void;
  onSessionEnd: () => void;
  onRefresh: () => Promise<void>;
  onReplaceAgent: (agent: AgentSummary) => void;
  onAddAgent: (agent: AgentSummary) => void;
}) {
  return (
    <div className="space-y-8">
      <section aria-label="Principal" className="rounded-lg border border-[#E4DDD4] bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <PublicIdentity publicKey={session.publicKey} />
          <button type="button" onClick={onSessionEnd} className="shrink-0 text-sm underline">
            Sign out
          </button>
        </div>
        <p className="mt-3 text-sm text-[#3D4C57]">Signed in. Grants and limit increases ask for this key again.</p>
      </section>

      <RegisterAgent
        apiBase={apiBase}
        token={session.token}
        busy={busy}
        onError={onError}
        onBusy={onBusy}
        onRegistered={(agent, secret) => {
          onAddAgent(agent);
          if (secret) onHoldSecret(agent.publicKey, secret);
        }}
      />

      <section aria-label="Your agents" className="space-y-4">
        <h2 className="text-lg font-semibold">Your agents</h2>
        {agents.length === 0 ? (
          <p className="text-sm text-[#3D4C57]">No agents yet. Register one before you grant spending authority.</p>
        ) : (
          agents.map((agent) => (
            <AgentCard
              key={agent.agentId}
              apiBase={apiBase}
              token={session.token}
              agent={agent}
              callTypes={callTypes}
              busy={busy}
              heldSecret={heldSecrets[agent.publicKey] ?? null}
              onError={onError}
              onBusy={onBusy}
              onDismissSecret={() => onDismissSecret(agent.publicKey)}
              onUpdated={async (updated) => {
                onReplaceAgent(updated);
                await onRefresh();
              }}
            />
          ))
        )}
      </section>
    </div>
  );
}

function RegisterAgent({
  apiBase,
  token,
  busy,
  onError,
  onBusy,
  onRegistered,
}: {
  apiBase: string;
  token: string;
  busy: boolean;
  onError: (message: string | null) => void;
  onBusy: (busy: boolean) => void;
  onRegistered: (agent: AgentSummary, secret: string | null) => void;
}) {
  const [label, setLabel] = useState('');
  const [generated, setGenerated] = useState<LocalKeypair | null>(null);
  const [importValue, setImportValue] = useState('');
  const [imported, setImported] = useState<{ publicKey: string; secretKey: string | null } | null>(null);
  const identity = generated?.publicKey ?? imported?.publicKey ?? null;
  const secret = generated?.secretKey ?? imported?.secretKey ?? null;

  async function submit() {
    if (!identity) return;
    onBusy(true);
    onError(null);
    try {
      const agent = await registerAgent(apiBase, token, { publicKey: identity, label });
      onRegistered(agent, secret);
      setGenerated(null);
      setImported(null);
      setImportValue('');
      setLabel('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not register the agent.');
    } finally {
      onBusy(false);
    }
  }

  return (
    <section aria-label="Register an agent" className="rounded-lg border border-[#E4DDD4] bg-white p-6">
      <h2 className="text-lg font-semibold">Register an agent</h2>
      <p className="mt-2 text-sm leading-relaxed text-[#3D4C57]">
        Generate a new key here, or import one you already hold. Only the public identity is registered.
      </p>
      <label className="mt-4 block text-sm font-medium" htmlFor="agent-name">
        Name
      </label>
      <input
        id="agent-name"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        className="mt-1 w-full rounded-md border border-[#D5CDC3] px-3 py-2 text-sm"
        placeholder="Optional"
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-md bg-[#1E2A35] px-4 py-2 text-sm text-white"
          onClick={async () => {
            onError(null);
            try {
              setGenerated(await generateKeypair());
              setImported(null);
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Could not generate a key.');
            }
          }}
        >
          Generate a new agent key
        </button>
      </div>
      {generated ? (
        <div className="mt-4 space-y-3">
          <PublicIdentity publicKey={generated.publicKey} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#5C6B73]">Secret key</p>
            <p className="mt-1 break-all font-mono text-sm">{generated.secretKey}</p>
            <p className="mt-2 text-sm text-[#8A4B08]">
              This secret is the agent&apos;s key. Copy it now. It is not sent to SYNCRO and will not be shown again after you leave this page.
            </p>
          </div>
        </div>
      ) : null}
      <form
        className="mt-4 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          onError(null);
          try {
            setImported(await inspectImportedKey(importValue));
            setGenerated(null);
          } catch (err) {
            setImported(null);
            onError(err instanceof Error ? err.message : 'Could not read that key.');
          }
        }}
      >
        <label className="block text-sm font-medium" htmlFor="agent-import">
          Import a key
        </label>
        <textarea
          id="agent-import"
          value={importValue}
          onChange={(event) => setImportValue(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="Public key (G…) or secret key (S…)"
          className="min-h-20 w-full rounded-md border border-[#D5CDC3] px-3 py-2 font-mono text-sm"
        />
        <button type="submit" className="rounded-md border border-[#1E2A35] px-4 py-2 text-sm">
          Show imported identity
        </button>
      </form>
      {imported ? (
        <div className="mt-4">
          <PublicIdentity publicKey={imported.publicKey} />
          <p className="mt-2 text-sm text-[#3D4C57]">
            {imported.secretKey
              ? 'The secret stays in this browser. Only the public identity will be registered.'
              : 'You imported a public identity only. The secret never entered this browser.'}
          </p>
        </div>
      ) : null}
      <button
        type="button"
        disabled={!identity || busy}
        onClick={submit}
        className="mt-5 rounded-md bg-[#1E2A35] px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        Register this agent
      </button>
    </section>
  );
}

function AgentCard({
  apiBase,
  token,
  agent,
  callTypes,
  busy,
  heldSecret,
  onError,
  onBusy,
  onDismissSecret,
  onUpdated,
}: {
  apiBase: string;
  token: string;
  agent: AgentSummary;
  callTypes: CallType[];
  busy: boolean;
  heldSecret: string | null;
  onError: (message: string | null) => void;
  onBusy: (busy: boolean) => void;
  onDismissSecret: () => void;
  onUpdated: (agent: AgentSummary) => Promise<void>;
}) {
  const [draftOpen, setDraftOpen] = useState(false);
  const [scopeIds, setScopeIds] = useState<string[]>(agent.scopeIds);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<SpendPeriod>('month');
  const [preview, setPreview] = useState<AuthorityPreview | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);

  function toggleScope(id: string) {
    setScopeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setPreview(null);
  }

  async function review() {
    const parsedAmount = Number(amount);
    if (!scopeIds.length || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      onError('Choose what this agent may call, and enter an amount.');
      return;
    }
    onBusy(true);
    onError(null);
    try {
      const draft: AuthorityDraft = { scopeIds, amount: parsedAmount, period };
      setPreview(await previewAuthority(apiBase, token, agent.agentId, draft));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not review this change.');
    } finally {
      onBusy(false);
    }
  }

  return (
    <article className="rounded-lg border border-[#E4DDD4] bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{agent.label || 'Unnamed agent'}</h3>
          <p className={`mt-1 text-sm font-medium ${agent.status === 'revoked' ? 'text-red-700' : 'text-[#1F7A4D]'}`}>
            {agent.status === 'revoked' ? 'Revoked' : 'Active'}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <PublicIdentity publicKey={agent.publicKey} />
      </div>
      {heldSecret ? (
        <div className="mt-4 rounded-md border border-[#E7C48A] bg-[#FFF8EC] p-4">
          <p className="text-sm font-medium">Agent secret — shown once</p>
          <p className="mt-2 break-all font-mono text-sm">{heldSecret}</p>
          <button type="button" onClick={onDismissSecret} className="mt-3 text-sm underline">
            I have stored this secret
          </button>
        </div>
      ) : null}

      <section aria-label="Spend and limit" className="mt-5 rounded-md bg-[#F9F6F2] p-4">
        <p className="text-sm text-[#1E2A35]">{agent.spendAndLimit.together}</p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#5C6B73]">Spent</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{agent.spendAndLimit.spentPlain}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#5C6B73]">Limit</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{agent.spendAndLimit.limitPlain}</p>
          </div>
        </div>
      </section>

      {agent.allowedCalls.length > 0 ? (
        <p className="mt-4 text-sm text-[#3D4C57]">May call: {agent.allowedCalls.join(', ')}</p>
      ) : null}

      <div className="mt-4 space-y-1 text-sm text-[#3D4C57]">
        <p className="font-medium text-[#1E2A35]">If you revoke this agent</p>
        <p>{agent.revocation.stops}</p>
        <p>{agent.revocation.continues}</p>
        {agent.inFlightCalls > 0 ? (
          <p>
            {agent.inFlightCalls} {agent.inFlightCalls === 1 ? 'call is' : 'calls are'} already in progress and will still finish.
          </p>
        ) : null}
      </div>

      {agent.status === 'active' ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-md bg-[#1E2A35] px-4 py-2 text-sm text-white"
            onClick={() => {
              setDraftOpen(true);
              setPreview(null);
            }}
          >
            {agent.allowedCalls.length ? 'Change spending authority' : 'Set spending authority'}
          </button>
          <button
            type="button"
            className="rounded-md border border-red-700 px-4 py-2 text-sm text-red-700"
            onClick={() => setRevokeOpen(true)}
          >
            Revoke
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[#3D4C57]">Register a new key if this agent should spend again.</p>
      )}

      {draftOpen && agent.status === 'active' ? (
        <form
          className="mt-5 space-y-4 border-t border-[#E4DDD4] pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            void review();
          }}
        >
          <fieldset>
            <legend className="text-sm font-medium">What this agent may call</legend>
            <div className="mt-2 space-y-2">
              {callTypes.map((callType) => (
                <label key={callType.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={scopeIds.includes(callType.id)}
                    onChange={() => toggleScope(callType.id)}
                  />
                  <span>
                    <span className="font-medium">{callType.label}</span>
                    <span className="block text-[#5C6B73]">{callType.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor={`amount-${agent.agentId}`}>Amount in USDC</label>
              <input
                id={`amount-${agent.agentId}`}
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setPreview(null);
                }}
                className="mt-1 w-full rounded-md border border-[#D5CDC3] px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-[#5C6B73]">The most this agent can spend before the limit resets.</p>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor={`period-${agent.agentId}`}>How often this limit resets</label>
              <select
                id={`period-${agent.agentId}`}
                value={period}
                onChange={(event) => {
                  setPeriod(event.target.value as SpendPeriod);
                  setPreview(null);
                }}
                className="mt-1 w-full rounded-md border border-[#D5CDC3] px-3 py-2 text-sm"
              >
                {PERIODS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" disabled={busy} className="rounded-md border border-[#1E2A35] px-4 py-2 text-sm disabled:opacity-50">
            Review change
          </button>
        </form>
      ) : null}

      {preview ? (
        <ReviewDialog
          preview={preview}
          busy={busy}
          onClose={() => setPreview(null)}
          onSign={async (secret) => {
            const parsedAmount = Number(amount);
            onBusy(true);
            onError(null);
            try {
              const updated = await applyAuthority(
                apiBase,
                token,
                agent.agentId,
                { scopeIds, amount: parsedAmount, period },
                preview,
                secret,
              );
              setPreview(null);
              setDraftOpen(false);
              await onUpdated(updated);
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Could not apply this change.');
            } finally {
              onBusy(false);
            }
          }}
        />
      ) : null}

      {revokeOpen ? (
        <RevokeDialog
          agent={agent}
          busy={busy}
          onClose={() => setRevokeOpen(false)}
          onConfirm={async () => {
            onBusy(true);
            onError(null);
            try {
              const updated = await revokeAgent(apiBase, token, agent.agentId);
              setRevokeOpen(false);
              await onUpdated(updated);
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Could not revoke this agent.');
            } finally {
              onBusy(false);
            }
          }}
        />
      ) : null}
    </article>
  );
}

function ReviewDialog({
  preview,
  busy,
  onClose,
  onSign,
}: {
  preview: AuthorityPreview;
  busy: boolean;
  onClose: () => void;
  onSign: (secret: string) => Promise<void>;
}) {
  const [secret, setSecret] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="review-title" className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-6 shadow-xl">
        <h2 id="review-title" className="text-lg font-semibold">Review spending authority</h2>
        <p className="mt-2 text-sm text-[#3D4C57]">{preview.confirmation}</p>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="font-medium">Right now</dt>
            <dd>{preview.before}</dd>
          </div>
          <div>
            <dt className="font-medium">After you sign</dt>
            <dd>{preview.after}</dd>
          </div>
        </dl>
        <pre className="mt-4 whitespace-pre-wrap break-all rounded-md bg-[#F9F6F2] p-3 font-mono text-xs">{preview.statement}</pre>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onSign(secret);
          }}
        >
          <label className="block text-sm font-medium" htmlFor="principal-secret">
            Principal secret key
          </label>
          <input
            id="principal-secret"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            className="w-full rounded-md border border-[#D5CDC3] px-3 py-2 font-mono text-sm"
          />
          <p className="text-xs text-[#5C6B73]">
            {preview.requiresReauthentication
              ? 'Entering this key confirms it is you. The change is signed only after that confirmation.'
              : 'Entering this key signs the change shown above. It does not raise the limit.'}
          </p>
          <div className="flex gap-3">
            <button type="submit" disabled={busy || secret.length === 0} className="rounded-md bg-[#1E2A35] px-4 py-2 text-sm text-white disabled:opacity-50">
              Sign and apply
            </button>
            <button type="button" onClick={onClose} className="rounded-md border border-[#1E2A35] px-4 py-2 text-sm">
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RevokeDialog({
  agent,
  busy,
  onClose,
  onConfirm,
}: {
  agent: AgentSummary;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="revoke-title" className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 id="revoke-title" className="text-lg font-semibold">Revoke this agent now?</h2>
        <div className="mt-3">
          <PublicIdentity publicKey={agent.publicKey} />
        </div>
        <div className="mt-4 space-y-2 text-sm text-[#3D4C57]">
          <p>{agent.revocation.stops}</p>
          <p>{agent.revocation.continues}</p>
          {agent.inFlightCalls > 0 ? (
            <p>
              {agent.inFlightCalls} {agent.inFlightCalls === 1 ? 'call is' : 'calls are'} already in progress and will still finish.
            </p>
          ) : (
            <p>No calls are in progress. New ones will be refused as soon as this is revoked.</p>
          )}
        </div>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className="rounded-md bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Revoke now
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-[#1E2A35] px-4 py-2 text-sm">
            Keep this agent
          </button>
        </div>
      </div>
    </div>
  );
}
