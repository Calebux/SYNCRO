'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getChannels,
  getChannelPreferences,
  updateChannelPreferences,
  PaymentChannel,
} from '@/lib/payment-channel';
import { ChannelCard } from '@/components/channels/ChannelCard';
import { ChannelDetail } from '@/components/channels/ChannelDetail';
import { OpenChannelModal } from '@/components/channels/OpenChannelModal';
import { Button } from '@/components/ui/button';

export default function ChannelsPage() {
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<PaymentChannel | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [autoTopUp, setAutoTopUp] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const loadChannels = async () => {
    try {
      const data = await getChannels();
      setChannels(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChannels();
    getChannelPreferences()
      .then((prefs) => setAutoTopUp(prefs.autoTopUp))
      .catch(() => undefined);
    const interval = setInterval(loadChannels, 10000);
    return () => clearInterval(interval);
  }, []);

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
