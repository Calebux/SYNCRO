'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PaymentChannel,
  topUpChannel,
  closeChannel,
  getWatchtowers,
  grantWatchtowerAuthority,
  revokeWatchtowerAuthority,
  WatchtowerRecord,
} from '@/lib/payment-channel';
import { ChannelStateHistory } from '@/components/channels/ChannelStateHistory';
import { Button } from "@syncro/ui";
import { Input } from "@syncro/ui";
import { Label } from "@syncro/ui";
import { AlertTriangle, CheckCircle2, Clock3, ShieldAlert } from 'lucide-react';

interface ChannelDetailProps {
  channel: PaymentChannel;
  onBack: () => void;
  onUpdate: (channel: PaymentChannel) => void;
}

export function ChannelDetail({ channel, onBack, onUpdate }: ChannelDetailProps) {
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [isCloseLoading, setIsCloseLoading] = useState(false);
  const [closeIntent, setCloseIntent] = useState<null | { unilateral: boolean }>(null);
  const [isGrantOpen, setIsGrantOpen] = useState(false);
  const [watchtowers, setWatchtowers] = useState<WatchtowerRecord[]>([]);
  const [grantAddress, setGrantAddress] = useState('');
  const [grantBounty, setGrantBounty] = useState('0');
  const [isGrantLoading, setIsGrantLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let isMounted = true;
    getWatchtowers(channel.id)
      .then((records) => {
        if (isMounted) setWatchtowers(records);
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, [channel.id]);

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

  const getStateMeta = (state: string) => {
    switch (state) {
      case 'active':
        return {
          className: 'bg-green-100 text-green-800',
          label: 'Healthy: Active',
          icon: CheckCircle2,
        };
      case 'closing':
        return {
          className: 'bg-yellow-100 text-yellow-800',
          label: 'Degraded: Challenge Period',
          icon: Clock3,
        };
      case 'closed':
        return {
          className: 'bg-gray-100 text-gray-800',
          label: 'Closed',
          icon: ShieldAlert,
        };
      case 'dispute':
        return {
          className: 'bg-red-100 text-red-800',
          label: 'Failing: In Dispute',
          icon: AlertTriangle,
        };
      default:
        return {
          className: 'bg-gray-100 text-gray-800',
          label: state,
          icon: ShieldAlert,
        };
    }
  };

  const stateMeta = getStateMeta(channel.state);
  const StateIcon = stateMeta.icon;

  const challengeTimeLeft = useMemo(() => {
    if (!channel.challengePeriodEndsAt) return null;
    const msLeft = new Date(channel.challengePeriodEndsAt).getTime() - now;
    return Math.max(0, msLeft);
  }, [channel.challengePeriodEndsAt, now]);

  const challengeCountdownLabel = useMemo(() => {
    if (challengeTimeLeft === null) return null;
    const totalSeconds = Math.floor(challengeTimeLeft / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [challengeTimeLeft]);

  const handleGrantAuthority = async () => {
    if (!grantAddress.trim()) return;
    setIsGrantLoading(true);
    try {
      const records = await grantWatchtowerAuthority(
        channel.id,
        grantAddress.trim(),
        Number(grantBounty || 0),
      );
      setWatchtowers(records);
      setGrantAddress('');
      setGrantBounty('0');
      setIsGrantOpen(false);
    } catch (error) {
      console.error(error);
      alert('Failed to grant authority');
    } finally {
      setIsGrantLoading(false);
    }
  };

  const handleRevokeAuthority = async (address: string) => {
    try {
      const records = await revokeWatchtowerAuthority(channel.id, address);
      setWatchtowers(records);
    } catch (error) {
      console.error(error);
      alert('Failed to revoke authority');
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
        <span className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium ${stateMeta.className}`}>
          <StateIcon className="h-4 w-4" aria-hidden="true" />
          <span>{stateMeta.label}</span>
        </span>
      </div>

      {(channel.state === 'closing' || channel.state === 'dispute') && challengeCountdownLabel && (
        <div className="mb-8 p-4 border border-yellow-300 bg-yellow-50 rounded-xl">
          <p className="text-sm font-semibold text-yellow-900">Challenge window countdown</p>
          <p className="text-2xl font-mono text-yellow-900" aria-live="polite">{challengeCountdownLabel}</p>
          <p className="text-xs text-yellow-800">
            Challenge period ends at {new Date(channel.challengePeriodEndsAt!).toLocaleString()}.
          </p>
        </div>
      )}

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

      <ChannelStateHistory channelId={channel.id} refreshKey={channel.lastUpdated} />

      {channel.state === 'active' && (
        <div className="mb-8 p-6 border border-gray-200 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Authority grants (watchtowers)</h2>
            <Button type="button" variant="outline" onClick={() => setIsGrantOpen(true)}>
              Grant authority
            </Button>
          </div>
          {watchtowers.length === 0 ? (
            <p className="text-sm text-gray-600">No watchtower authority grants configured.</p>
          ) : (
            <ul className="space-y-2">
              {watchtowers.map((record) => (
                <li key={record.address} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{record.address}</p>
                    <p className="text-xs text-gray-600">
                      Bounty: {record.bounty} | Granted: {new Date(record.registeredAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => handleRevokeAuthority(record.address)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {channel.state === 'active' && (
        <div className="p-6 border border-red-200 rounded-xl">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Close Channel</h2>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setCloseIntent({ unilateral: false })}
              disabled={isCloseLoading}
            >
              {isCloseLoading ? 'Closing...' : 'Cooperative Close'}
            </Button>
            <Button
              ref={closeButtonRef}
              variant="destructive"
              onClick={() => setCloseIntent({ unilateral: true })}
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

      {closeIntent && (
        <CloseConfirmationModal
          unilateral={closeIntent.unilateral}
          onCancel={() => setCloseIntent(null)}
          onConfirm={async () => {
            await handleClose(closeIntent.unilateral);
            setCloseIntent(null);
            closeButtonRef.current?.focus();
          }}
        />
      )}

      {isGrantOpen && (
        <GrantAuthorityModal
          address={grantAddress}
          bounty={grantBounty}
          isSubmitting={isGrantLoading}
          onAddressChange={setGrantAddress}
          onBountyChange={setGrantBounty}
          onCancel={() => setIsGrantOpen(false)}
          onConfirm={handleGrantAuthority}
        />
      )}
    </div>
  );
}

interface CloseConfirmationModalProps {
  unilateral: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

function CloseConfirmationModal({ unilateral, onConfirm, onCancel }: CloseConfirmationModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      modalRef.current?.querySelector<HTMLElement>('button')?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-confirm-title"
      aria-describedby="close-confirm-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div ref={modalRef} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="close-confirm-title" className="text-lg font-semibold text-gray-900 mb-3">
          Confirm {unilateral ? 'Unilateral' : 'Cooperative'} Close
        </h3>
        <p id="close-confirm-description" className="text-sm text-gray-600 mb-5">
          {unilateral
            ? 'This starts the dispute challenge period. Continue only if cooperative close is unavailable.'
            : 'This requests channel closure with both parties and starts the challenge period clock.'}
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={unilateral ? 'destructive' : 'default'}
            onClick={async () => {
              setIsSubmitting(true);
              try {
                await onConfirm();
              } finally {
                setIsSubmitting(false);
              }
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Confirm close'}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface GrantAuthorityModalProps {
  address: string;
  bounty: string;
  isSubmitting: boolean;
  onAddressChange: (value: string) => void;
  onBountyChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

function GrantAuthorityModal({
  address,
  bounty,
  isSubmitting,
  onAddressChange,
  onBountyChange,
  onCancel,
  onConfirm,
}: GrantAuthorityModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      modalRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="grant-authority-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div ref={modalRef} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="grant-authority-title" className="text-lg font-semibold text-gray-900 mb-4">
          Grant watchtower authority
        </h3>
        <div className="space-y-4">
          <div>
            <Label htmlFor="watchtower-address">Watchtower address</Label>
            <Input
              id="watchtower-address"
              value={address}
              onChange={(event) => onAddressChange(event.target.value)}
              placeholder="watchtower-address"
              disabled={isSubmitting}
            />
          </div>
          <div>
            <Label htmlFor="watchtower-bounty">Bounty cap</Label>
            <Input
              id="watchtower-bounty"
              type="number"
              min="0"
              value={bounty}
              onChange={(event) => onBountyChange(event.target.value)}
              disabled={isSubmitting}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onConfirm()} disabled={isSubmitting || !address.trim()}>
            {isSubmitting ? 'Granting...' : 'Grant'}
          </Button>
        </div>
      </div>
    </div>
  );
}
