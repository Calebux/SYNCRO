export type V3NotificationCenterEventType =
  | 'cap_warning'
  | 'dispute_opened'
  | 'payout_sent'
  | 'agent_revoked';

export type V3DeliveryChannel = 'in_app' | 'email' | 'webhook';

export interface V3EventDeliveryPreference {
  in_app: boolean;
  email: boolean;
  webhook: boolean;
}

export type V3NotificationCenterPreferences = Record<
  V3NotificationCenterEventType,
  V3EventDeliveryPreference
>;

export const V3_EVENT_TYPE_METADATA: Record<
  V3NotificationCenterEventType,
  {
    label: string;
    description: string;
    urgentByDefault: boolean;
    defaultActionLabel: string;
    defaultActionUrl: string;
  }
> = {
  cap_warning: {
    label: 'Spend cap at 80%',
    description: 'Triggered when an agent crosses 80% or 100% of its configured spend cap.',
    urgentByDefault: false,
    defaultActionLabel: 'Adjust spend cap',
    defaultActionUrl: '/agents?action=adjust-cap',
  },
  dispute_opened: {
    label: 'Dispute opened',
    description: 'Triggered when a channel close is contested or a watchtower raises a dispute.',
    urgentByDefault: true,
    defaultActionLabel: 'Respond to dispute',
    defaultActionUrl: '/settings/privacy/channels?action=respond-dispute',
  },
  payout_sent: {
    label: 'Payout sent',
    description: 'Triggered when a provider settlement payout is finalized on-chain.',
    urgentByDefault: false,
    defaultActionLabel: 'View payout settlement',
    defaultActionUrl: '/provider?action=view-payout',
  },
  agent_revoked: {
    label: 'Agent revoked',
    description: 'Triggered when a principal revokes an agent spending key.',
    urgentByDefault: false,
    defaultActionLabel: 'Review revoked agent',
    defaultActionUrl: '/agents?action=review-revocation',
  },
};

export const DEFAULT_V3_NOTIFICATION_CENTER_PREFERENCES: V3NotificationCenterPreferences = {
  cap_warning: { in_app: true, email: true, webhook: false },
  dispute_opened: { in_app: true, email: true, webhook: true },
  payout_sent: { in_app: true, email: true, webhook: false },
  agent_revoked: { in_app: true, email: false, webhook: true },
};

export interface V3IncomingNotificationEvent {
  id?: string;
  eventType:
    | V3NotificationCenterEventType
    | 'cap_threshold_warning'
    | 'dispute_detected'
    | 'payout_change_requested'
    | 'payout_change_applied'
    | 'channel_close_initiated';
  title: string;
  message: string;
  createdAt?: string;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
}

export interface V3NotificationItem {
  id: string;
  eventType: V3NotificationCenterEventType;
  rawEventType: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  urgent: boolean;
  actionUrl: string;
  actionLabel: string;
  routedChannels: V3DeliveryChannel[];
  metadata?: Record<string, unknown>;
}

export interface V3NotificationDispatchRecord {
  eventId: string;
  eventType: V3NotificationCenterEventType;
  routedChannels: V3DeliveryChannel[];
  deliveredInApp: boolean;
  deliveredEmail: boolean;
  deliveredWebhook: boolean;
  timestamp: string;
}

const PREFS_STORAGE_KEY = 'syncro.v3.notificationCenter.preferences';
const FEED_STORAGE_KEY = 'syncro.v3.notificationCenter.feed';

export function normalizeV3EventType(
  rawType: V3IncomingNotificationEvent['eventType'],
): V3NotificationCenterEventType {
  switch (rawType) {
    case 'cap_warning':
    case 'cap_threshold_warning':
      return 'cap_warning';
    case 'dispute_opened':
    case 'dispute_detected':
    case 'channel_close_initiated':
      return 'dispute_opened';
    case 'payout_sent':
    case 'payout_change_requested':
    case 'payout_change_applied':
      return 'payout_sent';
    case 'agent_revoked':
      return 'agent_revoked';
  }
}

export function cloneDefaultPreferences(): V3NotificationCenterPreferences {
  return {
    cap_warning: { ...DEFAULT_V3_NOTIFICATION_CENTER_PREFERENCES.cap_warning },
    dispute_opened: { ...DEFAULT_V3_NOTIFICATION_CENTER_PREFERENCES.dispute_opened },
    payout_sent: { ...DEFAULT_V3_NOTIFICATION_CENTER_PREFERENCES.payout_sent },
    agent_revoked: { ...DEFAULT_V3_NOTIFICATION_CENTER_PREFERENCES.agent_revoked },
  };
}

