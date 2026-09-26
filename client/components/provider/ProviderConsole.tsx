'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  formatSettlementAmount,
} from '@syncro/ui';
import {
  PROVIDER_SESSION_KEY,
  RATE_CARD_NON_RETROACTIVE_NOTICE,
  SEPARATE_REVENUE_NOTICE,
  ProviderConsoleClient,
  ProviderConsoleError,
  ProviderConsoleSnapshot,
  ProviderMode,
  ProviderRevenue,
  ProviderSettlement,
  RateCardVersion,
  describeRateCardVersion,
  previewCallCost,
  providerConsoleClient,
  settlementStatusLabel,
  versionsForRoute,
} from '@/lib/provider-console';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

interface RouteFormState {
  routeId: string | null;
  pathPattern: string;
  method: string;
  unit: string;
  price: string;
  quantityExtractor: string;
  sampleBody: string;
}

const EMPTY_ROUTE_FORM: RouteFormState = {
  routeId: null,
  pathPattern: '',
  method: 'POST',
  unit: 'request',
  price: '',
  quantityExtractor: 'constant:1',
  sampleBody: '',
};

interface ProviderConsoleProps {
  client?: ProviderConsoleClient;
}

export function ProviderConsole({ client = providerConsoleClient }: ProviderConsoleProps) {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProviderConsoleSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [signature, setSignature] = useState('');
  const [routeForm, setRouteForm] = useState<RouteFormState>(EMPTY_ROUTE_FORM);

  useEffect(() => {
    const stored = sessionStorage.getItem(PROVIDER_SESSION_KEY);
    setProviderId(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !providerId) return;
    let cancelled = false;
    setLoading(true);
    client
      .loadConsole(providerId)
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setChallenge(next.provider.payoutChallenge);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ProviderConsoleError && err.status === 404) {
          sessionStorage.removeItem(PROVIDER_SESSION_KEY);
          setProviderId(null);
          setSnapshot(null);
        }
        setError(err instanceof Error ? err.message : 'Could not load the provider console.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, providerId, client]);

  async function refresh(id: string) {
    const next = await client.loadConsole(id);
    setSnapshot(next);
    setChallenge(next.provider.payoutChallenge);
  }

  function rememberProvider(id: string) {
    sessionStorage.setItem(PROVIDER_SESSION_KEY, id);
    setProviderId(id);
  }

  function forgetProvider() {
    sessionStorage.removeItem(PROVIDER_SESSION_KEY);
    setProviderId(null);
    setSnapshot(null);
    setChallenge(null);
    setSignature('');
    setRouteForm(EMPTY_ROUTE_FORM);
    setError(null);
  }

  if (!ready || (providerId && !snapshot && loading)) {
    return <p className="p-6 text-sm text-muted-foreground">Loading provider console…</p>;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6" id="main-content">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Provider console</h1>
        <p className="text-sm text-muted-foreground">
          Register, verify a payout address, price routes, and read settlement history.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!snapshot ? (
        <RegistrationForm
          onRegistered={async (id) => {
            setError(null);
            rememberProvider(id);
          }}
          client={client}
          onError={setError}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">
              Signed in as <span className="font-medium">{snapshot.provider.identity}</span>
              <span className="text-muted-foreground"> · {snapshot.provider.mode}</span>
            </p>
            <Button type="button" variant="outline" onClick={forgetProvider}>
              Use a different provider
            </Button>
          </div>

          <PayoutSection
            snapshot={snapshot}
            challenge={challenge}
            signature={signature}
            onSignature={setSignature}
            onChallenge={setChallenge}
            client={client}
            onError={setError}
            onUpdated={async () => {
              setError(null);
              await refresh(snapshot.provider.providerId);
            }}
          />

          <RevenueSection revenue={snapshot.revenue} />

          <RouteSection
            snapshot={snapshot}
            form={routeForm}
            onForm={setRouteForm}
            client={client}
            onError={setError}
            onSaved={async () => {
              setError(null);
              setRouteForm(EMPTY_ROUTE_FORM);
              await refresh(snapshot.provider.providerId);
            }}
          />

          <RateCardSection versions={snapshot.rateCards} />
          <SettlementHistory settlements={snapshot.settlements} />
        </>
      )}
    </main>
  );
}

function RegistrationForm({
  client,
  onRegistered,
  onError,
}: {
  client: ProviderConsoleClient;
  onRegistered: (providerId: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [identity, setIdentity] = useState('');
  const [payoutAddress, setPayoutAddress] = useState('');
  const [upstreamBaseUrl, setUpstreamBaseUrl] = useState('');
  const [agreementTerms, setAgreementTerms] = useState('');
  const [mode, setMode] = useState<ProviderMode>('staging');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const provider = await client.registerProvider({
        identity: identity.trim(),
        payoutAddress: payoutAddress.trim(),
        upstreamBaseUrl: upstreamBaseUrl.trim(),
        agreementTerms: agreementTerms.trim(),
        mode,
      });
      await onRegistered(provider.providerId);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register a provider</CardTitle>
        <CardDescription>
          The payout address is saved unverified. The next step is to prove you control it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <Field label="Identity" id="provider-identity">
            <Input id="provider-identity" value={identity} onChange={(event) => setIdentity(event.target.value)} required />
          </Field>
          <Field label="Payout address" id="provider-payout-address">
            <Input
              id="provider-payout-address"
              value={payoutAddress}
              onChange={(event) => setPayoutAddress(event.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Upstream base URL" id="provider-upstream">
            <Input
              id="provider-upstream"
              type="url"
              value={upstreamBaseUrl}
              onChange={(event) => setUpstreamBaseUrl(event.target.value)}
              required
              placeholder="https://api.example.com"
            />
          </Field>
          <Field label="Agreement terms" id="provider-terms">
            <Input
              id="provider-terms"
              value={agreementTerms}
              onChange={(event) => setAgreementTerms(event.target.value)}
              required
            />
          </Field>
          <Field label="Mode" id="provider-mode">
            <select
              id="provider-mode"
              className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
              value={mode}
              onChange={(event) => setMode(event.target.value as ProviderMode)}
            >
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </Field>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Registering…' : 'Register provider'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PayoutSection({
  snapshot,
  challenge,
  signature,
  onSignature,
  onChallenge,
  client,
  onError,
  onUpdated,
}: {
  snapshot: ProviderConsoleSnapshot;
  challenge: string | null;
  signature: string;
  onSignature: (value: string) => void;
  onChallenge: (value: string | null) => void;
  client: ProviderConsoleClient;
  onError: (message: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const provider = snapshot.provider;
  const [address, setAddress] = useState(provider.payoutAddress);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAddress(provider.payoutAddress);
  }, [provider.payoutAddress]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await onUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Payout update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout address</CardTitle>
        <CardDescription>
          Changing the address clears verification. Routes can be priced only after the address is verified.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant={provider.payoutVerified ? 'default' : 'secondary'}>
            {provider.payoutVerified ? 'Verified' : 'Not verified'}
          </Badge>
        </div>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => client.updatePayoutAddress(provider.providerId, address.trim()).then(() => undefined));
          }}
        >
          <Field label="Stellar payout address" id="payout-address">
            <Input
              id="payout-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Button type="submit" variant="outline" disabled={busy}>
            Update payout address
          </Button>
        </form>

        {!provider.payoutVerified && (
          <div className="space-y-3 rounded-lg border p-4" data-testid="payout-verification">
            <h3 className="text-sm font-medium">Verification</h3>
            <p className="text-sm text-muted-foreground">
              Request a challenge, sign it with the payout address key, and submit the base64 signature.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const result = await client.createPayoutChallenge(provider.providerId);
                    onChallenge(result.challenge);
                  } catch (err) {
                    onError(err instanceof Error ? err.message : 'Could not start verification.');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Start verification
            </Button>
            {challenge && (
              <>
                <p className="break-all font-mono text-xs" data-testid="payout-challenge">
                  {challenge}
                </p>
                <Field label="Signature" id="payout-signature">
                  <Input
                    id="payout-signature"
                    value={signature}
                    onChange={(event) => onSignature(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        const signed = await signChallenge(challenge);
                        if (!signed) {
                          throw new Error('No wallet signature was returned. Paste the base64 signature instead.');
                        }
                        onSignature(signed);
                        await client.verifyPayout(provider.providerId, signed);
                        onSignature('');
                      });
                    }}
                  >
                    Sign with wallet
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || signature.trim().length === 0}
                    onClick={() => {
                      void run(async () => {
                        await client.verifyPayout(provider.providerId, signature.trim());
                        onSignature('');
                      });
                    }}
                  >
                    Submit signature
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RevenueSection({ revenue }: { revenue: ProviderRevenue }) {
  const figures = [
    { id: 'settled', label: 'Settled', value: revenue.settled, hint: 'Finalized on-chain.' },
    { id: 'unsettled', label: 'Unsettled', value: revenue.unsettled, hint: 'Metered, not yet settled.' },
    { id: 'in-dispute', label: 'In dispute', value: revenue.inDispute, hint: 'Contested and not finalized.' },
  ] as const;

  return (
    <section aria-label="Revenue" className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Revenue</h2>
        <p className="text-sm text-muted-foreground">{SEPARATE_REVENUE_NOTICE}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {figures.map((figure) => (
          <article
            key={figure.id}
            className="rounded-xl border border-l-4 p-4"
            data-testid={`revenue-${figure.id}`}
            aria-labelledby={`revenue-${figure.id}-label`}
          >
            <h3 id={`revenue-${figure.id}-label`} className="text-sm font-medium">
              {figure.label}
            </h3>
            <p className="mt-2 font-mono text-xl tabular-nums">{formatSettlementAmount(figure.value)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{figure.hint}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RouteSection({
  snapshot,
  form,
  onForm,
  client,
  onError,
  onSaved,
}: {
  snapshot: ProviderConsoleSnapshot;
  form: RouteFormState;
  onForm: (form: RouteFormState) => void;
  client: ProviderConsoleClient;
  onError: (message: string) => void;
  onSaved: () => Promise<void>;
}) {
  const verified = snapshot.provider.payoutVerified;
  const [saving, setSaving] = useState(false);
  const price = Number(form.price);
  const preview = useMemo(
    () =>
      previewCallCost({
        price,
        quantityExtractor: form.quantityExtractor,
        sampleBody: form.sampleBody,
      }),
    [price, form.quantityExtractor, form.sampleBody],
  );
  const editing = snapshot.routes.find((route) => route.routeId === form.routeId) ?? null;
  const inForce = editing?.applicableVersion ?? null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!verified) return;
    setSaving(true);
    try {
      const draft = {
        pathPattern: form.pathPattern.trim(),
        method: form.method,
        unit: form.unit.trim(),
        price,
        quantityExtractor: form.quantityExtractor.trim(),
      };
      if (form.routeId) {
        await client.reviseRoute(snapshot.provider.providerId, form.routeId, draft);
      } else {
        await client.registerRoute(snapshot.provider.providerId, draft);
      }
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save the route.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Routes</CardTitle>
        <CardDescription>
          Path, method, unit, price, and the quantity extractor. The preview is what one call costs at the price in this form.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {snapshot.routes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No routes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3 font-medium">Method</th>
                  <th className="py-2 pr-3 font-medium">Path</th>
                  <th className="py-2 pr-3 font-medium">Unit</th>
                  <th className="py-2 pr-3 font-medium">Price</th>
                  <th className="py-2 pr-3 font-medium">Extractor</th>
                  <th className="py-2 pr-3 font-medium">Applies from</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {snapshot.routes.map((route) => (
                  <tr key={route.routeId} className="border-b">
                    <td className="py-2 pr-3">{route.method}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{route.pathPattern}</td>
                    <td className="py-2 pr-3">{route.unit}</td>
                    <td className="py-2 pr-3 font-mono">{formatSettlementAmount(route.price)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{route.quantityExtractor}</td>
                    <td className="py-2 pr-3">
                      {route.applicableVersion ? (
                        <time dateTime={route.applicableVersion.effectiveFrom}>
                          {route.applicableVersion.label} from {route.applicableVersion.effectiveFrom}
                        </time>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onForm({
                            routeId: route.routeId,
                            pathPattern: route.pathPattern,
                            method: route.method,
                            unit: route.unit,
                            price: String(route.price),
                            quantityExtractor: route.quantityExtractor,
                            sampleBody: form.sampleBody,
                          })
                        }
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!verified && (
          <Alert>
            <AlertTitle>Payout address is not verified</AlertTitle>
            <AlertDescription>Verify the payout address before pricing routes.</AlertDescription>
          </Alert>
        )}

        <form className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Path" id="route-path">
              <Input
                id="route-path"
                value={form.pathPattern}
                onChange={(event) => onForm({ ...form, pathPattern: event.target.value })}
                placeholder="/v1/tasks/*"
                required
                disabled={!verified}
              />
            </Field>
            <Field label="Method" id="route-method">
              <select
                id="route-method"
                className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
                value={form.method}
                disabled={!verified}
                onChange={(event) => onForm({ ...form, method: event.target.value })}
              >
                {METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Unit" id="route-unit">
              <Input
                id="route-unit"
                value={form.unit}
                onChange={(event) => onForm({ ...form, unit: event.target.value })}
                required
                disabled={!verified}
              />
            </Field>
            <Field label="Price (USDC per unit)" id="route-price">
              <Input
                id="route-price"
                type="number"
                min="0"
                step="any"
                value={form.price}
                onChange={(event) => onForm({ ...form, price: event.target.value })}
                required
                disabled={!verified}
              />
            </Field>
            <Field label="Quantity extractor" id="route-extractor">
              <Input
                id="route-extractor"
                value={form.quantityExtractor}
                onChange={(event) => onForm({ ...form, quantityExtractor: event.target.value })}
                placeholder="constant:1 or json:usage.tokens"
                required
                disabled={!verified}
              />
            </Field>
            <Field label="Sample body" id="route-sample">
              <Input
                id="route-sample"
                value={form.sampleBody}
                onChange={(event) => onForm({ ...form, sampleBody: event.target.value })}
                placeholder='{"usage":{"tokens":1000}}'
                disabled={!verified}
              />
            </Field>
          </div>

          <div className="rounded-lg border p-4" data-testid="call-cost-preview" aria-live="polite">
            <h3 className="text-sm font-medium">Call cost preview</h3>
            {preview.ok ? (
              <p className="mt-2 text-sm">
                This call costs {formatSettlementAmount(preview.cost)} ({preview.quantity} ×{' '}
                {formatSettlementAmount(preview.unitPrice)} per {form.unit || 'unit'}).
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{preview.message}</p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Saving publishes a new rate-card version. It applies from the time you save and does not change calls already metered.
              {inForce
                ? ` The version in force now is ${inForce.label}, which applies from ${inForce.effectiveFrom}.`
                : ''}
            </p>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={!verified || saving}>
              {form.routeId ? 'Save new version' : 'Add route'}
            </Button>
            {form.routeId && (
              <Button type="button" variant="outline" onClick={() => onForm(EMPTY_ROUTE_FORM)}>
                Cancel edit
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RateCardSection({ versions }: { versions: RateCardVersion[] }) {
  const routeIds = [...new Set(versions.map((version) => version.routeId))];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate cards</CardTitle>
        <CardDescription>{RATE_CARD_NON_RETROACTIVE_NOTICE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="rate-card-non-retroactive">
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rate-card versions yet. Adding a route publishes the first one.</p>
        ) : (
          routeIds.map((routeId) => {
            const rows = versionsForRoute(versions, routeId);
            return (
              <ul key={routeId} className="space-y-3">
                {rows.map((version) => (
                  <li key={version.versionId} className="rounded-lg border p-3 text-sm" data-testid={`rate-card-${version.label}`}>
                    <p className="font-medium">
                      {version.method} {version.pathPattern} · {version.label} · {formatSettlementAmount(version.price)} per{' '}
                      {version.unit}
                    </p>
                    <p className="mt-1 text-muted-foreground">{describeRateCardVersion(version, rows)}</p>
                    <p className="mt-1 font-mono text-xs">Extractor {version.quantityExtractor}</p>
                  </li>
                ))}
              </ul>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function SettlementHistory({ settlements }: { settlements: ProviderSettlement[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settlement history</CardTitle>
        <CardDescription>
          Each row keeps the rate-card version that applied when the call was metered.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settlements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No settlements yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3 font-medium">Metered</th>
                  <th className="py-2 pr-3 font-medium">Route</th>
                  <th className="py-2 pr-3 font-medium">Rate card</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((settlement) => (
                  <tr key={settlement.settlementId} className="border-b" data-testid="settlement-row">
                    <td className="py-2 pr-3">
                      <time dateTime={settlement.meteredAt}>{settlement.meteredAt}</time>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {settlement.method} {settlement.pathPattern}
                    </td>
                    <td className="py-2 pr-3">
                      {settlement.rateCardVersion} applies from{' '}
                      <time dateTime={settlement.rateCardEffectiveFrom}>{settlement.rateCardEffectiveFrom}</time>
                    </td>
                    <td className="py-2 pr-3 font-mono">{formatSettlementAmount(settlement.amount)}</td>
                    <td className="py-2">{settlementStatusLabel(settlement.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

async function signChallenge(challenge: string): Promise<string | null> {
  const freighter = (window as unknown as {
    freighter?: { signMessage?: (message: string) => Promise<unknown> };
  }).freighter;
  if (!freighter?.signMessage) return null;
  const result = await freighter.signMessage(challenge);
  if (typeof result === 'string' && result.length > 0) return result;
  if (result && typeof result === 'object' && 'signature' in result) {
    const signature = (result as { signature?: unknown }).signature;
    if (typeof signature === 'string' && signature.length > 0) return signature;
  }
  return null;
}
