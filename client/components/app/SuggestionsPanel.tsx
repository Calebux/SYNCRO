'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '@/lib/api';

type SuggestionType =
  | 'switch_to_annual'
  | 'unused_subscription'
  | 'duplicate_service'
  | 'plan_downgrade'
  | 'suggest_cheaper_alternatives';

interface Suggestion {
  id: string;
  type: SuggestionType;
  subscriptionId: string;
  subscriptionName: string;
  message: string;
  savingsPerYear?: number;
}

export function SuggestionsPanel() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet('/api/suggestions');
      setSuggestions(data.suggestions ?? []);
    } catch {
      // Non-fatal — panel simply stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDismiss = async (suggestion: Suggestion) => {
    setDismissing(suggestion.id);
    try {
      await apiPost('/api/suggestions/dismiss', {
        subscriptionId: suggestion.subscriptionId,
        suggestionType: suggestion.type,
      });
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
    } catch {
      // ignore
    } finally {
      setDismissing(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[1, 2].map((i) => <div key={i} className="h-16 bg-gray-100 rounded" />)}
        </div>
      </div>
    );
  }

  if (suggestions.length === 0) return null;

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">
        💡 Money-saving opportunities
      </h2>

      <ul className="space-y-3">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="flex items-start justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800">{s.message}</p>
              {s.savingsPerYear !== undefined && (
                <p className="text-xs text-green-600 font-medium mt-0.5">
                  Save ${s.savingsPerYear.toFixed(2)}/year
                </p>
              )}
            </div>
            <button
              onClick={() => handleDismiss(s)}
              disabled={dismissing === s.id}
              className="shrink-0 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
              aria-label={`Dismiss suggestion for ${s.subscriptionName}`}
            >
              {dismissing === s.id ? '…' : 'Dismiss'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
