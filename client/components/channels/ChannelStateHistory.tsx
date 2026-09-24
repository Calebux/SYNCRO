'use client';

/**
 * ChannelStateHistory — operator-grade channel reconstruction view.
 *
 * Shows everything that happened to a channel: open, top-ups, metered
 * payments, submitted states (with nonces / state numbers / confirmation),
 * close initiation, disputes, and finalize — with transaction hashes linking
 * out to a Stellar explorer. Two derived numbers are first-class:
 *  - the unsettled (metered-but-not-submitted) exposure, and
 *  - the challenge window with live time-remaining during a close.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getChannelHistory,
  ChannelHistoryResponse,
  ChannelStateEvent,
  ChannelChallengeStatus,
} from '@/lib/payment-channel';
import { Skeleton } from '@syncro/ui';

interface ChannelStateHistoryProps {
  channelId: string;
  /** Re-fetch when this changes (e.g. the channel's lastUpdated after an action). */
  refreshKey?: string;
}

// ─── Presentation helpers ─────────────────────────────────────────────────────

const EVENT_DOT_CLASSES: Record<ChannelStateEvent['type'], string> = {
  open: 'bg-green-500',
  topup: 'bg-blue-500',
  payment: 'bg-indigo-400',
  state_submitted: 'bg-purple-500',
  close_initiated: 'bg-amber-500',
  dispute: 'bg-red-500',
  finalize: 'bg-gray-500',
};

export function formatChannelAmount(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function formatChallengeDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function shortTx(txHash: string): string {
  return txHash.length > 16 ? `${txHash.slice(0, 8)}…${txHash.slice(-6)}` : txHash;
}

// Live countdown from an ISO deadline, ticking once per second.
function useChallengeCountdown(challenge: ChannelChallengeStatus | null): number | null {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!challenge?.periodActive || !challenge.deadline) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge?.periodActive, challenge?.deadline]);

  if (!challenge?.periodActive || !challenge.deadline) return null;
  return Math.max(0, Math.ceil((Date.parse(challenge.deadline) - now) / 1000));
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

function ExposureCard({ history }: { history: ChannelHistoryResponse }) {
  const { financials } = history;
  const exposureTone =
    financials.unsettled > 0
      ? 'bg-amber-50 border-amber-300'
      : 'bg-gray-50 border-gray-200';

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Settlement &amp; exposure</h3>
        <span className="text-xs text-gray-500">Current channel state</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={`rounded-xl border p-4 ${exposureTone}`}>
          <p className="text-xs font-medium text-gray-600 mb-1" id="unsettled-label">
            Unsettled exposure
          </p>
          <p className="text-2xl font-bold text-gray-900" aria-labelledby="unsettled-label">
            ${formatChannelAmount(financials.unsettled)}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Metered but not yet in a submitted on-chain state — the amount at risk.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Total deposited" value={financials.deposited} />
          <Stat label="User balance" value={financials.userBalance} />
          <Stat label="Metered (counterparty)" value={financials.meteredBalance} />
          <Stat
            label="Committed on-chain"
            value={financials.committedOnChain?.balanceB ?? 0}
            sub={financials.committedOnChain?.transactionHash}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-medium text-gray-500 truncate">{label}</p>
      <p className="text-sm font-semibold text-gray-900">${formatChannelAmount(value)}</p>
      {sub && (
        <p className="text-[10px] text-gray-400 truncate mt-0.5" title={sub}>
          {shortTx(sub)}
        </p>
      )}
    </div>
  );
}

function ChallengeCard({ challenge }: { challenge: ChannelChallengeStatus }) {
  const remaining = useChallengeCountdown(challenge);

  let tone = 'bg-gray-50 border-gray-200';
  let statusLabel = challenge.periodActive ? 'Challenge window open' : 'No close in progress';
  if (challenge.periodActive) {
    tone = remaining !== null && remaining <= 3600 ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300';
  }

  return (
    <div className={`mb-6 rounded-xl border p-5 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Challenge (dispute) window</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {challenge.windowDays}d — finalise is only possible after the window elapses.
          </p>
        </div>
        <div className="text-right">
          {challenge.periodActive ? (
            <>
              <p
                className="text-lg font-bold text-gray-900 tabular-nums"
                aria-label="Time remaining to finalise"
              >
                {remaining !== null ? formatChallengeDuration(remaining) : '…'}
              </p>
              {challenge.deadline && (
                <p className="text-xs text-gray-500">
                  Finalise available {new Date(challenge.deadline).toLocaleString()}
                </p>
              )}
            </>
          ) : (
            <span className="text-xs text-gray-600">{statusLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineTable({ events }: { events: ChannelStateEvent[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Full channel history</h3>
        <span className="text-xs text-gray-500">
          {events.length} event{events.length !== 1 ? 's' : ''} · chronological
        </span>
      </div>

      {events.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">
          No channel activity recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="px-5 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Details</th>
                <th className="px-3 py-2 font-medium text-right">Value</th>
                <th className="px-5 py-2 font-medium">On-chain</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.id}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50"
                >
                  <td className="px-5 py-2.5 text-xs text-gray-600 whitespace-nowrap align-top">
                    <time dateTime={event.timestamp}>
                      {new Date(event.timestamp).toLocaleString()}
                    </time>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${EVENT_DOT_CLASSES[event.type]}`}
                        aria-hidden="true"
                      />
                      <span className="font-medium text-gray-900">{event.title}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 align-top">
                    {event.nonce && <span className="block">nonce {event.nonce}</span>}
                    {event.stateNumber !== undefined && (
                      <span className="block">state #{event.stateNumber}</span>
                    )}
                    {event.sequenceNumber !== undefined && (
                      <span className="block">seq {event.sequenceNumber}</span>
                    )}
                    {event.confirmed !== undefined && (
                      <span
                        className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          event.confirmed
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {event.confirmed ? 'confirmed' : 'unconfirmed'}
                      </span>
                    )}
                    {event.note && <span className="block mt-0.5">{event.note}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap align-top">
                    {event.type === 'open' ||
                    event.type === 'topup' ||
                    event.type === 'payment' ||
                    event.balance !== undefined ? (
                      <span className="font-medium text-gray-900 tabular-nums">
                        ${formatChannelAmount(
                          event.type === 'payment' || event.type === 'topup' || event.type === 'open'
                            ? event.amount
                            : event.balance,
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap align-top">
                    {event.transactionHash ? (
                      <a
                        href={event.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                        title={`View tx ${event.transactionHash} on Stellar Expert`}
                      >
                        {shortTx(event.transactionHash)} ↗
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wide">
                        off-chain
                      </span>
                    )}
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

function HistorySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading channel history" className="space-y-4">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ChannelStateHistory({ channelId, refreshKey }: ChannelStateHistoryProps) {
  const [history, setHistory] = useState<ChannelHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getChannelHistory(channelId);
      if (requestIdRef.current === requestId) setHistory(data);
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : 'Failed to load channel history');
      }
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <section aria-label="Channel state history" className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">State History</h2>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && !history && <HistorySkeleton />}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}{' '}
          <button onClick={load} className="underline font-medium hover:no-underline focus:outline-none">
            Retry
          </button>
        </div>
      )}

      {!error && history && (
        <>
          <ExposureCard history={history} />
          <ChallengeCard challenge={history.challenge} />
          <TimelineTable events={history.events} />
        </>
      )}
    </section>
  );
}