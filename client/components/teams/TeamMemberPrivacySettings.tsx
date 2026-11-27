'use client';

import { useState, useEffect } from 'react';

interface TeamMemberSubscription {
  id: string;
  name: string;
  category: string;
  cost: number;
  optedInToTeamShare: boolean;
}

interface TeamMemberPrivacySettingsProps {
  teamId: string;
  memberId?: string;
  onSubscriptionUpdate?: (subscriptionId: string, optedIn: boolean) => Promise<void>;
}

export function TeamMemberPrivacySettings({
  teamId,
  memberId,
  onSubscriptionUpdate,
}: TeamMemberPrivacySettingsProps) {
  const [subscriptions, setSubscriptions] = useState<TeamMemberSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchSubscriptions = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const endpoint = memberId
          ? `/api/teams/${teamId}/members/${memberId}/subscriptions`
          : `/api/teams/${teamId}/my-subscriptions`;

        const response = await fetch(endpoint, {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to fetch subscriptions');
        }

        const data = await response.json();
        setSubscriptions(data.subscriptions || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load subscriptions');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSubscriptions();
  }, [teamId, memberId]);

  const handleToggleOptIn = async (subscriptionId: string, currentState: boolean) => {
    setUpdatingId(subscriptionId);
    try {
      if (onSubscriptionUpdate) {
        await onSubscriptionUpdate(subscriptionId, !currentState);
      }

      setSubscriptions((prev) =>
        prev.map((sub) =>
          sub.id === subscriptionId
            ? { ...sub, optedInToTeamShare: !currentState }
            : sub
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subscription');
    } finally {
      setUpdatingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border border-gray-300 border-t-indigo-600" />
        <p className="mt-4 text-sm text-gray-600">Loading your subscriptions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          <strong>Share with Team:</strong> Toggle subscriptions to share with your team.
          Team admins will see aggregate data only — they won't know which member has
          which subscription.
        </p>
      </div>

      {subscriptions.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500">You haven't added any subscriptions yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {subscriptions.map((subscription) => (
            <div
              key={subscription.id}
              className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1">
                <h4 className="text-sm font-medium text-gray-900">
                  {subscription.name}
                </h4>
                <div className="flex gap-3 mt-1">
                  <span className="text-xs text-gray-500">{subscription.category}</span>
                  <span className="text-xs text-gray-500 font-medium">
                    ${subscription.cost.toFixed(2)}/mo
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-medium px-2 py-1 rounded ${
                    subscription.optedInToTeamShare
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {subscription.optedInToTeamShare ? 'Shared' : 'Private'}
                </span>

                <button
                  onClick={() =>
                    handleToggleOptIn(
                      subscription.id,
                      subscription.optedInToTeamShare
                    )
                  }
                  disabled={updatingId === subscription.id}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    subscription.optedInToTeamShare
                      ? 'bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50'
                      : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50'
                  }`}
                >
                  {updatingId === subscription.id
                    ? 'Updating...'
                    : subscription.optedInToTeamShare
                      ? 'Make Private'
                      : 'Share'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
