'use client';

import { useEffect, useRef, useState } from 'react';
import { openChannel, PaymentChannel } from '@/lib/payment-channel';
import { Button } from "@syncro/ui";
import { Input } from "@syncro/ui";
import { Label } from "@syncro/ui";

interface OpenChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChannelOpened: (channel: PaymentChannel) => void;
}

export function OpenChannelModal({ isOpen, onClose, onChannelOpened }: OpenChannelModalProps) {
  const [depositAmount, setDepositAmount] = useState('');
  const [counterparty, setCounterparty] = useState('SYNCRO Executor');
  const [isLoading, setIsLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])')?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
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
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    setIsLoading(true);
    try {
      const channel = await openChannel(depositAmount, counterparty);
      onChannelOpened(channel);
      setDepositAmount('');
      setCounterparty('SYNCRO Executor');
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to open channel');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-channel-title"
      aria-describedby="open-channel-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 id="open-channel-title" className="text-lg font-semibold text-gray-900 mb-4">Open Payment Channel</h3>
        <p id="open-channel-description" className="text-sm text-gray-600 mb-4">
          Provide the counterparty and initial deposit to open a new channel.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="counterparty">Counterparty</Label>
            <Input
              id="counterparty"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              placeholder="SYNCRO Executor"
              disabled={isLoading}
            />
          </div>
          <div>
            <Label htmlFor="deposit-amount">Deposit Amount ($)</Label>
            <Input
              id="deposit-amount"
              type="number"
              step="0.01"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="100.00"
              disabled={isLoading}
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !depositAmount}>
              {isLoading ? 'Opening...' : 'Open Channel'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
