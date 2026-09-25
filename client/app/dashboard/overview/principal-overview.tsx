"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CircleAlert, RefreshCw, ShieldAlert } from 'lucide-react';
import type { PrincipalAnalytics } from '@syncro/shared/domain';
import { getPrincipalAnalytics } from '@/lib/api/v3-analytics';

const money = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function formatAmount(value: number) {
    return money.format(value);
}

function daysUntil(value: string | null) {
    if (!value) return 'No projection';
    const days = Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 86_400_000));
    return days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`;
}

export function PrincipalOverview() {
    const [analytics, setAnalytics] = useState<PrincipalAnalytics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            setAnalytics(await getPrincipalAnalytics());
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load overview');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { void load(); }, []);

    if (loading && !analytics) {
        return <main className="min-h-screen bg-[#f6f7f4] p-6 md:p-10"><div className="mx-auto max-w-7xl animate-pulse space-y-5"><div className="h-12 w-72 rounded bg-gray-200" /><div className="grid gap-5 md:grid-cols-3"><div className="h-32 rounded-2xl bg-white" /><div className="h-32 rounded-2xl bg-white" /><div className="h-32 rounded-2xl bg-white" /></div><div className="h-80 rounded-2xl bg-white" /></div></main>;
    }

    if (!analytics) {
        return <main className="min-h-screen bg-[#f6f7f4] p-6 md:p-10"><div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 text-center"><CircleAlert className="mx-auto mb-3 h-10 w-10 text-red-600" /><h1 className="text-xl font-semibold text-gray-950">Overview unavailable</h1><p className="mt-2 text-sm text-gray-600">{error}</p><button onClick={() => void load()} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white"><RefreshCw className="h-4 w-4" />Retry</button></div></main>;
    }

    const totalCapacity = analytics.capUtilizationPerAgent.reduce((sum, agent) => sum + agent.capacity, 0);
    const totalSpend = analytics.capUtilizationPerAgent.reduce((sum, agent) => sum + (agent.currentSpend ?? agent.capacity - agent.currentBalance), 0);
    const criticalAlerts = analytics.alerts.filter((alert) => alert.severity === 'critical');

    return (
        <main className="min-h-screen bg-[#f6f7f4] px-4 py-6 text-[#17211b] md:px-10 md:py-9">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Principal console</p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Spend overview</h1>
                        <p className="mt-2 max-w-2xl text-sm text-gray-600">Know what your agents are spending, how long their channels will last, and what needs attention.</p>
                    </div>
                    <button onClick={() => void load()} disabled={loading} aria-label="Refresh overview" className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
                </header>

                {analytics.alerts.length > 0 && (
                    <section aria-labelledby="attention-heading" className="space-y-3">
                        <h2 id="attention-heading" className="sr-only">Needs attention</h2>
                        {analytics.alerts.map((alert, index) => (
                            <div key={`${alert.type}-${alert.createdAt}-${index}`} role="alert" className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${alert.severity === 'critical' ? 'border-red-300 bg-red-50 text-red-950' : 'border-amber-300 bg-amber-50 text-amber-950'}`}>
                                {alert.severity === 'critical' ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
                                <div className="min-w-0"><p className="font-semibold">{alert.type === 'degraded_mode' ? 'Degraded metering' : alert.type === 'reconciliation_delta' ? 'Reconciliation delta' : alert.type === 'dispute' ? 'Channel dispute' : 'Pending close'}</p><p className="text-sm">{alert.message}</p></div>
                                <span className="ml-auto shrink-0 text-xs opacity-70">{date.format(new Date(alert.createdAt))}</span>
                            </div>
                        ))}
                    </section>
                )}

                <section aria-label="Spend summary" className="grid gap-4 md:grid-cols-3">
                    <Metric label="Spend against caps" value={`${formatAmount(totalSpend)} / ${formatAmount(totalCapacity)}`} detail={totalCapacity ? `${Math.round((totalSpend / totalCapacity) * 100)}% committed` : 'No active caps'} />
                    <Metric label="Metered calls" value={formatAmount(analytics.callsMetered)} detail={`${formatAmount(analytics.valueSettled)} settled in period`} />
                    <Metric label="Active channels" value={String(analytics.activeChannels)} detail={`${formatAmount(analytics.valueUnsettled)} unsettled`} />
                </section>

                <section aria-labelledby="agents-heading" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-baseline justify-between gap-4"><div><h2 id="agents-heading" className="text-lg font-semibold">Spend by agent</h2><p className="mt-1 text-sm text-gray-500">Current spend, remaining cap, and when the cap binds at the current rate.</p></div><span className="text-xs text-gray-500">{analytics.period.start.slice(0, 10)} to {analytics.period.end.slice(0, 10)}</span></div>
                    <div className="mt-5 space-y-5">
                        {analytics.capUtilizationPerAgent.length === 0 ? <Empty text="No active agent caps yet." /> : analytics.capUtilizationPerAgent.map((agent) => {
                            const spend = agent.currentSpend ?? Math.max(0, agent.capacity - agent.currentBalance);
                            const percentage = agent.capacity ? Math.min(100, (spend / agent.capacity) * 100) : 0;
                            return <div key={agent.agentId}><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{agent.agentName}</span><span className="text-gray-600">{formatAmount(spend)} spent of {formatAmount(agent.capacity)} cap</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${percentage >= 85 ? 'bg-red-500' : percentage >= 65 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(2, percentage)}%` }} /></div><div className="mt-1 flex justify-between text-xs text-gray-500"><span>{agent.dailySpendRate ? `${formatAmount(agent.dailySpendRate)}/day` : 'Rate unavailable'}</span><span>{agent.projectedCapAt ? `Cap binds ${daysUntil(agent.projectedCapAt)}` : 'No bind projection'}</span></div></div>;
                        })}
                    </div>
                </section>

                <div className="grid gap-6 lg:grid-cols-2">
                    <section aria-labelledby="channels-heading" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><h2 id="channels-heading" className="text-lg font-semibold">Channel health</h2><p className="mt-1 text-sm text-gray-500">Balance, burn rate, exhaustion, and close state.</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><thead className="border-b text-xs uppercase text-gray-500"><tr><th className="py-2 pr-3">Agent</th><th className="py-2 pr-3">Balance</th><th className="py-2 pr-3">Burn/day</th><th className="py-2 pr-3">Exhaustion</th><th className="py-2">State</th></tr></thead><tbody>{analytics.channelHealth.length === 0 ? <tr><td colSpan={5} className="py-8"><Empty text="No channels to monitor." /></td></tr> : analytics.channelHealth.map((channel) => <tr key={channel.channelId} className="border-b last:border-0"><th className="py-3 pr-3 font-medium">{channel.agentName}</th><td className="py-3 pr-3">{formatAmount(channel.balance)} / {formatAmount(channel.capacity)}</td><td className="py-3 pr-3">{formatAmount(channel.burnRatePerDay)}</td><td className="py-3 pr-3">{daysUntil(channel.projectedExhaustionAt)}</td><td className={`py-3 font-medium ${channel.state === 'dispute' ? 'text-red-700' : channel.state === 'closing' ? 'text-amber-700' : 'text-emerald-700'}`}>{channel.pendingClose ? channel.state === 'dispute' ? 'Dispute' : 'Closing' : 'Healthy'}</td></tr>)}</tbody></table></div></section>

                    <section aria-labelledby="activity-heading" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><h2 id="activity-heading" className="text-lg font-semibold">Recent activity</h2><p className="mt-1 text-sm text-gray-500">Calls by route and rejected calls by reason.</p><div className="mt-4 space-y-5"><div><h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Routes</h3>{analytics.routeMix.length === 0 ? <Empty text="No calls recorded in this period." /> : <div className="mt-2 space-y-2">{analytics.routeMix.map((route) => <div key={route.route} className="flex items-center gap-3 text-sm"><span className="w-28 truncate font-medium">{route.route}</span><div className="h-2 flex-1 rounded-full bg-gray-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.max(2, route.percentage)}%` }} /></div><span className="w-20 text-right text-gray-600">{formatAmount(route.callsCount)} calls</span></div>)}</div>}</div><div><h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Rejections</h3>{analytics.rejectionReasonsByCategory.length === 0 ? <Empty text="No rejected calls recorded." /> : <div className="mt-2 grid gap-2 sm:grid-cols-2">{analytics.rejectionReasonsByCategory.map((reason) => <div key={reason.category} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"><span className="capitalize">{reason.category.replaceAll('_', ' ')}</span><span className="font-semibold text-red-700">{formatAmount(reason.count)} <span className="font-normal text-gray-500">({Math.round(reason.percentage)}%)</span></span></div>)}</div>}</div></div><Link href="/dashboard/analytics" className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-900">Open detailed analytics <ArrowRight className="h-4 w-4" /></Link></section>
                </div>

                {criticalAlerts.length > 0 && <p className="text-xs text-gray-500">Critical conditions are shown at the top of this page and should be addressed before continuing to fund agents.</p>}
            </div>
        </main>
    );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-sm text-gray-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-gray-500">{detail}</p></div>;
}

function Empty({ text }: { text: string }) {
    return <p className="py-3 text-sm text-gray-500">{text}</p>;
}
