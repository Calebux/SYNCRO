'use client';

import { useEffect, useMemo, useState } from 'react';

type PrivacyMetrics = {
    privacy_mode_enabled_rate_percent: number | null;
    subscriptions_encrypted_onchain_rate_percent: number | null;
    active_payment_channels_count: number;
    zk_proofs_generated_count: number;
    zk_proofs_verified_count: number;
    stealth_address_adoption_rate_percent: number | null;
    gdpr_export_requests_count: number;
    gdpr_deletion_requests_count: number;
    generated_at: string;
};

type ApiResponse<T> = {
    success: boolean;
    data: T;
};

type CardProps = {
    label: string;
    value: string;
    hint?: string;
};


function Card({ label, value, hint }: CardProps) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">{label}</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{value}</div>
            {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
        </div>
    );
}

function fmtPercent(x: number | null | undefined) {
    if (x === null || x === undefined || !Number.isFinite(x)) return '—';
    return `${x.toFixed(2)}%`;
}

function fmtCount(x: number | null | undefined) {
    if (x === null || x === undefined || !Number.isFinite(x)) return '—';
    return new Intl.NumberFormat().format(x);
}

function downloadCsv(url: string) {
    // CSV is served as attachment; browser will handle the download.
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

export default function PrivacyComplianceAdminPage() {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    const [metrics, setMetrics] = useState<PrivacyMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const cards = useMemo(() => {
        if (!metrics) return [] as Array<{ label: string; value: string; hint?: string }>;

        return [
            {
                label: '% of users with privacy mode enabled',
                value: fmtPercent(metrics.privacy_mode_enabled_rate_percent),
                hint: 'Aggregated across all users (no user-level data).',
            },
            {
                label: '% of subscriptions encrypted on-chain',
                value: fmtPercent(metrics.subscriptions_encrypted_onchain_rate_percent),
                hint: 'Aggregated across subscriptions.',
            },
            {
                label: 'Number of active payment channels',
                value: fmtCount(metrics.active_payment_channels_count),
                hint: 'Count of active channels.',
            },
            {
                label: 'ZK proofs generated',
                value: fmtCount(metrics.zk_proofs_generated_count),
                hint: 'Total generated proofs.',
            },
            {
                label: 'ZK proofs verified',
                value: fmtCount(metrics.zk_proofs_verified_count),
                hint: 'Total verified proofs.',
            },
            {
                label: 'Stealth address adoption rate',
                value: fmtPercent(metrics.stealth_address_adoption_rate_percent),
                hint: 'Aggregated across users.',
            },
            {
                label: 'GDPR export requests',
                value: fmtCount(metrics.gdpr_export_requests_count),
                hint: 'Count of GDPR data export requests.',
            },
            {
                label: 'GDPR deletion requests',
                value: fmtCount(metrics.gdpr_deletion_requests_count),
                hint: 'Count of GDPR deletion requests.',
            },
        ];
    }, [metrics]);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`${API_BASE}/api/admin/privacy-metrics`, {
                    credentials: 'include',
                });
                if (!res.ok) throw new Error(`Failed to load metrics (${res.status})`);
                const json = (await res.json()) as ApiResponse<PrivacyMetrics>;
                if (!cancelled) {
                    if (!json?.success) throw new Error('Metrics response not successful');
                    setMetrics(json.data);
                }
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, [API_BASE]);

    const csvUrl = `${API_BASE}/api/admin/privacy-metrics.csv`;

    return (
        <main className="min-h-screen bg-gray-50 py-10 px-4">
            <div className="mx-auto max-w-6xl">
                <div className="flex items-start justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl font-semibold text-gray-900">Privacy compliance dashboard</h1>
                        <p className="text-sm text-gray-500 mt-1">
                            Admin view: privacy feature adoption, encrypted data statistics, and compliance status.
                            All metrics are aggregated (no user-level data).
                        </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                        <button
                            type="button"
                            onClick={() => downloadCsv(csvUrl)}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                            disabled={loading}
                        >
                            Export CSV
                        </button>
                        {metrics?.generated_at ? (
                            <div className="text-xs text-gray-400">Last generated: {new Date(metrics.generated_at).toLocaleString()}</div>
                        ) : null}
                    </div>
                </div>

                {error ? (
                    <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 text-sm">{error}</div>
                ) : null}

                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm animate-pulse">
                                <div className="h-3 w-2/3 bg-gray-200 rounded" />
                                <div className="mt-3 h-6 w-1/2 bg-gray-200 rounded" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {cards.map((c) => (
                            <Card key={c.label} label={c.label} value={c.value} hint={c.hint} />
                        ))}
                    </div>
                )}

                <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="text-sm font-semibold text-gray-900">Privacy guarantees</h2>
                    <ul className="mt-3 text-sm text-gray-600 list-disc pl-5 space-y-1">
                        <li>No individual user data visible in this dashboard.</li>
                        <li>CSV export uses the same aggregated dataset.</li>
                        <li>Admin access is gated on the backend.</li>
                    </ul>
                </div>
            </div>
        </main>
    );
}