export function loadNotificationCenterPreferences(): V3NotificationCenterPreferences {
  const defaults = cloneDefaultPreferences();
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return defaults;
  }
  const raw = localStorage.getItem(PREFS_STORAGE_KEY);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<V3NotificationCenterPreferences>;
    const merged = cloneDefaultPreferences();
    for (const key of Object.keys(merged) as V3NotificationCenterEventType[]) {
      const candidate = parsed?.[key];
      if (candidate && typeof candidate === 'object') {
        merged[key] = {
          in_app: typeof candidate.in_app === 'boolean' ? candidate.in_app : merged[key].in_app,
          email: typeof candidate.email === 'boolean' ? candidate.email : merged[key].email,
          webhook: typeof candidate.webhook === 'boolean' ? candidate.webhook : merged[key].webhook,
        };
      }
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function saveNotificationCenterPreferences(
  preferences: V3NotificationCenterPreferences,
): V3NotificationCenterPreferences {
  const snapshot: V3NotificationCenterPreferences = {
    cap_warning: { ...preferences.cap_warning },
    dispute_opened: { ...preferences.dispute_opened },
    payout_sent: { ...preferences.payout_sent },
    agent_revoked: { ...preferences.agent_revoked },
  };
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(snapshot));
  }
  return snapshot;
}

export function resolveActiveDeliveryChannels(
  eventType: V3NotificationCenterEventType,
  preferences: V3NotificationCenterPreferences,
): V3DeliveryChannel[] {
  const pref = preferences[eventType] ?? DEFAULT_V3_NOTIFICATION_CENTER_PREFERENCES[eventType];
  const channels: V3DeliveryChannel[] = [];
  if (pref.in_app) channels.push('in_app');
  if (pref.email) channels.push('email');
  if (pref.webhook) channels.push('webhook');
  return channels;
}

function defaultActionForEvent(
  eventType: V3NotificationCenterEventType,
  metadata?: Record<string, unknown>,
): { actionUrl: string; actionLabel: string } {
  const base = V3_EVENT_TYPE_METADATA[eventType];
  if (eventType === 'dispute_opened') {
    const channelId = typeof metadata?.channelId === 'string' ? metadata.channelId : 'v3-ch-demo';
    return {
      actionUrl: `/settings/privacy/channels?channelId=${encodeURIComponent(channelId)}&action=respond-dispute`,
      actionLabel: base.defaultActionLabel,
    };
  }
  if (eventType === 'cap_warning') {
    const agentId = typeof metadata?.agentId === 'string' ? metadata.agentId : 'v3-agent-demo';
    return {
      actionUrl: `/agents?agentId=${encodeURIComponent(agentId)}&action=adjust-cap`,
      actionLabel: base.defaultActionLabel,
    };
  }
  if (eventType === 'payout_sent') {
    const settlementId =
      typeof metadata?.settlementId === 'string' ? metadata.settlementId : 'stl_prov_003';
    return {
      actionUrl: `/provider?settlementId=${encodeURIComponent(settlementId)}&action=view-payout`,
      actionLabel: base.defaultActionLabel,
    };
  }
  const agentId = typeof metadata?.agentId === 'string' ? metadata.agentId : 'v3-agent-demo';
  return {
    actionUrl: `/agents?agentId=${encodeURIComponent(agentId)}&action=review-revocation`,
    actionLabel: base.defaultActionLabel,
  };
}

