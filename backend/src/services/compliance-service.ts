import crypto from 'crypto';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { emailService } from './email-service';
import { executeGdprDeletionPipeline } from './gdpr-deletion-pipeline';

export interface UserExportData {
  profile: any;
  subscriptions: any[];
  notifications: any[];
  auditLogs: any[];
  preferences: any;
  emailAccounts: any[];
  teams: any[];
  blockchainLogs: {
    contractEvents: any[];
    renewalApprovals: any[];
  };
  blindingFactors: any[];
}

interface TokenVerificationResult {
  valid: boolean;
  userId?: string;
  emailType?: string;
}

const TOKEN_EXPIRY_DAYS = 90;

export class ComplianceService {
  private getSecret(): string {
    const secret = process.env.UNSUBSCRIBE_SECRET;
    if (!secret) {
      throw new Error('UNSUBSCRIBE_SECRET environment variable is required');
    }
    return secret;
  }

  generateUnsubscribeToken(userId: string, emailType: string, timestamp?: number): string {
    const ts = timestamp ?? Date.now();
    const payload = Buffer.from(JSON.stringify({ userId, emailType, ts })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getSecret())
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  verifyUnsubscribeToken(token: string): TokenVerificationResult {
    try {
      const [payload, signature] = token.split('.');
      if (!payload || !signature) {
        return { valid: false };
      }

      const expectedSignature = crypto
        .createHmac('sha256', this.getSecret())
        .update(payload)
        .digest('base64url');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return { valid: false };
      }

      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const { userId, emailType, ts } = data;

      const ageMs = Date.now() - ts;
      const maxAgeMs = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > maxAgeMs) {
        return { valid: false };
      }

      return { valid: true, userId, emailType };
    } catch {
      return { valid: false };
    }
  }

  async gatherUserData(userId: string): Promise<UserExportData> {
    const [
      profileResult,
      subscriptionsResult,
      notificationsResult,
      auditLogsResult,
      preferencesResult,
      emailAccountsResult,
      teamsResult,
      contractEventsResult,
      renewalApprovalsResult,
      blindingFactorsResult,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('subscriptions').select('*').eq('user_id', userId),
      supabase.from('notifications').select('*').eq('user_id', userId),
      supabase.from('audit_logs').select('*').eq('user_id', userId),
      supabase.from('user_preferences').select('*').eq('user_id', userId).single(),
      supabase.from('email_accounts').select('*').eq('user_id', userId),
      supabase.from('team_members').select('*').eq('user_id', userId),
      supabase.from('contract_events').select('*').eq('user_id', userId),
      supabase.from('renewal_approvals').select('*').eq('user_id', userId),
      supabase.from('commitment_blinding_factors').select('*').eq('user_id', userId),
    ]);

    return {
      profile: profileResult.data || {},
      subscriptions: subscriptionsResult.data || [],
      notifications: notificationsResult.data || [],
      auditLogs: auditLogsResult.data || [],
      preferences: preferencesResult.data || {},
      emailAccounts: emailAccountsResult.data || [],
      teams: teamsResult.data || [],
      blockchainLogs: {
        contractEvents: contractEventsResult.data || [],
        renewalApprovals: renewalApprovalsResult.data || [],
      },
      blindingFactors: blindingFactorsResult.data || [],
    };
  }

  async requestDeletion(userId: string, reason?: string): Promise<any> {
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

    let deletionRecord;

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
      deletionRecord = data;
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
      deletionRecord = data;
    }

    await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: now.toISOString() })
      .eq('user_id', userId)
      .in('status', ['active', 'paused']);

    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'account_deletion_requested',
      resource_type: 'account',
      resource_id: userId,
      metadata: { scheduled_deletion_at: scheduledDeletionAt.toISOString(), reason },
    });

    logger.info(`Account deletion requested for user ${userId}, scheduled for ${scheduledDeletionAt.toISOString()}`);

    // Send confirmation email
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(userId);
      if (user?.email) {
        await emailService.sendSimpleEmail(
          user.email,
          'Account Deletion Scheduled — Synchro',
          `Your account is scheduled for permanent deletion on ${scheduledDeletionAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}. You can cancel this by logging in to your account. After this date, all your data will be permanently deleted.`,
          { userId, emailType: 'updates' }
        );
      }
    } catch (emailError) {
      logger.error('Failed to send deletion confirmation email:', emailError);
    }

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

    logger.info(`Account deletion cancelled for user ${userId}`);
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
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(userId);
      if (user?.email) {
        await emailService.sendSimpleEmail(
          user.email,
          'Account Deleted — Synchro',
          'Your Synchro account has been permanently deleted and all personal data has been removed. Anonymized audit logs have been retained for security purposes. Thank you for using Synchro.',
        );
      }
    } catch (emailError) {
      logger.error(`Failed to send final deletion email for user ${userId}:`, emailError);
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
      logger.error(`Failed to delete auth user ${userId}: ${deleteError.message}`);
      return 0;
    }

    await supabase
      .from('account_deletions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', deletionId);

    logger.info(`Hard delete completed for user ${userId}`);
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
          logger.error(`GDPR pipeline failed for user ${deletion.user_id}`, {
            error: pipelineResult.error,
          });
          continue;
        }

        const count = await this.processHardDeleteForUser(deletion.user_id, deletion.id);
        processed += count;
      } catch (err) {
        logger.error(`Error processing hard delete for user ${deletion.user_id}:`, err);
      }
    }

    return processed;
  }
}

export const complianceService = new ComplianceService();
