'use client';

import { usePushNotifications } from '@/hooks/use-push-notifications';

interface PushNotificationToggleProps {
  darkMode?: boolean;
}

export function PushNotificationToggle({ darkMode }: PushNotificationToggleProps) {
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    error,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  if (!isSupported) {
    return (
      <div
        className={`flex items-start gap-3 p-3 rounded-lg ${
          darkMode ? 'bg-gray-800' : 'bg-gray-50'
        }`}
      >
        <span className="text-2xl mt-0.5">🔕</span>
        <div>
          <p className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Push notifications
          </p>
          <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            Not supported in this browser
          </p>
        </div>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div
        className={`flex items-start gap-3 p-3 rounded-lg border ${
          darkMode
            ? 'bg-[#E86A33]/10 border-[#E86A33]/30'
            : 'bg-orange-50 border-orange-200'
        }`}
      >
        <span className="text-2xl mt-0.5">⚠️</span>
        <div>
          <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Push notifications blocked
          </p>
          <p className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            To enable, update your browser settings and allow notifications for this site.
          </p>
        </div>
      </div>
    );
  }

  const handleToggle = () => {
    if (isSubscribed) {
      unsubscribe();
    } else {
      subscribe();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          type="button"
          role="switch"
          aria-checked={isSubscribed}
          disabled={isLoading}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD166] disabled:opacity-50 disabled:cursor-not-allowed ${
            isSubscribed ? 'bg-[#007A5C]' : darkMode ? 'bg-gray-700' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              isSubscribed ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <div>
          <p className={`text-sm ${darkMode ? 'text-white' : 'text-gray-700'}`}>
            Push notification reminders
          </p>
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {isLoading
              ? 'Updating…'
              : isSubscribed
              ? 'You will receive renewal reminders on this device'
              : 'Enable to get renewal reminders even when the tab is closed'}
          </p>
        </div>
      </label>

      {error && (
        <p className={`text-xs ml-14 ${darkMode ? 'text-[#E86A33]' : 'text-red-600'}`}>
          {error}
        </p>
      )}
    </div>
  );
}