export function buildNotificationItem(
  input: V3IncomingNotificationEvent,
  preferences: V3NotificationCenterPreferences,
): V3NotificationItem {
  const eventType = normalizeV3EventType(input.eventType);
  const meta = V3_EVENT_TYPE_METADATA[eventType];
  const defaultAction = defaultActionForEvent(eventType, input.metadata);
  const routedChannels = resolveActiveDeliveryChannels(eventType, preferences);

  return {
    id: input.id ?? `v3_notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    rawEventType: input.eventType,
    title: input.title,
    message: input.message,
    createdAt: input.createdAt ?? new Date().toISOString(),
    read: false,
    urgent: eventType === 'dispute_opened' || meta.urgentByDefault,
    actionUrl: input.actionUrl ?? defaultAction.actionUrl,
    actionLabel: input.actionLabel ?? defaultAction.actionLabel,
    routedChannels,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function getSeededV3NotificationEvents(): V3IncomingNotificationEvent[] {
  return [
    {
      id: 'seed_notif_dispute_1',
      eventType: 'dispute_opened',
      title: 'Channel dispute opened on v3-ch-demo',
      message:
        'Counterparty submitted a stale state close (sequence #14 vs #19) on channel v3-ch-demo. Submit the latest signed state before the challenge window expires.',
      createdAt: '2026-10-22T14:10:00.000Z',
      actionUrl: '/settings/privacy/channels?channelId=v3-ch-demo&action=respond-dispute',
      actionLabel: 'Respond to dispute',
      metadata: {
        channelId: 'v3-ch-demo',
        sequenceNumber: 14,
        cause: 'watchtower_challenge',
      },
    },
    {
      id: 'seed_notif_cap_1',
      eventType: 'cap_warning',
      title: 'Agent v3-agent-demo reached 84% of spend cap',
      message:
        'Demo Agent Alpha has spent 840.00 USDC of its 1,000.00 USDC monthly cap (80% threshold crossed).',
      createdAt: '2026-10-22T13:45:00.000Z',
      actionUrl: '/agents?agentId=v3-agent-demo&action=adjust-cap',
      actionLabel: 'Adjust spend cap',
      metadata: {
        agentId: 'v3-agent-demo',
        percentageUsed: 84,
        currentSpend: 840,
        capAmount: 1000,
      },
    },
    {
      id: 'seed_notif_payout_1',
      eventType: 'payout_sent',
      title: 'Provider payout of 142.50 USDC settled',
      message:
        'Batch settlement stl_prov_003 transferred 142.50 USDC to verified Stellar payout address for v3-provider-demo.',
      createdAt: '2026-10-22T12:20:00.000Z',
      actionUrl: '/provider?settlementId=stl_prov_003&action=view-payout',
      actionLabel: 'View payout settlement',
      metadata: {
        providerId: 'v3-provider-demo',
        settlementId: 'stl_prov_003',
        amount: 142.5,
        asset: 'USDC',
      },
    },
    {
      id: 'seed_notif_revoked_1',
      eventType: 'agent_revoked',
      title: 'Agent v3-agent-research authority revoked',
      message:
        'Spending authority for Research Indexer Agent (v3-agent-research) was revoked. New paid calls are blocked immediately.',
      createdAt: '2026-10-22T11:00:00.000Z',
      actionUrl: '/agents?agentId=v3-agent-research&action=review-revocation',
      actionLabel: 'Review revoked agent',
      metadata: {
        agentId: 'v3-agent-research',
      },
    },
  ];
}

type RealtimeListener = (event: V3IncomingNotificationEvent) => void;

const realtimeListeners = new Set<RealtimeListener>();

/**
 * Subscribe to real-time v3 notification events (#1507).
 */
export function subscribeToV3NotificationStream(
  listener: RealtimeListener,
  options: { sseUrl?: string } = {},
): () => void {
  realtimeListeners.add(listener);

  let eventSource: EventSource | null = null;
  if (options.sseUrl && typeof EventSource !== 'undefined') {
    try {
      eventSource = new EventSource(options.sseUrl, { withCredentials: true });
      eventSource.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as V3IncomingNotificationEvent;
          if (parsed && parsed.eventType && parsed.title) {
            listener(parsed);
          }
        } catch {
          // Ignore malformed stream frame
        }
      };
    } catch {
      eventSource = null;
    }
  }

  return () => {
    realtimeListeners.delete(listener);
    if (eventSource) {
      eventSource.close();
    }
  };
}

/**
 * Publish a single v3 notification event to all active real-time subscribers (#1507).
 */
export function publishV3NotificationEvent(event: V3IncomingNotificationEvent): void {
  for (const listener of Array.from(realtimeListeners)) {
    listener(event);
  }
}

/**
 * Emit all seeded v3 events (cap 80%, dispute opened, payout sent, agent revoked)
 * into the live real-time stream (#1507).
 */
export function emitSeededV3NotificationsRealtime(): V3IncomingNotificationEvent[] {
  const seeded = getSeededV3NotificationEvents();
  for (const event of seeded) {
    publishV3NotificationEvent(event);
  }
  return seeded;
}

export function loadPersistedNotificationFeed(): V3NotificationItem[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return [];
  }
  const raw = localStorage.getItem(FEED_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as V3NotificationItem[]) : [];
  } catch {
    return [];
  }
}

export function savePersistedNotificationFeed(items: V3NotificationItem[]): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify(items));
  }
}

export function resetNotificationCenterStorage(): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.removeItem(PREFS_STORAGE_KEY);
    localStorage.removeItem(FEED_STORAGE_KEY);
  }
}
