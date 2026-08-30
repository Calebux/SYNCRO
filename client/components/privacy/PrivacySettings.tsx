'use client';

import { useCallback, useState } from 'react';

interface PrivacyPreferences {
  stealthAddressesEnabled: boolean;
  encryptionEnabled: boolean;
  paymentChannelsEnabled: boolean;
  privateAuditLogsEnabled: boolean;
  privacyModeEnabled: boolean;
  preferredGiftCardProvider: string;
  reminderJitterLevel: 'off' | 'low' | 'medium' | 'high';
}

interface PrivacySettingsProps {
  initialPreferences?: Partial<PrivacyPreferences>;
  onUpdate?: (preferences: Partial<PrivacyPreferences>) => Promise<void>;
}

export function PrivacySettings({ initialPreferences, onUpdate }: PrivacySettingsProps) {
  const [preferences, setPreferences] = useState<PrivacyPreferences>({
    stealthAddressesEnabled: false,
    encryptionEnabled: false,
    paymentChannelsEnabled: false,
    privateAuditLogsEnabled: false,
    privacyModeEnabled: false,
    preferredGiftCardProvider: 'paypal',
    reminderJitterLevel: 'off',
    ...initialPreferences,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = useCallback(
    async (key: keyof PrivacyPreferences, value: any) => {
      setError(null);
      const updated = { ...preferences, [key]: value };
      setPreferences(updated);

      if (onUpdate) {
        setIsLoading(true);
        try {
          await onUpdate({ [key]: value });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to update settings');
          setPreferences(preferences);
        } finally {
          setIsLoading(false);
        }
      }
    },
    [preferences, onUpdate]
  );

  const calculatePrivacyScore = () => {
    let score = 0;
    const maxScore = 5;

    if (preferences.privacyModeEnabled) score++;
    if (preferences.stealthAddressesEnabled) score++;
    if (preferences.encryptionEnabled) score++;
    if (preferences.paymentChannelsEnabled) score++;
    if (preferences.privateAuditLogsEnabled) score++;

    return { current: score, max: maxScore };
  };

  const privacyScore = calculatePrivacyScore();
  const privacyPercentage = Math.round((privacyScore.current / privacyScore.max) * 100);

  return (
    <div className="space-y-6">
      {/* Privacy Score Card */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Your Privacy Level</h3>
            <p className="text-xs text-gray-600 mt-1">Based on enabled features</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-indigo-600">
              {privacyPercentage}%
            </div>
            <div className="w-32 h-2 bg-gray-200 rounded-full mt-2">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${privacyPercentage}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Features List */}
      <div className="space-y-3">
        {[
          {
            key: 'stealthAddressesEnabled' as const,
            label: 'Stealth Addresses',
            description: 'Generate unique addresses for each subscription to prevent linking',
          },
          {
            key: 'encryptionEnabled' as const,
            label: 'On-chain Encryption',
            description: 'Encrypt subscription metadata before storing on blockchain',
          },
          {
            key: 'paymentChannelsEnabled' as const,
            label: 'Payment Channels',
            description: 'Use off-chain payment channels for maximum privacy',
          },
          {
            key: 'privateAuditLogsEnabled' as const,
            label: 'Private Audit Logs',
            description: 'Store audit logs with cryptographic commitments',
          },
        ].map(({ key, label, description }) => (
          <label
            key={key}
            className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <input
              type="checkbox"
              checked={preferences[key]}
              onChange={(e) => handleToggle(key, e.target.checked)}
              disabled={isLoading}
              className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">{label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{description}</div>
            </div>
          </label>
        ))}
      </div>

      {/* Gift Card Provider Selection */}
      <div className="border border-gray-200 rounded-lg p-4">
        <label htmlFor="gift-provider" className="text-sm font-medium text-gray-900">
          Preferred Gift Card Provider
        </label>
        <p className="text-xs text-gray-500 mt-1 mb-3">
          Default provider for redeeming subscription gift cards
        </p>
        <select
          id="gift-provider"
          value={preferences.preferredGiftCardProvider}
          onChange={(e) => handleToggle('preferredGiftCardProvider', e.target.value)}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="paypal">PayPal</option>
          <option value="stripe">Stripe</option>
          <option value="square">Square</option>
        </select>
      </div>
    </div>
  );
}
