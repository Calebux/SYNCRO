'use client';

import { useEffect, useState } from 'react';

interface TeamSubscription {
  tool: string;
  count: number;
  costPerMonth?: number;
  totalMonthly?: number;
}

interface TeamPrivacyViewProps {
  teamId: string;
  teamName?: string;
  isAdmin?: boolean;
  onOptInChange?: (subscriptionId: string, optedIn: boolean) => Promise<void>;
}

export function TeamPrivacyView({
  teamId,
  teamName = 'Your Team',
  isAdmin = false,
  onOptInChange,
}: TeamPrivacyViewProps) {
  const [aggregatedData, setAggregatedData] = useState<TeamSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalMonthlyCost, setTotalMonthlyCost] = useState(0);
  const [memberCount, setMemberCount] = useState(0);

  useEffect(() => {
    const fetchAggregatedTeamData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `/api/teams/${teamId}/subscriptions/aggregated`,
          {
            credentials: 'include',
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch team subscription data');
        }

        const data = await response.json();
        
        setAggregatedData(data.subscriptions || []);
        setTotalMonthlyCost(data.totalMonthly || 0);
        setMemberCount(data.memberCount || 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load team data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAggregatedTeamData();
  }, [teamId]);

  if (isLoading) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border border-gray-300 border-t-indigo-600" />
        <p className="mt-4 text-sm text-gray-600">Loading team data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Team</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">{teamName}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Members</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">{memberCount}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">
              Team Monthly Cost
            </p>
            <p className="text-2xl font-bold text-gray-900 mt-2">
              ${totalMonthlyCost.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Privacy Notice */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
        <p className="text-sm text-indigo-900">
          <strong>Privacy-First Approach:</strong> This view shows only aggregated team
          data. Individual member subscriptions remain private unless they opt-in to
          share. Admins cannot see which members have which subscriptions.
        </p>
      </div>

      {/* Aggregated Subscriptions */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            Team Subscriptions Overview
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Shows which tools are used by your team (aggregated counts)
          </p>
        </div>

        {aggregatedData.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-gray-500">
              No team subscriptions yet. Members can add subscriptions and opt-in to share.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tool
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Members Using
                  </th>
                  {isAdmin && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Est. Monthly Cost
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {aggregatedData.map((subscription) => (
                  <tr
                    key={subscription.tool}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900">
                        {subscription.tool}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-800">
                        {subscription.count} {subscription.count === 1 ? 'member' : 'members'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${subscription.totalMonthly?.toFixed(2) || '0.00'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Opt-in Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          <strong>Want to share your subscriptions with the team?</strong> Members can
          choose to reveal specific subscriptions by opt-ing in within their privacy
          settings.
        </p>
      </div>
    </div>
  );
}
