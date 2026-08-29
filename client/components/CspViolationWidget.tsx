"use client";

import { useEffect, useState } from "react";

interface CspViolationStat {
  violation_signature: string;
  violated_directive: string;
  blocked_uri: string | null;
  disposition: string | null;
  occurrence_count: number;
  affected_users: number;
  first_seen: string;
  last_seen: string;
  count_24h: number;
  count_1h: number;
}

interface ApiResponse {
  success: boolean;
  data: CspViolationStat[];
  count: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CspViolationWidget() {
  const [stats, setStats] = useState<CspViolationStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const res = await fetch("/api/csp-violations/stats?limit=20");
        if (!res.ok) {
          throw new Error(`Failed to fetch CSP stats (${res.status})`);
        }
        const json: ApiResponse = await res.json();
        if (!cancelled) {
          setStats(json.data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchStats();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-gray-800">
        CSP Violation Trends
      </h2>

      {loading && (
        <p className="text-sm text-gray-500">Loading violations...</p>
      )}

      {!loading && error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {!loading && !error && stats.length === 0 && (
        <p className="text-sm text-gray-500">No violations reported.</p>
      )}

      {!loading && !error && stats.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="pb-2 pr-4">Directive</th>
                <th className="pb-2 pr-4">Blocked URI</th>
                <th className="pb-2 pr-4 text-right">Count</th>
                <th className="pb-2 pr-4 text-right">Last 24 h</th>
                <th className="pb-2">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stats.map((stat) => (
                <tr key={stat.violation_signature} className="hover:bg-gray-50">
                  <td className="py-2 pr-4 font-mono text-xs text-gray-800">
                    {stat.violated_directive}
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-600 max-w-xs truncate">
                    {stat.blocked_uri ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-700">
                    {stat.occurrence_count.toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-700">
                    {stat.count_24h.toLocaleString()}
                  </td>
                  <td className="py-2 text-xs text-gray-500 whitespace-nowrap">
                    {formatDate(stat.last_seen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
