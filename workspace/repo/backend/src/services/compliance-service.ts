import { supabase } from '../config/database';
import logger from '../config/logger';
import { executeGdprDeletionPipeline } from './gdpr-deletion-pipeline';

/**
 * V3 Compliance Posture
 *
 * SYNCRO v3 is a non-custodial system. At any moment SYNCRO ideally
 * custody nothing — funds move through pre-authorized payment channels
 * and machine payers (agent bots) execute renewals within strict
 * spend limits and time windows (see ADR-005).
 *
 * Implications:
 * - No KYC/AML burden for crypto-only operations (no consumer funds
 *   pass through SYNCRO's own accounts).
 * - If a provider enables a fiat on-ramp (taking fiat currency into
 *   the system), the compliance answer changes substantially — KYC/AML
 *   verification becomes required at that threshold.
 * - GDPR data-export and right-to-erasure obligations still apply
 *   because the system holds personal data (profiles, preferences,
 *   audit logs), even though it holds no funds.
 */

export interface UserExportData {
  profile: any;
  notifications: any[];
  auditLogs: any[];
  preferences: any;
  emailAccounts: any[];
  teams: any[];
}

export interface ProviderVerificationStatus {
  /** True when the provider has completed KYC/AML verification. */
  verified: boolean;
  /** True when the provider accepts fiat on-ramp payments. */
  fiatEnabled: boolean;
  /**
   * Whether verification is required for this provider.
   * Verification is required whenever fiat on-ramp is enabled,
   * because taking fiat introduces KYC/AML obligations.
   */
  verificationRequired: boolean;
}

interface DeletionRequestResult {
  user_id: string;
  status: string;
  scheduled_deletion_at: string;
  reason?: string;
}

export class ComplianceService {
  async gatherUserData(userId: string): Promise<UserExportData> {
    const [
      profileResult,
      notificationsResult,
      auditLogsResult,
      preferencesResult,
      emailAccountsResult,
      teamsResult,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('notifications').select('*').eq('user_id', userId),
      supabase.from('audit_logs').select('*').eq('user_id', userId),
      supabase.from('user_preferences').select('*').eq('user_id', userId).single(),
      supabase.from('email_accounts').select('*').eq('user_id', userId),
      supabase.from('team_members').select('*').eq('user_id', userId),
    ]);

    return {
      profile: profileResult.data || {},
      notifications: notificationsResult.data || [],
      auditLogs: auditLogsResult.data || [],
      preferences: preferencesResult.data || {},
      emailAccounts: emailAccountsResult.data || [],
      teams: teamsResult.data || [],
    };
  }

  async requestDeletion(userId: string, reason?: string): Promise<DeletionRequestResult> {
    const { data: existing, error: checkError } = await supabase
      .from('account_deletions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['pending'])
      .single();

    if (existing && !checkError) {
      throw new Error('Account deletion already pending');
    }

    const now = new Date();
    const scheduledDeletionAt = new Date(now);
    scheduledDeletionAt.setDate(scheduledDeletionAt.getDate() + 30);

    const { data: cancelledRow } = await supabase
      .from('account_deletions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .single();

    let deletionRecord: DeletionRequestResult;

    if (cancelledRow) {
      const { data, error } = await supabase
        .from('account_deletions')
        .update({
          status: 'pending',
          requested_at: now.toISOString(),
          scheduled_deletion_at: scheduledDeletionAt.toISOString(),
          cancelled_at: null,
          completed_at: null,
          reason: reason || null,
        })
        .eq('id', cancelledRow.id)
        .select()
        .single();

      if (error) throw new Error(`Failed to request deletion: ${error.message}`);
      deletionRecord = data as DeletionRequestResult;
    } else {
      const insertData = {
        user_id: userId,
        status: 'pending',
        requested_at: now.toISOString(),
        scheduled_deletion_at: scheduledDeletionAt.toISOString(),
        reason: reason || null,
      };

      const { data, error } = await supabase
        .from('account_deletions')
        .insert(insertData)
        .select()
        .single();

      if (error) throw new Error(`Failed to request deletion: ${error.message}`);
      deletionRecord = data as DeletionRequestResult;
    }

    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'account_deletion_requested',
      resource_type: 'account',
      resource_id: userId,
      metadata: { scheduled_deletion_at: scheduledDeletionAt.toISOString(), reason },
    });

    logger.info('Account deletion requested', { scheduledAt: scheduledDeletionAt.toISOString() });

    return deletionRecord;
  }

  async cancelDeletion(userId: string): Promise<any> {
    const { data, error } = await supabase
      .from('account_deletions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) throw new Error(`Failed to cancel deletion: ${error.message}`);

    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'account_deletion_cancelled',
      resource_type: 'account',
      resource_id: userId,
    });

    logger.info('Account deletion cancelled');
    return data;
  }

  async getDeletionStatus(userId: string): Promise<any | null> {
    const { data } = await supabase
      .from('account_deletions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .single();

    return data || null;
  }

  async processHardDeleteForUser(userId: string, deletionId: string): Promise<number> {
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
      logger.error('Failed to delete auth user', { error: deleteError.message });
      return 0;
    }

    await supabase
      .from('account_deletions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', deletionId);

    logger.info('Hard delete completed');
    return 1;
  }

  async processHardDeletes(): Promise<number> {
    const now = new Date().toISOString();

    const { data: pendingDeletions, error } = await supabase
      .from('account_deletions')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_deletion_at', now);

    if (error || !pendingDeletions || pendingDeletions.length === 0) {
      return 0;
    }

    let processed = 0;

    for (const deletion of pendingDeletions) {
      try {
        const pipelineResult = await executeGdprDeletionPipeline(
          deletion.user_id,
          deletion.id,
        );

        if (!pipelineResult.success) {
          logger.error('GDPR pipeline failed', { error: pipelineResult.error });
          continue;
        }

        const count = await this.processHardDeleteForUser(deletion.user_id, deletion.id);
        processed += count;
      } catch (err) {
        logger.error('Error processing hard delete', err);
      }
    }

    return processed;
  }

  /**
   * Determine whether a provider needs KYC/AML verification.
   *
   * For v3's non-custodial posture:
   * - Crypto-only payouts (no fiat on-ramp): verification NOT required.
   * - Fiat on-ramp enabled: verification IS required, because taking
   *   fiat currency introduces KYC/AML obligations that do not apply
   *   to purely on-chain transfers.
   *
   * The threshold is binary: fiat enabled → verification required.
   */
  async verifyProviderPayoutStatus(userId: string): Promise<ProviderVerificationStatus> {
    const { data: provider } = await supabase
      .from('providers')
      .select('fiat_on_ramp, verification_status')
      .eq('user_id', userId)
      .maybeSingle();

    const fiatEnabled = !!(provider?.fiat_on_ramp ?? false);
    const verified = provider?.verification_status === 'verified';

    return {
      verified,
      fiatEnabled,
      verificationRequired: fiatEnabled && !verified,
    };
  }
}

export const complianceService = new ComplianceService();
