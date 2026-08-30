'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface DuplicateCandidate {
  subscription_id: string;
  duplicate_id: string;
  confidence: number;
  match_reasons: string[];
  subscription: Record<string, any>;
  duplicate: Record<string, any>;
}

interface Props {
  authToken?: string;
}

async function apiFetch(path: string, authToken?: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(path, { ...options, headers: { ...headers, ...options?.headers }, credentials: 'include' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

function MatchReasonBadge({ reason }: { reason: string }) {
  const labelMap: Record<string, string> = {
    same_name: 'Same name',
    same_amount: 'Same amount',
    same_cycle: 'Same billing cycle',
  };
  const label = labelMap[reason] ?? reason;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '12px',
        backgroundColor: '#dbeafe',
        color: '#1d4ed8',
        fontSize: '12px',
        fontWeight: 600,
        marginRight: '6px',
        marginBottom: '4px',
      }}
    >
      {label}
    </span>
  );
}

function SubscriptionInfo({ sub }: { sub: Record<string, any> }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px' }}>{sub.name}</div>
      <div style={{ color: '#374151', fontSize: '14px' }}>
        {sub.currency ?? ''} {Number(sub.price ?? 0).toFixed(2)} / {sub.billing_cycle}
      </div>
      {sub.category && (
        <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '2px' }}>{sub.category}</div>
      )}
    </div>
  );
}

export function DuplicateSubscriptionReview({ authToken }: Props) {
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState<string | null>(null);

  const fetchDuplicates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/subscriptions/duplicates', authToken);
      setDuplicates(data.duplicates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load duplicates');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    fetchDuplicates();
  }, [fetchDuplicates]);

  const handleMerge = async (keepId: string, mergeId: string, pairKey: string) => {
    setMerging(pairKey);
    try {
      await apiFetch('/api/subscriptions/duplicates/merge', authToken, {
        method: 'POST',
        body: JSON.stringify({ keepId, mergeId }),
      });
      await fetchDuplicates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge subscriptions');
    } finally {
      setMerging(null);
    }
  };

  const handleDismiss = (pairKey: string) => {
    setDismissedPairs((prev) => new Set([...prev, pairKey]));
  };

  const visibleDuplicates = duplicates.filter((d) => {
    const pairKey = `${d.subscription_id}:${d.duplicate_id}`;
    return !dismissedPairs.has(pairKey);
  });

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
        Checking for duplicate subscriptions...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: '#dc2626', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5' }}>
        {error}
      </div>
    );
  }

  if (visibleDuplicates.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
        No duplicate subscriptions found.
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>
        Potential Duplicate Subscriptions ({visibleDuplicates.length})
      </h2>

      {visibleDuplicates.map((candidate) => {
        const pairKey = `${candidate.subscription_id}:${candidate.duplicate_id}`;
        const isMerging = merging === pairKey;

        return (
          <div
            key={pairKey}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '16px',
              backgroundColor: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            {/* Confidence header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                {candidate.match_reasons.map((r) => (
                  <MatchReasonBadge key={r} reason={r} />
                ))}
              </div>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '14px',
                  color: candidate.confidence >= 90 ? '#dc2626' : candidate.confidence >= 75 ? '#d97706' : '#2563eb',
                }}
              >
                {candidate.confidence}% match
              </span>
            </div>

            {/* Subscription pair */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '16px' }}>
              <SubscriptionInfo sub={candidate.subscription} />

              <div style={{ color: '#9ca3af', fontSize: '20px', alignSelf: 'center' }}>vs</div>

              <SubscriptionInfo sub={candidate.duplicate} />
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleMerge(candidate.subscription_id, candidate.duplicate_id, pairKey)}
                disabled={isMerging}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: isMerging ? 'not-allowed' : 'pointer',
                  opacity: isMerging ? 0.6 : 1,
                  fontSize: '13px',
                }}
              >
                Keep Left
              </button>

              <button
                onClick={() => handleMerge(candidate.duplicate_id, candidate.subscription_id, pairKey)}
                disabled={isMerging}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#7c3aed',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: isMerging ? 'not-allowed' : 'pointer',
                  opacity: isMerging ? 0.6 : 1,
                  fontSize: '13px',
                }}
              >
                Keep Right
              </button>

              <button
                onClick={() => handleDismiss(pairKey)}
                disabled={isMerging}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  backgroundColor: '#fff',
                  color: '#374151',
                  fontWeight: 600,
                  cursor: isMerging ? 'not-allowed' : 'pointer',
                  opacity: isMerging ? 0.6 : 1,
                  fontSize: '13px',
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default DuplicateSubscriptionReview;
