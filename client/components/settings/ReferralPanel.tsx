'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api';

interface ReferralStats {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  conversions: number;
  rewardsEarned: number;
}

export function ReferralPanel() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet('/api/referrals/stats');
      setStats(data);
    } catch {
      setError('Failed to load referral info.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async () => {
    if (!stats) return;
    await navigator.clipboard.writeText(stats.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const twitterUrl = stats
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        `I use SYNCRO to manage my subscriptions without unwanted charges. Join me: ${stats.referralLink}`
      )}`
    : '#';

  const whatsappUrl = stats
    ? `https://wa.me/?text=${encodeURIComponent(
        `Check out SYNCRO — self-custodial subscription manager: ${stats.referralLink}`
      )}`
    : '#';

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-8 bg-gray-200 rounded w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Invite friends to SYNCRO</h2>
        <p className="text-sm text-gray-500 mt-1">
          Share your link and earn 1 month free premium per successful referral.
          Your friend gets a 30-day free trial.
        </p>
      </div>

      {/* Referral link row */}
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={stats?.referralLink ?? ''}
          className="flex-1 text-sm border border-gray-300 rounded px-3 py-2 bg-gray-50 text-gray-700 truncate"
          aria-label="Your referral link"
        />
        <button
          onClick={handleCopy}
          className="shrink-0 px-3 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Share buttons */}
      <div className="flex flex-wrap gap-3">
        <a
          href={twitterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 text-sm rounded bg-sky-500 text-white hover:bg-sky-600 transition-colors"
        >
          Share on Twitter
        </a>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 text-sm rounded bg-green-500 text-white hover:bg-green-600 transition-colors"
        >
          Share on WhatsApp
        </a>
        <button
          onClick={handleCopy}
          className="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Copy Link
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 pt-2 border-t border-gray-100">
        {[
          { label: "Friends referred", value: stats?.totalReferrals ?? 0 },
          { label: "Converted",        value: stats?.conversions ?? 0 },
          { label: "Months earned",    value: stats?.rewardsEarned ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <p className="text-2xl font-semibold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
