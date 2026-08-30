/**
 * Offline cache utilities.
 *
 * Persists a lightweight snapshot of subscription data to IndexedDB and localStorage
 * so the offline page can display real data without a network connection.
 */

export interface OfflineSubscription {
  id: string
  name: string
  status: string
  billing_cycle: string
  next_renewal: string | null
  price: number
  category: string | null
  updated_at?: string
}

const STORAGE_KEY = 'syncro_offline_subscriptions';
const TIMESTAMP_KEY = 'syncro_offline_subscriptions_ts';

// Legacy localStorage functions - kept for backward compatibility
export function saveSubscriptionsOffline(subs: OfflineSubscription[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
    localStorage.setItem(TIMESTAMP_KEY, new Date().toISOString());
  } catch {
    // Storage quota exceeded or private browsing — silently ignore
  }
}

export function loadOfflineSubscriptions(): OfflineSubscription[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OfflineSubscription[];
  } catch {
    return [];
  }
}

export function getOfflineCacheTimestamp(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TIMESTAMP_KEY);
}

export function clearOfflineCache(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TIMESTAMP_KEY);
}

// IndexedDB-based offline caching
export async function initIndexedDB(): Promise<void> {
  const { initIndexedDB } = await import('./indexed-db');
  await initIndexedDB();
}

export async function cacheSubscriptions(subscriptions: OfflineSubscription[]): Promise<void> {
  const { cacheSubscriptions } = await import('./indexed-db');
  await cacheSubscriptions(subscriptions);
  // Also update localStorage for backward compatibility
  saveSubscriptionsOffline(subscriptions);
}

export async function getCachedSubscriptions(): Promise<OfflineSubscription[]> {
  const { getCachedSubscriptions } = await import('./indexed-db');
  try {
    const subs = await getCachedSubscriptions();
    return subs.length > 0 ? subs : loadOfflineSubscriptions();
  } catch {
    return loadOfflineSubscriptions();
  }
}

export async function addOfflineMutation(
  type: "create" | "update" | "delete",
  payload: Record<string, unknown>
): Promise<void> {
  const { addOfflineMutation } = await import('./indexed-db');
  await addOfflineMutation(type, payload);
}

export async function getOfflineMutations(): Promise<any[]> {
  const { getOfflineMutations } = await import('./indexed-db');
  return getOfflineMutations();
}