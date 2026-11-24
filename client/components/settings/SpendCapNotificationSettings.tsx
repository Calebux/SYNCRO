'use client';

import { useEffect, useState } from 'react';
import { fetchUserPreferences, updateUserPreferences } from '@/lib/api/user-preferences';

type SpendCapChannel = 'email' | 'telegram';

export default function SpendCapNotificationSettings() {
  const [channels, setChannels] = useState<SpendCapChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetchUserPreferences()
      .then((preferences) => {
        if (active) setChannels(preferences.spend_cap_alert_channels ?? []);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load notification preferences.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function save(next: SpendCapChannel[]) {
    setChannels(next);
    setSaving(true);
    setMessage('');
    setError('');
    try {
      await updateUserPreferences({ spend_cap_alert_channels: next });
      setMessage('Spend-cap notification preferences saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save notification preferences.');
      try {
        const latest = await fetchUserPreferences();
        setChannels(latest.spend_cap_alert_channels ?? []);
      } catch (reloadError) {
        setError(`${saveError instanceof Error ? saveError.message : 'Unable to save notification preferences.'} Preferences could not be reloaded.`);
      }
    } finally {
      setSaving(false);
    }
  }

  function toggle(channel: SpendCapChannel, enabled: boolean) {
    const next = enabled
      ? [...channels, channel]
      : channels.filter((selected) => selected !== channel);
    void save(next);
  }

  return (
    <section aria-labelledby="spend-cap-notifications-heading" className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <h2 id="spend-cap-notifications-heading" className="text-lg font-semibold">Spend-cap alerts</h2>
      <p className="mt-1 text-sm text-gray-600">
        Choose where to receive a notification when an agent reaches 80% or 100% of its current cap.
      </p>
      <fieldset disabled={loading || saving} className="mt-4 space-y-3">
        <legend className="sr-only">Spend-cap notification channels</legend>
        {(['email', 'telegram'] as const).map((channel) => (
          <label key={channel} className="flex w-fit items-center gap-3 text-sm font-medium capitalize text-gray-900">
            <input
              type="checkbox"
              checked={channels.includes(channel)}
              onChange={(event) => toggle(channel, event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600"
            />
            {channel}
          </label>
        ))}
      </fieldset>
      {loading && <p className="mt-3 text-sm text-gray-500">Loading preferences…</p>}
      {saving && <p className="mt-3 text-sm text-gray-500">Saving preferences…</p>}
      {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      {channels.includes('telegram') && <p className="mt-3 text-xs text-gray-500">Telegram alerts require a connected Telegram account.</p>}
    </section>
  );
}
