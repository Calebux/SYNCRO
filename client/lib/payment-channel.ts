const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const CHANNEL_STORAGE_KEY = 'syncro_payment_channels';

export interface PaymentChannel {
  id: string;
  counterparty: string;
  balance: string;
  state: 'active' | 'closing' | 'closed' | 'dispute';
  lastUpdated: string;
  expiry?: string;
  challengePeriodEndsAt?: string;
  history?: ChannelHistoryItem[];
}

export interface ChannelHistoryItem {
  id: string;
  type: 'open' | 'topup' | 'payment' | 'close' | 'dispute';
  amount?: string;
  timestamp: string;
  description?: string;
}

export interface ChannelStreamSnapshot {
  type: 'snapshot' | 'error';
  channels?: PaymentChannel[];
  degradedMode?: boolean;
  message?: string;
  serverTime: string;
}

function persistChannels(channels: PaymentChannel[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CHANNEL_STORAGE_KEY, JSON.stringify(channels));
}

function loadPersistedChannels(): PaymentChannel[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(CHANNEL_STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as PaymentChannel[];
  } catch {
    return [];
  }
}

function upsertChannel(channel: PaymentChannel): void {
  const channels = loadPersistedChannels();
  const idx = channels.findIndex((c) => c.id === channel.id);
  if (idx >= 0) channels[idx] = channel;
  else channels.push(channel);
  persistChannels(channels);
}

export async function getChannels(): Promise<PaymentChannel[]> {
  try {
    const res = await fetch(`${API_BASE}/api/payment-channels`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to fetch channels');
    const channels = await res.json();
    persistChannels(channels);
    return channels;
  } catch {
    return loadPersistedChannels();
  }
}

export function openChannelStream(onMessage: (snapshot: ChannelStreamSnapshot) => void): EventSource {
  const streamUrl = `${API_BASE}/api/payment-channels/stream`;
  const source = new EventSource(streamUrl, { withCredentials: true });

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as ChannelStreamSnapshot;
      if (payload.channels) {
        persistChannels(payload.channels);
      }
      onMessage(payload);
    } catch {
      onMessage({
        type: 'error',
        message: 'Failed to parse stream payload',
        serverTime: new Date().toISOString(),
      });
    }
  };

  source.onerror = () => {
    onMessage({
      type: 'error',
      message: 'Live updates unavailable',
      serverTime: new Date().toISOString(),
    });
  };

  return source;
}

export async function openChannel(depositAmount: string, counterparty: string = 'SYNCRO Executor'): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ depositAmount, counterparty }),
  });
  if (!res.ok) throw new Error('Failed to open channel');
  const channel = await res.json();
  upsertChannel(channel);
  return channel;
}

export async function topUpChannel(channelId: string, amount: string): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/topup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) throw new Error('Failed to top up channel');
  const channel = await res.json();
  upsertChannel(channel);
  return channel;
}

export async function closeChannel(channelId: string, unilateral: boolean = false): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/close`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unilateral }),
  });
  if (!res.ok) throw new Error('Failed to close channel');
  const channel = await res.json();
  upsertChannel(channel);
  return channel;
}

export async function getChannel(channelId: string): Promise<PaymentChannel> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch channel');
  const channel = await res.json();
  upsertChannel(channel);
  return channel;
}

export function getPersistedChannels(): PaymentChannel[] {
  return loadPersistedChannels();
}

export interface ChannelPreferences {
  autoTopUp: boolean;
  autoTopUpAmount: number | null;
}

export interface WatchtowerRecord {
  address: string;
  bounty: number;
  registeredAt: string;
}

export async function getChannelPreferences(): Promise<ChannelPreferences> {
  const res = await fetch(`${API_BASE}/api/payment-channels/preferences`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch channel preferences');
  return res.json();
}

export async function updateChannelPreferences(
  prefs: Partial<ChannelPreferences>,
): Promise<ChannelPreferences> {
  const res = await fetch(`${API_BASE}/api/payment-channels/preferences`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error('Failed to update channel preferences');
  return res.json();
}

export async function getWatchtowers(channelId: string): Promise<WatchtowerRecord[]> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/watchtowers`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch watchtowers');
  const payload = await res.json() as { watchtowers: WatchtowerRecord[] };
  return payload.watchtowers ?? [];
}

export async function grantWatchtowerAuthority(
  channelId: string,
  watchtower: string,
  bounty = 0,
): Promise<WatchtowerRecord[]> {
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/watchtowers`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watchtower, bounty }),
  });
  if (!res.ok) throw new Error('Failed to grant authority');
  const payload = await res.json() as { watchtowers: WatchtowerRecord[] };
  return payload.watchtowers ?? [];
}

export async function revokeWatchtowerAuthority(
  channelId: string,
  watchtower: string,
): Promise<WatchtowerRecord[]> {
  const encoded = encodeURIComponent(watchtower);
  const res = await fetch(`${API_BASE}/api/payment-channels/${channelId}/watchtowers/${encoded}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to revoke authority');
  const payload = await res.json() as { watchtowers: WatchtowerRecord[] };
  return payload.watchtowers ?? [];
}
