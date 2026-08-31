'use client';

import { useState } from 'react';
import { PaymentChannel, topUpChannel, closeChannel } from '@/lib/payment-channel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ChannelDetailProps {
  channel: PaymentChannel;
  onBack: () => void;
  onUpdate: (channel: PaymentChannel) => void;
}

export function ChannelDetail({ channel, onBack, onUpdate }: ChannelDetailProps) {
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [isCloseLoading, setIsCloseLoading] = useState(false);

  const handleTopUp = async () => {
    if (!topUpAmount || parseFloat(topUpAmount) <= 0) return;
    setIsTopUpLoading(true);
    try {
      const updated = await topUpChannel(channel.id, topUpAmount);
      onUpdate(updated);
      setTopUpAmount('');
    } catch (err) {
      console.error(err);
      alert('Failed to top up channel');
    } finally {
      setIsTopUpLoading(false);
    }
  };

  const handleClose = async (unilateral: boolean = false) => {
    setIsCloseLoading(true);
    try {
      const updated = await closeChannel(channel.id, unilateral);
      onUpdate(updated);
    } catch (err) {
      console.error(err);
      alert('Failed to close channel');
    } finally {
      setIsCloseLoading(false);
    }
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'closing':
        return 'bg-yellow-100 text-yellow-800';
      case 'closed':
        return 'bg-gray-100 text-gray-800';
      case 'dispute':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <button
        onClick={onBack}
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
      >
        <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to channels
      </button>

      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{channel.counterparty}</h1>
          <p className="text-sm text-gray-500">ID: {channel.id}</p>
        </div>
        <span className={`px-4 py-2 rounded-full text-sm font-medium ${getStateColor(channel.state)}`}>
          {channel.state}
        </span>
      </div>

      <div className="mb-8 p-6 bg-gray-50 rounded-xl">
        <p className="text-sm text-gray-500 mb-2">Current Balance</p>
        <p className="text-4xl font-bold text-gray-900">${channel.balance}</p>
      </div>

      {channel.state === 'active' && (
        <div className="mb-8 p-6 border border-gray-200 rounded-xl">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Up Channel</h2>
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="topup-amount">Amount ($)</Label>
              <Input
                id="topup-amount"
                type="number"
                step="0.01"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder="10.00"
                disabled={isTopUpLoading}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleTopUp} disabled={isTopUpLoading || !topUpAmount}>
                {isTopUpLoading ? 'Top Up...' : 'Top Up'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {channel.history && channel.history.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">History</h2>
          <div className="space-y-3">
            {channel.history.map((item) => (
              <div key={item.id} className="p-4 border border-gray-200 rounded-xl flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-gray-900 capitalize">{item.type}</p>
                  {item.description && <p className="text-xs text-gray-500">{item.description}</p>}
                </div>
                <div className="text-right">
                  {item.amount && (
                    <p className="text-sm font-semibold text-gray-900">${item.amount}</p>
                  )}
                  <p className="text-xs text-gray-500">{new Date(item.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {channel.state === 'active' && (
        <div className="p-6 border border-red-200 rounded-xl">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Close Channel</h2>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isCloseLoading}
            >
              {isCloseLoading ? 'Closing...' : 'Cooperative Close'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleClose(true)}
              disabled={isCloseLoading}
            >
              {isCloseLoading ? 'Closing...' : 'Unilateral Close'}
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Cooperative close is recommended. Unilateral close will start a dispute period.
          </p>
        </div>
      )}
    </div>
  );
}
