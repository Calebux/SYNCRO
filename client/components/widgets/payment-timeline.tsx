'use client';

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { renewalHistoryApi, type RenewalEvent, type RenewalHistoryResponse } from '@/lib/api/renewal-history';
import { getInvoiceSignedUrl } from '@/lib/api/invoices';
import { Skeleton, VirtualizedList } from '@syncro/ui';
import { BlockchainBadge } from '@/components/widgets/blockchain-badge';
import { formatCurrency } from '@/lib/currency-utils';
import { useUserSettings } from '@/components/providers/user-settings-provider';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentTimelineProps {
  subscriptionId: string;
  subscriptionName?: string;
  darkMode?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  renewed: 'Renewed',
  failed: 'Payment failed',
  reminder_sent: 'Reminder sent',
  cancelled: 'Cancelled',
  paused: 'Paused',
  resumed: 'Resumed',
  trial_started: 'Trial started',
  trial_ended: 'Trial ended',
};

const STATUS_CLASSES: Record<string, string> = {
  success: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
  skipped: 'bg-gray-100 text-gray-600',
};

const EVENT_DOT_CLASSES: Record<string, string> = {
  renewed: 'bg-green-500',
  failed: 'bg-red-500',
  reminder_sent: 'bg-blue-400',
  cancelled: 'bg-gray-500',
  paused: 'bg-yellow-500',
  resumed: 'bg-green-400',
  trial_started: 'bg-indigo-400',
  trial_ended: 'bg-indigo-600',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Fetches a short-lived signed URL on click and opens the invoice PDF in a new
 * tab. The URL is never embedded in the page — it is minted on demand so it
 * cannot leak or outlive its short TTL.
 */
function ViewInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { url } = await getInvoiceSignedUrl(invoiceId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open invoice');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  return (
    <span className="mt-0.5 inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="text-xs text-indigo-500 hover:underline inline-flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 rounded disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? 'Opening…' : 'View Invoice PDF'} ↗
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
}

function TimelineEventRow({
  event,
  currency,
  darkMode,
}: {
  event: RenewalEvent;
  currency: string;
  darkMode?: boolean;
}) {
  const dotClass = EVENT_DOT_CLASSES[event.type] ?? 'bg-gray-400';
  const label = EVENT_LABELS[event.type] ?? event.type;
  const isOnChain = !!event.transactionHash;

  return (
    <li className="relative flex gap-4">
      {/* Timeline spine dot */}
      <div className="flex flex-col items-center">
        <span
          className={`w-3 h-3 rounded-full flex-shrink-0 mt-1 ${dotClass}`}
          aria-hidden="true"
        />
        <span className="flex-1 w-px bg-gray-200 dark:bg-gray-700 mt-1" aria-hidden="true" />
      </div>

      {/* Event content */}
      <div className="pb-5 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {label}
          </span>

          {event.status && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[event.status] ?? 'bg-gray-100 text-gray-600'}`}
            >
              {event.status}
            </span>
          )}

          {isOnChain && (
            <BlockchainBadge
              status={event.blockchainVerified ? 'confirmed' : 'pending'}
              transactionHash={event.transactionHash}
              darkMode={darkMode}
            />
          )}
        </div>

        <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {formatDate(event.date)}
          {event.amount != null && (
            <> · {formatCurrency(event.amount, currency)}{event.currency ? ` ${event.currency}` : ''}</>
          )}
          {event.paymentMethod && <> · {event.paymentMethod}</>}
        </p>

        {event.notes && (
          <p className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {event.notes}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {event.explorerUrl && (
            <a
              href={event.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-500 hover:underline mt-0.5 inline-block focus:outline-none focus:ring-1 focus:ring-indigo-400 rounded"
            >
              View on Stellar Explorer ↗
            </a>
          )}

          {event.invoiceId && <ViewInvoiceButton invoiceId={event.invoiceId} />}
        </div>
      </div>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading payment history…" className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="w-3 h-3 rounded-full mt-1 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-3 w-48 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineEmpty({ darkMode }: { darkMode?: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-10 text-center gap-2"
      aria-labelledby="timeline-empty-heading"
    >
      <svg
        className={`w-8 h-8 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p
        id="timeline-empty-heading"
        className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
      >
        No payment history yet
      </p>
      <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        Events will appear here once renewals are processed.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PaymentTimeline({ subscriptionId, subscriptionName, darkMode }: PaymentTimelineProps) {
  const { settings } = useUserSettings();
  const currency = settings.currency ?? 'USD';

  const [allEvents, setAllEvents] = useState<RenewalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageInfo, setPageInfo] = useState<{ cursor: string | null; hasMore: boolean }>({
    cursor: null,
    hasMore: true,
  });
  const [total, setTotal] = useState(0);
  const loadingRef = useRef(false);

  const loadPage = useCallback(
    async (cursor: string | null) => {
      if (loadingRef.current || !pageInfo.hasMore) return;
      
      loadingRef.current = true;
      setError(null);
      try {
        const result = await renewalHistoryApi.getHistory(subscriptionId, {
          limit: 20,
          cursor,
        });

        const newEvents = result.history.filter(
          (event) => !allEvents.some((existing) => existing.id === event.id)
        );

        if (newEvents.length > 0) {
          setAllEvents((prev) => [...prev, ...newEvents]);
        }

        setPageInfo({
          cursor: result.nextCursor || null,
          hasMore: !!result.nextCursor,
        });
        setTotal(result.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payment history.');
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [subscriptionId, allEvents, pageInfo.hasMore]
  );

  useEffect(() => {
    loadPage(null);
  }, [subscriptionId]);

  const renderTimelineEvent = useCallback(
    (event: RenewalEvent) => (
      <TimelineEventRow event={event} currency={currency} darkMode={darkMode} />
    ),
    [currency, darkMode]
  );

  const cardClass = `rounded-xl border p-5 ${darkMode ? 'bg-[#2D3748] border-[#374151]' : 'bg-white border-gray-200'}`;

  return (
    <section aria-labelledby="timeline-heading" className={cardClass}>
      <div className="flex items-center justify-between mb-4">
        <h2
          id="timeline-heading"
          className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}
        >
          {subscriptionName ? `${subscriptionName} — ` : ''}Payment History
        </h2>
        {total > 0 && (
          <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {total} event{total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading && allEvents.length === 0 && <TimelineSkeleton />}

      {error && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}{' '}
          <button
            onClick={() => loadPage(null)}
            className="underline font-medium hover:no-underline focus:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {!error && allEvents.length === 0 && !loading && (
        <TimelineEmpty darkMode={darkMode} />
      )}

      {allEvents.length > 0 && (
        <VirtualizedList
          items={allEvents}
          itemHeight={140}
          containerHeight={400}
          renderItem={renderTimelineEvent}
          onLoadMore={() => {
            const lastEvent = allEvents[allEvents.length - 1];
            if (lastEvent?.id) {
              loadPage(pageInfo.cursor);
            }
          }}
          hasMore={pageInfo.hasMore}
          isLoading={loading && allEvents.length > 0}
          ariaLabel="Payment timeline"
          role="list"
        />
      )}
    </section>
  );
}
