'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiPost, apiDelete, apiGet } from '@/lib/api';

export type PushPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface UsePushNotificationsResult {
  /** Whether the browser supports push notifications */
  isSupported: boolean;
  /** Current browser permission state */
  permission: PushPermissionState;
  /** Whether the user currently has an active subscription saved in the DB */
  isSubscribed: boolean;
  /** True while any async operation is in progress */
  isLoading: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Request permission and register the subscription */
  subscribe: () => Promise<boolean>;
  /** Unsubscribe and remove from the database */
  unsubscribe: () => Promise<boolean>;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function usePushNotifications(): UsePushNotificationsResult {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<PushPermissionState>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialise support + permission + subscription status
  useEffect(() => {
    const init = async () => {
      if (
        typeof window === 'undefined' ||
        !('Notification' in window) ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        setIsSupported(false);
        setIsLoading(false);
        return;
      }

      setIsSupported(true);
      setPermission(Notification.permission as PushPermissionState);

      try {
        const statusData = await apiGet('/api/notifications/push/status');
        setIsSubscribed(statusData?.data?.subscribed ?? false);
      } catch {
        // Not critical — user may not be logged in yet
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Push notifications are not supported in this browser.');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      let vapidKey = VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        try {
          const keyData = await apiGet('/api/notifications/push/vapid-public-key');
          if (keyData?.data?.publicKey) {
            vapidKey = keyData.data.publicKey;
          }
        } catch (e) {
          console.error("Failed to fetch VAPID key from backend:", e);
        }
      }

      if (!vapidKey) {
        setError('Push notification configuration is missing (VAPID key).');
        setIsLoading(false);
        return false;
      }

      // 1. Request notification permission
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult as PushPermissionState);

      if (permissionResult !== 'granted') {
        setError('Notification permission was denied.');
        return false;
      }

      // 2. Register (or retrieve) the service worker
      const registration = await navigator.serviceWorker.ready;

      // 3. Subscribe with the VAPID public key
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });

      const json = subscription.toJSON();

      // 4. Persist to backend
      await apiPost('/api/notifications/push/subscribe', {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        userAgent: navigator.userAgent,
      });

      setIsSubscribed(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enable push notifications.';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    setIsLoading(true);
    setError(null);

    try {
      // Remove from browser
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        // Remove from backend
        await apiDelete('/api/notifications/push/unsubscribe', { endpoint });
      } else {
        // No browser subscription — still clean up any DB record
        await apiDelete('/api/notifications/push/unsubscribe', {});
      }

      setIsSubscribed(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disable push notifications.';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  return { isSupported, permission, isSubscribed, isLoading, error, subscribe, unsubscribe };
}