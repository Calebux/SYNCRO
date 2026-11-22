'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type V3DeliveryChannel,
  type V3IncomingNotificationEvent,
  type V3NotificationCenterEventType,
  type V3NotificationCenterPreferences,
  type V3NotificationDispatchRecord,
  type V3NotificationItem,
  V3_EVENT_TYPE_METADATA,
  buildNotificationItem,
  emitSeededV3NotificationsRealtime,
  getSeededV3NotificationEvents,
  loadNotificationCenterPreferences,
  loadPersistedNotificationFeed,
  normalizeV3EventType,
  resolveActiveDeliveryChannels,
  saveNotificationCenterPreferences,
  savePersistedNotificationFeed,
  subscribeToV3NotificationStream,
} from '@/lib/notifications/v3-notification-center';

const EVENT_TYPES: V3NotificationCenterEventType[] = [
  'cap_warning',
  'dispute_opened',
  'payout_sent',
  'agent_revoked',
];

const DELIVERY_CHANNELS: Array<{ id: V3DeliveryChannel; label: string }> = [
  { id: 'in_app', label: 'In-app' },
  { id: 'email', label: 'Email' },
  { id: 'webhook', label: 'Webhook' },
];

export interface NotificationCenterProps {
  /** Seed initial v3 events on mount when feed is empty (defaults to true). */
  autoSeedOnMount?: boolean;
  /** Optional initial preferences override. */
  initialPreferences?: V3NotificationCenterPreferences;
  /** Optional initial events override. */
  initialEvents?: V3IncomingNotificationEvent[];
  /** Optional callback invoked whenever preferences are saved. */
  onPreferencesSaved?: (preferences: V3NotificationCenterPreferences) => void | Promise<void>;
  /** Optional callback invoked whenever an event is dispatched across channels. */
  onEventDispatched?: (record: V3NotificationDispatchRecord) => void;
}

