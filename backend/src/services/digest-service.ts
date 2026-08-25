import { supabase } from '../config/database';
import logger from '../config/logger';
import { buildMonthlySummary, buildMonthlySummaries } from "./monthly-summary";
import { digestEmailService, type DigestSendRequest } from './digest-email-service';
import type { UserDigestPreferences } from '../types/digest';

/** Columns needed to build a `UserDigestPreferences`. */
const PREFERENCE_COLUMNS = 'user_id, digest_enabled, digest_day, include_year_to_date, updated_at';

interface PreferenceRow {
  user_id?:              string;
  digest_enabled?:       boolean | null;
  digest_day?:           number | null;
  include_year_to_date?: boolean | null;
  updated_at?:           string | null;
}

function defaultPreferences(userId: string): UserDigestPreferences {
  return {
    userId,
    digestEnabled:     false,
    digestDay:         1,
    includeYearToDate: true,
    updatedAt:         new Date().toISOString(),
  };
}

function toPreferences(userId: string, row: PreferenceRow): UserDigestPreferences {
  return {
    userId,
    digestEnabled:     row.digest_enabled       ?? false,
    digestDay:         row.digest_day           ?? 1,
    includeYearToDate: row.include_year_to_date ?? true,
    updatedAt:         row.updated_at           ?? new Date().toISOString(),
  };
}

export class DigestService {

  // ─── Preferences ──────────────────────────────────────────────────────────

  async getDigestPreferences(userId: string): Promise<UserDigestPreferences> {
    const { data, error } = await supabase
      .from('user_preferences')
      .select(PREFERENCE_COLUMNS)
      .eq('user_id', userId)
      .single();

    if (error || !data) return defaultPreferences(userId);

    return toPreferences(userId, data as PreferenceRow);
  }

  async updateDigestPreferences(
    userId: string,
    updates: Partial<Omit<UserDigestPreferences, 'userId' | 'updatedAt'>>,
  ): Promise<UserDigestPreferences> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.digestEnabled     !== undefined) dbUpdates.digest_enabled      = updates.digestEnabled;
    if (updates.digestDay         !== undefined) dbUpdates.digest_day           = updates.digestDay;
    if (updates.includeYearToDate !== undefined) dbUpdates.include_year_to_date = updates.includeYearToDate;

    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, ...dbUpdates });

    if (error) {
      logger.error('Failed to update digest preferences:', error);
      throw error;
    }

    return this.getDigestPreferences(userId);
  }

  // ─── Single user dispatch ──────────────────────────────────────────────────

  async sendDigestForUser(
    userId: string,
    digestType: 'monthly' | 'test' = 'monthly',
  ): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
    try {
      const prefs = await this.getDigestPreferences(userId);

      if (digestType === 'monthly' && !prefs.digestEnabled) {
        logger.debug('Digest skipped — digest_enabled=false');
        return { success: true, skipped: true };
      }

      const summary = await buildMonthlySummary(userId);

      if (!summary.userEmail) {
        logger.warn('No email address found for user, skipping digest');
        return { success: false, error: 'No email address on file' };
      }

      return digestEmailService.sendMonthlyDigest(summary.userEmail, summary, digestType);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('sendDigestForUser failed', err);
      return { success: false, error: message };
    }
  }

  // ─── Batch run (called from cron) ─────────────────────────────────────────

  /**
   * Send the monthly digest to every user who has it enabled.
   *
   * Query cost per page of users used to be 4N + 1 — the page query, then for
   * each user a redundant preferences re-read, three summary lookups and one
   * audit insert. It is now a fixed 5 queries per page (issue #1095): the page
   * query, three batched summary lookups and one batched audit insert.
   */
  async runMonthlyDigest(): Promise<{
    total: number;
    sent: number;
    skipped: number;
    failed: number;
  }> {
    logger.info('Starting monthly digest run');

    const result = { total: 0, sent: 0, skipped: 0, failed: 0 };

    // Fetch all users who have digest enabled (handle via pagination to be safe)
    const PAGE = 200;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: prefs, error } = await supabase
        .from('user_preferences')
        .select(PREFERENCE_COLUMNS)
        .eq('digest_enabled', true)
        .range(offset, offset + PAGE - 1);

      if (error) {
        logger.error('Failed to fetch digest-enabled users:', error);
        break;
      }

      if (!prefs || prefs.length === 0) {
        hasMore = false;
        break;
      }

      result.total += prefs.length;

      // The page query already returned each user's preferences, so there is no
      // need to re-read them per user.
      const userIds = (prefs as PreferenceRow[])
        .map((row) => row.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      const summaries = await buildMonthlySummaries(userIds);

      const requests: DigestSendRequest[] = [];
      for (const userId of userIds) {
        const summary = summaries.get(userId);

        if (!summary?.userEmail) {
          logger.warn('No email address found for user, skipping digest');
          result.failed++;
          continue;
        }

        requests.push({ recipientEmail: summary.userEmail, summary, digestType: 'monthly' });
      }

      const outcomes = await digestEmailService.sendMonthlyDigestBatch(requests);
      for (const outcome of outcomes) {
        if (outcome.success) {
          result.sent++;
        } else {
          result.failed++;
        }
      }

      offset  += PAGE;
      hasMore  = prefs.length === PAGE;
    }

    logger.info('Monthly digest run complete', result);
    return result;
  }
}

export const digestService = new DigestService();