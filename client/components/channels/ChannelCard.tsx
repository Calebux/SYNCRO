'use client';

import { PaymentChannel } from '@/lib/payment-channel';

interface ChannelCardProps {
  channel: PaymentChannel;
  onSelect: (channel: PaymentChannel) => void;
}

export function ChannelCard({ channel, onSelect }: ChannelCardProps) {
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

  const isLowBalance = parseFloat(channel.balance) < 10;

  return (
    <div
      onClick={() => onSelect(channel)}
      className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{channel.counterparty}</h3>
          <p className="text-sm text-gray-500">ID: {channel.id.slice(0, 8)}...</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStateColor(channel.state)}`}>
          {channel.state}
        </span>
      </div>
      <div className="mb-4">
        <p className="text-sm text-gray-500">Balance</p>
        <p className="text-2xl font-bold text-gray-900">${channel.balance}</p>
        {isLowBalance && (
          <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mt-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Low balance - consider topping up
          </div>
        )}
      </div>
      <div className="text-sm text-gray-500">
        Last updated: {new Date(channel.lastUpdated).toLocaleString()}
      </div>
      {channel.expiry && (
        <div className="flex items-center gap-2 text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mt-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Expires: {new Date(channel.expiry).toLocaleString()}
        </div>
      )}
    </div>
  );
}
