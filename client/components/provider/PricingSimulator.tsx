'use client';

import { useMemo, useState } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, formatSettlementAmount } from '@syncro/ui';
import type { ProviderConsoleClient, ProviderConsoleSnapshot, PricingSimulationResult } from '@/lib/provider-console';

const STROOPS_PER_USDC = 10_000_000;
const asUsdc = (stroops: number) => formatSettlementAmount(stroops / STROOPS_PER_USDC);

export function PricingSimulator({ snapshot, client }: { snapshot: ProviderConsoleSnapshot; client: ProviderConsoleClient }) {
  const [routeId, setRouteId] = useState(snapshot.routes[0]?.routeId ?? '');
  const selected = snapshot.routes.find((route) => route.routeId === routeId);
  const currentVersion = selected?.applicableVersion;
  const [source, setSource] = useState<'historical' | 'hypothetical'>('historical');
  const [priceStroops, setPriceStroops] = useState(String(currentVersion?.price ?? selected?.price ?? 1));
  const [freeUnits, setFreeUnits] = useState('0');
  const [firstBandUnits, setFirstBandUnits] = useState('1000');
  const [firstBandPrice, setFirstBandPrice] = useState(String(currentVersion?.price ?? selected?.price ?? 1));
  const [overflowPrice, setOverflowPrice] = useState(String(currentVersion?.price ?? selected?.price ?? 1));
  const [feeBps, setFeeBps] = useState('250');
  const [agentId, setAgentId] = useState('agent-1');
  const [calls, setCalls] = useState('100');
  const [unitsPerCall, setUnitsPerCall] = useState('1000');
  const [result, setResult] = useState<PricingSimulationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRun = Boolean(selected) && Number(priceStroops) > 0 && Number.isSafeInteger(Number(freeUnits)) && Number(freeUnits) >= 0 && Number(firstBandUnits) > 0 && Number(firstBandPrice) > 0 && Number(overflowPrice) > 0 && Number.isInteger(Number(feeBps)) && Number(feeBps) >= 0 && Number(feeBps) <= 10000 && (source === 'historical' || (agentId.trim() && Number.isInteger(Number(calls)) && Number(calls) > 0 && Number(calls) <= 100000 && Number(unitsPerCall) >= 0));
  const tiers = useMemo(() => [{ upToUnits: Number(firstBandUnits), priceStroops: Number(firstBandPrice) }, { upToUnits: null, priceStroops: Number(overflowPrice) }], [firstBandUnits, firstBandPrice, overflowPrice]);

  async function runSimulation() {
    if (!selected || !canRun) return;
    setBusy(true); setError(null);
    try {
      const next = await client.simulatePricing(snapshot.provider.providerId, {
        routeId, source, priceStroops: Number(priceStroops), freeUnits: Number(freeUnits), tiers, platformFeeBps: Number(feeBps),
        ...(source === 'hypothetical' ? { traffic: [{ agentId: agentId.trim(), calls: Number(calls), unitsPerCall: Number(unitsPerCall) }] } : {}),
      });
      setResult(next);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not run the pricing simulation.'); }
    finally { setBusy(false); }
  }

  return <Card>
    <CardHeader><CardTitle>Pricing simulator</CardTitle><CardDescription>Compare a draft rate card with the current version using historical settlements or hypothetical agent traffic. Pricing inputs are integer stroops per unit.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      {snapshot.routes.length === 0 ? <p className="text-sm text-muted-foreground">Add a route before simulating its pricing.</p> : <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">Route<select className="h-9 rounded-md border bg-transparent px-3" value={routeId} onChange={(e) => { setRouteId(e.target.value); setResult(null); }}>{snapshot.routes.map((route) => <option key={route.routeId} value={route.routeId}>{route.method} {route.pathPattern}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Traffic source<select className="h-9 rounded-md border bg-transparent px-3" value={source} onChange={(e) => { setSource(e.target.value as 'historical' | 'hypothetical'); setResult(null); }}><option value="historical">Historical settlements</option><option value="hypothetical">Hypothetical traffic</option></select></label>
          <label className="grid gap-1 text-sm">Draft fallback price (stroops / unit)<Input type="number" min="1" step="1" value={priceStroops} onChange={(e) => setPriceStroops(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">Free units per call<Input type="number" min="0" step="1" value={freeUnits} onChange={(e) => setFreeUnits(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">First tier limit (units)<Input type="number" min="1" step="1" value={firstBandUnits} onChange={(e) => setFirstBandUnits(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">First tier price (stroops / unit)<Input type="number" min="1" step="1" value={firstBandPrice} onChange={(e) => setFirstBandPrice(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">Additional tier price (stroops / unit)<Input type="number" min="1" step="1" value={overflowPrice} onChange={(e) => setOverflowPrice(e.target.value)} /></label>
          <label className="grid gap-1 text-sm">Estimated platform fee (basis points)<Input type="number" min="0" max="10000" step="1" value={feeBps} onChange={(e) => setFeeBps(e.target.value)} /></label>
        </div>
        {source === 'hypothetical' && <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3"><label className="grid gap-1 text-sm">Agent identifier<Input value={agentId} onChange={(e) => setAgentId(e.target.value)} /></label><label className="grid gap-1 text-sm">Calls<Input type="number" min="1" max="100000" step="1" value={calls} onChange={(e) => setCalls(e.target.value)} /></label><label className="grid gap-1 text-sm">Units per call<Input type="number" min="0" step="any" value={unitsPerCall} onChange={(e) => setUnitsPerCall(e.target.value)} /></label></div>}
        <p className="text-xs text-muted-foreground">Tier prices are marginal. Free units apply first on each call. Historical mode groups stored settlement quantities by payment channel because the current settlement record does not retain an agent identifier.</p>
        <Button type="button" disabled={!canRun || busy} onClick={() => void runSimulation()}>{busy ? 'Calculating…' : 'Run simulation'}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {result && <div className="space-y-4" aria-live="polite">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="Draft gross revenue" value={asUsdc(result.totals.draftGrossStroops)} /><Metric label="Estimated platform fee" value={asUsdc(result.totals.draftPlatformFeeStroops)} /><Metric label="Projected provider net" value={asUsdc(result.totals.draftProviderNetStroops)} /><Metric label="Current-card revenue" value={asUsdc(result.totals.currentGrossStroops)} /><Metric label="Revenue difference" value={asUsdc(result.totals.differenceStroops)} /><Metric label="Calls simulated" value={String(result.totals.calls)} />
          </div>
          <p className="text-xs text-muted-foreground">Fees are estimates using the fee rate entered; the current gateway settlement path does not deduct this fee.</p>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2 pr-3">Agent / channel</th><th className="py-2 pr-3">Calls</th><th className="py-2 pr-3">Draft gross</th><th className="py-2 pr-3">Fee estimate</th><th className="py-2 pr-3">Provider net</th><th className="py-2">Current gross</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.agentId} className="border-b"><td className="py-2 pr-3 font-mono text-xs">{row.agentId}</td><td className="py-2 pr-3">{row.calls}</td><td className="py-2 pr-3">{asUsdc(row.draftGrossStroops)}</td><td className="py-2 pr-3">{asUsdc(row.draftPlatformFeeStroops)}</td><td className="py-2 pr-3">{asUsdc(row.draftProviderNetStroops)}</td><td className="py-2">{asUsdc(row.currentGrossStroops)}</td></tr>)}</tbody></table></div>
          <p className="text-xs text-muted-foreground">Draft card compared with current version {result.currentRateCardVersion}.</p>
        </div>}
      </>}
    </CardContent>
  </Card>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold tabular-nums">{value}</p></div>;
}
