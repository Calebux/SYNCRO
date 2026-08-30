const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const CHANNEL_STORAGE_KEY = 'syncro_payment_channels';

export interface PaymentChannel {
  id: string;
  counterparty: string;
  balance: string;
  state: 'active' | 'closing' | 'closed' | 'dispute';
  lastUpdated: string;
  expiry?: string;
  history?: ChannelHistoryItem[];
}

export interface ChannelHistoryItem {
  id: string;
  type: 'open' | 'topup' | 'payment' | 'close' | 'dispute';
  amount?: string;
  timestamp: string;
  description?: string;
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
