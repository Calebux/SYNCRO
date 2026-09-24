'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getChannels,
  getChannelPreferences,
  updateChannelPreferences,
  openChannelStream,
  PaymentChannel,
} from '@/lib/payment-channel';
import { ChannelCard } from '@/components/channels/ChannelCard';
import { ChannelDetail } from '@/components/channels/ChannelDetail';
import { OpenChannelModal } from '@/components/channels/OpenChannelModal';
import { Button } from "@syncro/ui";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<PaymentChannel | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [autoTopUp, setAutoTopUp] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'polling'>('connecting');
  const [degradedMode, setDegradedMode] = useState(false);
  const [lastFreshAt, setLastFreshAt] = useState<string | null>(null);
  const [staleAgeSeconds, setStaleAgeSeconds] = useState(0);

  const loadChannels = async () => {
    try {
      const data = await getChannels();
      setChannels(data);
      setLastFreshAt(new Date().toISOString());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadChannels();
    getChannelPreferences()
      .then((prefs) => setAutoTopUp(prefs.autoTopUp))
      .catch(() => undefined);

    let pollingInterval: ReturnType<typeof setInterval> | null = null;
    const source = openChannelStream((snapshot) => {
      if (snapshot.type === 'snapshot') {
        setStreamStatus('live');
        setChannels(snapshot.channels ?? []);
        setDegradedMode(Boolean(snapshot.degradedMode));
        setLastFreshAt(snapshot.serverTime);
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
        return;
      }

      setStreamStatus('polling');
      if (!pollingInterval) {
        pollingInterval = setInterval(() => {
          void loadChannels();
        }, 10000);
      }
    });

    return () => {
      source.close();
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, []);

  useEffect(() => {
    const ticker = setInterval(() => {
      if (!lastFreshAt) {
        setStaleAgeSeconds(0);
        return;
      }
      const age = Math.max(0, Math.floor((Date.now() - new Date(lastFreshAt).getTime()) / 1000));
      setStaleAgeSeconds(age);
    }, 1000);

    return () => clearInterval(ticker);
  }, [lastFreshAt]);

  const handleAutoTopUpToggle = async (enabled: boolean) => {
    setSavingPrefs(true);
    try {
      const prefs = await updateChannelPreferences({ autoTopUp: enabled });
      setAutoTopUp(prefs.autoTopUp);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleChannelOpened = (channel: PaymentChannel) => {
    setChannels((prev) => [...prev, channel]);
  };

  const handleChannelUpdate = (updated: PaymentChannel) => {
    setChannels((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setSelectedChannel(updated);
  };

  const hasLowBalance = channels.some((c) => parseFloat(c.balance) < 10);
  const hasExpiring = channels.some((c) => c.expiry && new Date(c.expiry) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const statusCounts = {
    active: channels.filter((c) => c.state === 'active').length,
    closing: channels.filter((c) => c.state === 'closing').length,
    dispute: channels.filter((c) => c.state === 'dispute').length,
    closed: channels.filter((c) => c.state === 'closed').length,
  };

  const streamStatusLabel = streamStatus === 'live'
    ? 'Live updates connected'
    : streamStatus === 'polling'
      ? 'Live updates disconnected: fallback polling active'
      : 'Connecting to live updates';

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <Link
              href="/settings/privacy"
              className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to Privacy & Data
            </Link>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">Payment Channels</h1>
            <p className="text-sm text-gray-500">Open, monitor, and manage your payment channels.</p>
          </div>
          <Button onClick={() => setIsModalOpen(true)}>Open Channel</Button>
        </div>

        <div className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-sm font-medium text-gray-900">{streamStatusLabel}</p>
          <p className="text-xs text-gray-600">
            Data age: {staleAgeSeconds}s
            {lastFreshAt ? ` (last refreshed ${new Date(lastFreshAt).toLocaleTimeString()})` : ''}
          </p>
        </div>

        {degradedMode && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            Degraded mode is active: some calls may be served unbilled while infrastructure recovers.
          </div>
        )}

        <section aria-labelledby="channel-health-overview" className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 id="channel-health-overview" className="text-base font-semibold text-gray-900 mb-3">
            Channel health overview
          </h2>
          <p className="sr-only">
            {`State totals: ${statusCounts.active} healthy active, ${statusCounts.closing} degraded closing, ${statusCounts.dispute} failing dispute, ${statusCounts.closed} closed.`}
          </p>
          <div aria-hidden="true" className="space-y-3">
            <StatusBar label="Healthy (active)" value={statusCounts.active} tone="green" />
            <StatusBar label="Degraded (closing)" value={statusCounts.closing} tone="yellow" />
            <StatusBar label="Failing (dispute)" value={statusCounts.dispute} tone="red" />
            <StatusBar label="Closed" value={statusCounts.closed} tone="gray" />
          </div>
        </section>

        <div className="mb-6 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900">Auto top-up</p>
            <p className="text-xs text-gray-500">
              Automatically deposit funds when channel balance is low (requires pre-authorization).
            </p>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoTopUp}
              disabled={savingPrefs}
              onChange={(e) => handleAutoTopUpToggle(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">{autoTopUp ? 'On' : 'Off'}</span>
          </label>
        </div>

        {(hasLowBalance || hasExpiring) && (
          <div className="mb-6 space-y-3">
            {hasLowBalance && (
              <div className="flex items-start gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span>One or more channels have low balances. Consider topping up to avoid service interruptions.</span>
              </div>
            )}
            {hasExpiring && (
              <div className="flex items-start gap-2 text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>One or more channels are expiring soon. Close or renew them to avoid disputes.</span>
              </div>
            )}
          </div>
        )}

        {channels.length > 0 && (
          <section aria-labelledby="channel-summary-table" className="mb-6 rounded-xl border border-gray-200 bg-white p-4 overflow-x-auto">
            <h2 id="channel-summary-table" className="text-base font-semibold text-gray-900 mb-2">
              Channel summary table
            </h2>
            <table className="w-full text-sm">
              <caption className="sr-only">
                Channel balance and state table used as text alternative for visual cards and chart.
              </caption>
              <thead>
                <tr className="text-left border-b border-gray-200">
                  <th scope="col" className="px-2 py-2 font-semibold text-gray-700">Counterparty</th>
                  <th scope="col" className="px-2 py-2 font-semibold text-gray-700">State</th>
                  <th scope="col" className="px-2 py-2 font-semibold text-gray-700">Balance</th>
                  <th scope="col" className="px-2 py-2 font-semibold text-gray-700">Last update</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((channel) => (
                  <tr key={`row-${channel.id}`} className="border-b border-gray-100">
                    <th scope="row" className="px-2 py-2 font-medium text-gray-900">{channel.counterparty}</th>
                    <td className="px-2 py-2 text-gray-700">{channel.state}</td>
                    <td className="px-2 py-2 text-gray-700">${channel.balance}</td>
                    <td className="px-2 py-2 text-gray-700">{new Date(channel.lastUpdated).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {selectedChannel ? (
          <ChannelDetail
            channel={selectedChannel}
            onBack={() => setSelectedChannel(null)}
            onUpdate={handleChannelUpdate}
          />
        ) : (
          <>
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-2">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 animate-pulse">
                    <div className="h-6 bg-gray-200 rounded w-1/2 mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-1/3 mb-6" />
                    <div className="h-8 bg-gray-200 rounded w-1/4 mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-2/3" />
                  </div>
                ))}
              </div>
            ) : channels.length === 0 ? (
              <div className="text-center py-12">
                <h3 className="text-lg font-medium text-gray-900 mb-2">No channels yet</h3>
                <p className="text-sm text-gray-500 mb-6">Open a payment channel to get started.</p>
                <Button onClick={() => setIsModalOpen(true)}>Open Channel</Button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {channels.map((channel) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    onSelect={setSelectedChannel}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <OpenChannelModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onChannelOpened={handleChannelOpened}
      />
    </main>
  );
}

interface StatusBarProps {
  label: string;
  value: number;
  tone: 'green' | 'yellow' | 'red' | 'gray';
}

function StatusBar({ label, value, tone }: StatusBarProps) {
  const toneStyles: Record<StatusBarProps['tone'], string> = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    gray: 'bg-gray-500',
  };

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-700 mb-1">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 rounded bg-gray-100 overflow-hidden">
        <div className={`h-full ${toneStyles[tone]}`} style={{ width: `${Math.max(8, value * 24)}px` }} />
      </div>
    </div>
  );
}
