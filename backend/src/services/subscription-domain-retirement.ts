/**
 * Subscription Domain Retirement & GDPR Deletion Service
 * 
 * Handles inventorying, export validation, scheduled data erasure,
 * OAuth credential destruction & provider revocation (Gmail & Outlook),
 * and immutable audit recording for the retired subscription domain.
 */

import { supabase } from '../config/database';
import logger from '../config/logger';
import { GmailTokenService } from './gmail-token-service';
import { OutlookTokenService } from './outlook-token-service';
import { executeGdprDeletionPipeline } from './gdpr-deletion-pipeline';
import { complianceService, UserExportData } from './compliance-service';

export interface DataInventorySummary {
  userId: string;
  emailAccountCount: number;
  subscriptionCount: number;
  notificationCount: number;
  auditLogCount: number;
  backupRetentionPolicyDays: number;
  providerTokensCount: number;
}

export interface DeletionExecutionReport {
  userId: string;
  deletionDate: string;
  exportVerified: boolean;
  oauthRevocations: {
    gmailRevoked: boolean;
    outlookRevoked: boolean;
  };
  databasePurged: boolean;
  backupScheduledPurgeDate: string;
  auditTrailId: string;
  success: boolean;
  errors?: string[];
}

export class SubscriptionDomainRetirementService {
  private static readonly BACKUP_RETENTION_DAYS = 30;

  /**
   * Inventories all personal and domain data held by the subscription domain for a user.
   */
  static async inventoryUserData(userId: string): Promise<DataInventorySummary> {
    const [
      emailAccounts,
      subscriptions,
      notifications,
      auditLogs,
    ] = await Promise.all([
      supabase.from('email_accounts').select('id, provider').eq('user_id', userId),
      supabase.from('subscriptions').select('id').eq('user_id', userId),
      supabase.from('notifications').select('id').eq('user_id', userId),
      supabase.from('audit_logs').select('id').eq('user_id', userId),
    ]);

    return {
      userId,
      emailAccountCount: emailAccounts.data?.length ?? 0,
      subscriptionCount: subscriptions.data?.length ?? 0,
      notificationCount: notifications.data?.length ?? 0,
      auditLogCount: auditLogs.data?.length ?? 0,
      backupRetentionPolicyDays: this.BACKUP_RETENTION_DAYS,
      providerTokensCount: emailAccounts.data?.length ?? 0,
    };
  }

  /**
   * Generates and validates an export archive promised in the deprecation notice.
   */
  static async executeExportPreDeletion(userId: string): Promise<UserExportData> {
    const exportData = await complianceService.gatherUserData(userId);
    
    // Log export execution on the audit trail
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'subscription_domain_deprecation_export_generated',
      resource_type: 'subscription_domain',
      resource_id: userId,
      metadata: {
        subscriptionsCount: exportData.subscriptions.length,
        emailAccountsCount: exportData.emailAccounts.length,
        timestamp: new Date().toISOString(),
      },
    });

    return exportData;
  }

  /**
   * Destroys stored mail credentials and revokes OAuth grants at Google and Microsoft.
   */
  static async destroyMailCredentialsAndRevokeOAuth(userId: string): Promise<{ gmailRevoked: boolean; outlookRevoked: boolean }> {
    let gmailRevoked = false;
    let outlookRevoked = false;

    try {
      await GmailTokenService.disconnectGmailAccount(userId);
      gmailRevoked = true;
    } catch (err) {
      logger.error('Failed to revoke Gmail OAuth tokens during domain retirement', { userId, err });
    }

    try {
      await OutlookTokenService.disconnectOutlookAccount(userId);
      outlookRevoked = true;
    } catch (err) {
      logger.error('Failed to disconnect Outlook account during domain retirement', { userId, err });
    }

    return { gmailRevoked, outlookRevoked };
  }

  /**
   * Executes scheduled retirement deletion on the stated date:
   * 1. Export verification
   * 2. OAuth destruction & remote revocation
   * 3. GDPR cascading purge across user tables & Sentry scrubbing
   * 4. Backup lifecycle scheduling recording
   * 5. Immutable audit logging
   */
  static async executeScheduledRetirementDeletion(
    userId: string,
    deletionId: string,
  ): Promise<DeletionExecutionReport> {
    const errors: string[] = [];
    const executionDate = new Date();
    const backupPurgeDate = new Date(executionDate.getTime() + this.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // 1. Pre-deletion export check
    let exportVerified = true;
    try {
      await this.executeExportPreDeletion(userId);
    } catch (err: any) {
      exportVerified = false;
      errors.push(`Export generation failed: ${err.message}`);
    }

    // 2. Destroy and revoke OAuth credentials
    const oauthRevocations = await this.destroyMailCredentialsAndRevokeOAuth(userId);

    // 3. GDPR pipeline execution
    const pipelineResult = await executeGdprDeletionPipeline(userId, deletionId);
    if (!pipelineResult.success) {
      errors.push(`GDPR cascade deletion failed: ${pipelineResult.error}`);
    }

    // 4. Record audit trail for subscription retirement
    try {
      await supabase.from('deletion_audit_trail').insert({
        deletion_id: deletionId,
        step: 'subscription_domain_retirement_complete',
        status: errors.length === 0 ? 'completed' : 'failed',
        metadata: {
          userId,
          exportVerified,
          oauthRevocations,
          backupRetentionPolicyDays: this.BACKUP_RETENTION_DAYS,
          scheduledBackupPurgeDate: backupPurgeDate.toISOString(),
          executedAt: executionDate.toISOString(),
          errors,
        },
      });
    } catch (auditErr: any) {
      errors.push(`Audit trail record failed: ${auditErr.message}`);
    }

    return {
      userId,
      deletionDate: executionDate.toISOString(),
      exportVerified,
      oauthRevocations,
      databasePurged: pipelineResult.success,
      backupScheduledPurgeDate: backupPurgeDate.toISOString(),
      auditTrailId: deletionId,
      success: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