export function NotificationCenter({
  autoSeedOnMount = true,
  initialPreferences,
  initialEvents,
  onPreferencesSaved,
  onEventDispatched,
}: NotificationCenterProps) {
  const [preferences, setPreferences] = useState<V3NotificationCenterPreferences>(() =>
    initialPreferences
      ? saveNotificationCenterPreferences(initialPreferences)
      : loadNotificationCenterPreferences(),
  );

  const [items, setItems] = useState<V3NotificationItem[]>(() => {
    const prefs = initialPreferences ?? loadNotificationCenterPreferences();
    if (initialEvents) {
      return initialEvents
        .filter((ev) => prefs[normalizeV3EventType(ev.eventType)]?.in_app)
        .map((ev) => buildNotificationItem(ev, prefs));
    }
    const stored = loadPersistedNotificationFeed();
    if (stored.length > 0) return stored;
    if (!autoSeedOnMount) return [];
    return getSeededV3NotificationEvents()
      .filter((ev) => prefs[normalizeV3EventType(ev.eventType)]?.in_app)
      .map((ev) => buildNotificationItem(ev, prefs));
  });

  const [dispatchLog, setDispatchLog] = useState<V3NotificationDispatchRecord[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread' | 'urgent'>('all');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const ingestIncomingEvent = useCallback(
    (incoming: V3IncomingNotificationEvent) => {
      setPreferences((currentPrefs) => {
        const normalizedType = normalizeV3EventType(incoming.eventType);
        const routedChannels = resolveActiveDeliveryChannels(normalizedType, currentPrefs);
        const built = buildNotificationItem(incoming, currentPrefs);

        const record: V3NotificationDispatchRecord = {
          eventId: built.id,
          eventType: normalizedType,
          routedChannels,
          deliveredInApp: currentPrefs[normalizedType].in_app,
          deliveredEmail: currentPrefs[normalizedType].email,
          deliveredWebhook: currentPrefs[normalizedType].webhook,
          timestamp: built.createdAt,
        };

        setDispatchLog((prev) => [record, ...prev]);
        onEventDispatched?.(record);

        // Respect in-app preference: only add to in-app feed when in_app is enabled
        if (currentPrefs[normalizedType].in_app) {
          setItems((prev) => {
            const exists = prev.some((item) => item.id === built.id);
            const next = exists
              ? prev.map((item) => (item.id === built.id ? { ...built, read: item.read } : item))
              : [built, ...prev];
            savePersistedNotificationFeed(next);
            return next;
          });
        }

        return currentPrefs;
      });
    },
    [onEventDispatched],
  );

  useEffect(() => {
    const unsubscribe = subscribeToV3NotificationStream((incoming) => {
      ingestIncomingEvent(incoming);
    });
    return unsubscribe;
  }, [ingestIncomingEvent]);

  // Visible in-app feed respects the current per-type `in_app` preference
  const visibleItems = useMemo(
    () => items.filter((item) => preferences[item.eventType]?.in_app),
    [items, preferences],
  );

  const unreadCount = useMemo(
    () => visibleItems.filter((item) => !item.read).length,
    [visibleItems],
  );

  const urgentUnreadCount = useMemo(
    () => visibleItems.filter((item) => !item.read && item.urgent).length,
    [visibleItems],
  );

  const filteredItems = useMemo(() => {
    if (filter === 'unread') return visibleItems.filter((item) => !item.read);
    if (filter === 'urgent') return visibleItems.filter((item) => item.urgent);
    return visibleItems;
  }, [visibleItems, filter]);

  function handleMarkRead(id: string) {
    setItems((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, read: true } : item));
      savePersistedNotificationFeed(next);
      return next;
    });
  }

  function handleMarkAllRead() {
    setItems((prev) => {
      const next = prev.map((item) => ({ ...item, read: true }));
      savePersistedNotificationFeed(next);
      return next;
    });
  }

  async function handleTogglePreference(
    eventType: V3NotificationCenterEventType,
    channel: V3DeliveryChannel,
    enabled: boolean,
  ) {
    const nextPrefs: V3NotificationCenterPreferences = {
      ...preferences,
      [eventType]: {
        ...preferences[eventType],
        [channel]: enabled,
      },
    };
    const saved = saveNotificationCenterPreferences(nextPrefs);
    setPreferences(saved);
    setStatusMessage('Notification preferences saved.');
    if (onPreferencesSaved) {
      await onPreferencesSaved(saved);
    }
  }

  function handleSeedRealtime() {
    emitSeededV3NotificationsRealtime();
    setStatusMessage('Seeded v3 events received in real time.');
  }

  return (
    <section
      aria-labelledby="v3-notification-center-heading"
      data-testid="v3-notification-center"
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="v3-notification-center-heading" className="text-lg font-semibold text-gray-900">
              Notification center
            </h2>
            <span
              data-testid="notification-unread-count"
              aria-label={`${unreadCount} unread notifications`}
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                unreadCount > 0 ? 'bg-emerald-100 text-emerald-900' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {unreadCount} unread
            </span>
            {urgentUnreadCount > 0 && (
              <span
                data-testid="notification-urgent-count"
                className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-900"
              >
                {urgentUnreadCount} urgent
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Real-time v3 feed for spend caps at 80%, channel disputes, provider payouts, and agent revocations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSeedRealtime}
            data-testid="seed-realtime-events"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            Stream seeded events
          </button>
          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            data-testid="mark-all-read"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            Mark all as read
          </button>
        </div>
      </div>

      {statusMessage && (
        <p role="status" data-testid="notification-center-status" className="text-xs font-medium text-emerald-700">
          {statusMessage}
        </p>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
        {(['all', 'unread', 'urgent'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            data-testid={`notification-filter-${tab}`}
            className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
              filter === tab
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* In-app Notification Feed */}
      <div className="space-y-3" data-testid="notification-feed-list">
        {filteredItems.length === 0 ? (
          <p data-testid="notification-feed-empty" className="py-4 text-sm text-gray-500">
            No notifications match this filter.
          </p>
        ) : (
          filteredItems.map((item) => (
            <article
              key={item.id}
              data-testid={`notification-item-${item.id}`}
              className={`rounded-xl border p-4 transition-colors ${
                item.urgent
                  ? 'border-red-300 bg-red-50/70'
                  : item.read
                    ? 'border-gray-200 bg-white'
                    : 'border-emerald-300 bg-emerald-50/40'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.urgent && (
                      <span
                        data-testid="urgent-badge"
                        className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white"
                      >
                        Urgent
                      </span>
                    )}
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {V3_EVENT_TYPE_METADATA[item.eventType].label}
                    </span>
                    {!item.read && (
                      <span
                        data-testid={`unread-indicator-${item.id}`}
                        className="inline-block h-2 w-2 rounded-full bg-emerald-600"
                        aria-label="Unread"
                      />
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
                  <p className="text-sm text-gray-700">{item.message}</p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <time dateTime={item.createdAt} className="text-xs text-gray-500">
                    {item.createdAt.slice(0, 16).replace('T', ' ')}
                  </time>
                  <div className="flex items-center gap-2">
                    <a
                      href={item.actionUrl}
                      data-testid={`notification-action-${item.id}`}
                      className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold underline-offset-2 ${
                        item.urgent
                          ? 'bg-red-700 text-white hover:bg-red-800'
                          : 'bg-emerald-700 text-white hover:bg-emerald-800'
                      }`}
                    >
                      {item.actionLabel}
                    </a>
                    {!item.read && (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(item.id)}
                        data-testid={`mark-read-${item.id}`}
                        className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {/* Per-event-type delivery preferences (In-app, Email, Webhook) */}
      <div className="border-t border-gray-200 pt-5 space-y-3" data-testid="notification-preferences-section">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Delivery channels per event type
          </h3>
          <p className="mt-0.5 text-xs text-gray-600">
            Choose for each v3 event type whether notifications are delivered in-app, by email, or by webhook.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="notification-preferences-table">
            <thead>
              <tr className="border-b text-xs uppercase text-gray-500">
                <th className="py-2 pr-3">Event type</th>
                {DELIVERY_CHANNELS.map((channel) => (
                  <th key={channel.id} className="py-2 px-3 text-center">
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENT_TYPES.map((eventType) => {
                const meta = V3_EVENT_TYPE_METADATA[eventType];
                const pref = preferences[eventType];
                return (
                  <tr key={eventType} className="border-b last:border-0" data-testid={`pref-row-${eventType}`}>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2 font-medium text-gray-900">
                        <span>{meta.label}</span>
                        {meta.urgentByDefault && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-800">
                            Urgent
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{meta.description}</p>
                    </td>
                    {DELIVERY_CHANNELS.map((channel) => (
                      <td key={channel.id} className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${meta.label} via ${channel.label}`}
                          data-testid={`pref-${eventType}-${channel.id}`}
                          checked={Boolean(pref?.[channel.id])}
                          onChange={(e) =>
                            void handleTogglePreference(eventType, channel.id, e.target.checked)
                          }
                          className="h-4 w-4 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {dispatchLog.length > 0 && (
        <div className="border-t border-gray-100 pt-3 text-xs text-gray-500" data-testid="notification-dispatch-log">
          Latest delivery routing: <span className="font-mono">{dispatchLog[0]!.eventType}</span> →{' '}
          <span className="font-mono">
            {dispatchLog[0]!.routedChannels.length > 0
              ? dispatchLog[0]!.routedChannels.join(', ')
              : 'muted'}
          </span>
        </div>
      )}
    </section>
  );
}
