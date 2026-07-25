import { supabase } from '../config/database';
import logger from '../config/logger';

export interface DuplicateCandidate {
  subscription_id: string;
  duplicate_id: string;
  confidence: number; // 0-100
  match_reasons: string[]; // e.g., ['same_name', 'same_amount', 'same_cycle']
  subscription: Record<string, any>;
  duplicate: Record<string, any>;
}

export interface DedupThresholds {
  min_confidence: number; // default 70
  name_similarity_weight: number; // default 0.5
  amount_tolerance_pct: number; // default 0.05 (5%)
}

const DEFAULT_THRESHOLDS: DedupThresholds = {
  min_confidence: 70,
  name_similarity_weight: 0.5,
  amount_tolerance_pct: 0.05,
};

// Normalized Levenshtein distance (0=identical, 1=completely different)
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const m = a.length;
  const n = b.length;
  const dp: number[] = Array(n + 1).fill(0);

  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }

  const distance = dp[n];
  const maxLen = Math.max(m, n);
  return 1 - distance / maxLen;
}

// Normalize a subscription name for comparison (lowercase, remove punctuation/spaces)
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export const subscriptionDedupService = {
  // Find duplicate candidates for a user's subscriptions
  async findDuplicates(
    userId: string,
    thresholds?: Partial<DedupThresholds>,
  ): Promise<DuplicateCandidate[]> {
    const userThresholds = await subscriptionDedupService.getUserThresholds(userId);
    const merged: DedupThresholds = { ...userThresholds, ...thresholds };

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      logger.error('Error fetching subscriptions for dedup:', error);
      return [];
    }

    if (!subscriptions || subscriptions.length < 2) {
      return [];
    }

    const candidates: DuplicateCandidate[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < subscriptions.length; i++) {
      for (let j = i + 1; j < subscriptions.length; j++) {
        const a = subscriptions[i];
        const b = subscriptions[j];

        const pairKey = [a.id, b.id].sort().join(':');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const { confidence, reasons } = computeConfidence(a, b, merged);

        if (confidence >= merged.min_confidence) {
          candidates.push({
            subscription_id: a.id,
            duplicate_id: b.id,
            confidence,
            match_reasons: reasons,
            subscription: a,
            duplicate: b,
          });
        }
      }
    }

    candidates.sort((x, y) => y.confidence - x.confidence);
    return candidates;
  },

  // Merge two subscriptions: keep `keepId`, soft-delete `mergeId`, copy history
  async mergeSubscriptions(
    userId: string,
    keepId: string,
    mergeId: string,
  ): Promise<{ success: boolean }> {
    // Verify both subscriptions belong to userId
    const { data: subs, error: fetchError } = await supabase
      .from('subscriptions')
      .select('id, notes, tags')
      .eq('user_id', userId)
      .in('id', [keepId, mergeId]);

    if (fetchError || !subs || subs.length !== 2) {
      logger.error('mergeSubscriptions: could not find both subscriptions for user', {
        userId,
        keepId,
        mergeId,
        fetchError,
      });
      throw new Error('One or both subscriptions not found or not owned by user');
    }

    const keepSub = subs.find((s: any) => s.id === keepId);
    const mergeSub = subs.find((s: any) => s.id === mergeId);

    if (!keepSub || !mergeSub) {
      throw new Error('Could not identify keep/merge subscriptions');
    }

    // Merge notes (append)
    const mergedNotes = [keepSub.notes, mergeSub.notes]
      .filter(Boolean)
      .join('\n---\n') || null;

    // Merge tags (union)
    const keepTags: string[] = Array.isArray(keepSub.tags) ? keepSub.tags : [];
    const mergeTags: string[] = Array.isArray(mergeSub.tags) ? mergeSub.tags : [];
    const mergedTags = Array.from(new Set([...keepTags, ...mergeTags]));

    // Update keep subscription
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({ notes: mergedNotes, tags: mergedTags, updated_at: new Date().toISOString() })
      .eq('id', keepId)
      .eq('user_id', userId);

    if (updateError) {
      logger.error('mergeSubscriptions: failed to update keep subscription', updateError);
      throw new Error('Failed to update subscription during merge');
    }

    // Delete merge subscription
    const { error: deleteError } = await supabase
      .from('subscriptions')
      .delete()
      .eq('id', mergeId)
      .eq('user_id', userId);

    if (deleteError) {
      logger.error('mergeSubscriptions: failed to delete merge subscription', deleteError);
      throw new Error('Failed to delete merged subscription');
    }

    logger.info('mergeSubscriptions: merged successfully', { userId, keepId, mergeId });
    return { success: true };
  },

  // Check if a new subscription is a duplicate of existing ones (real-time detection)
  async checkForDuplicate(
    userId: string,
    name: string,
    amount: number,
    billingCycle: string,
  ): Promise<DuplicateCandidate | null> {
    const userThresholds = await subscriptionDedupService.getUserThresholds(userId);

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error || !subscriptions || subscriptions.length === 0) {
      return null;
    }

    // Synthetic object to compare against
    const newSub: Record<string, any> = {
      id: '__new__',
      name,
      price: amount,
      billing_cycle: billingCycle,
    };

    let best: DuplicateCandidate | null = null;

    for (const existing of subscriptions) {
      const { confidence, reasons } = computeConfidence(newSub, existing, userThresholds);
      if (confidence >= userThresholds.min_confidence) {
        if (!best || confidence > best.confidence) {
          best = {
            subscription_id: existing.id,
            duplicate_id: '__new__',
            confidence,
            match_reasons: reasons,
            subscription: existing,
            duplicate: newSub,
          };
        }
      }
    }

    return best;
  },

  // Get per-user thresholds from DB (or return defaults)
  async getUserThresholds(userId: string): Promise<DedupThresholds> {
    try {
      const { data, error } = await supabase
        .from('subscription_dedup_settings')
        .select('min_confidence, name_similarity_weight, amount_tolerance_pct')
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return { ...DEFAULT_THRESHOLDS };
      }

      return {
        min_confidence: data.min_confidence ?? DEFAULT_THRESHOLDS.min_confidence,
        name_similarity_weight:
          data.name_similarity_weight ?? DEFAULT_THRESHOLDS.name_similarity_weight,
        amount_tolerance_pct:
          data.amount_tolerance_pct ?? DEFAULT_THRESHOLDS.amount_tolerance_pct,
      };
    } catch {
      return { ...DEFAULT_THRESHOLDS };
    }
  },

  // Save per-user thresholds
  async saveUserThresholds(userId: string, thresholds: Partial<DedupThresholds>): Promise<void> {
    try {
      const { error } = await supabase
        .from('subscription_dedup_settings')
        .upsert(
          {
            user_id: userId,
            ...thresholds,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );

      if (error) {
        logger.warn('saveUserThresholds: upsert failed', error);
      }
    } catch (err) {
      logger.warn('saveUserThresholds: unexpected error', err);
    }
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeConfidence(
  a: Record<string, any>,
  b: Record<string, any>,
  thresholds: DedupThresholds,
): { confidence: number; reasons: string[] } {
  const reasons: string[] = [];

  // Name similarity (weighted)
  const nameSim = levenshteinSimilarity(normalizeName(a.name ?? ''), normalizeName(b.name ?? ''));
  const nameWeight = thresholds.name_similarity_weight; // 0-1, default 0.5
  let score = nameSim * nameWeight;
  if (nameSim > 0.85) {
    reasons.push('same_name');
  }

  // Amount similarity (remaining weight split 50/50 with cycle)
  const remainingWeight = 1 - nameWeight;
  const amountWeight = remainingWeight / 2;
  const cycleWeight = remainingWeight / 2;

  const aPrice = Number(a.price ?? 0);
  const bPrice = Number(b.price ?? 0);
  const maxPrice = Math.max(aPrice, bPrice);
  if (maxPrice > 0) {
    const diff = Math.abs(aPrice - bPrice) / maxPrice;
    if (diff <= thresholds.amount_tolerance_pct) {
      score += amountWeight;
      reasons.push('same_amount');
    }
  } else if (aPrice === 0 && bPrice === 0) {
    score += amountWeight;
    reasons.push('same_amount');
  }

  // Billing cycle exact match
  if (a.billing_cycle && b.billing_cycle && a.billing_cycle === b.billing_cycle) {
    score += cycleWeight;
    reasons.push('same_cycle');
  }

  const confidence = Math.round(score * 100);
  return { confidence, reasons };
}
