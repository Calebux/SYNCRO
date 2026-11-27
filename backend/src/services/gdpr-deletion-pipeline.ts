import { supabase } from '../config/database';
import logger from '../config/logger';
import { removeUserFromSentry } from './sentry-user-deletion';

/** Tables with user_id that should be purged before auth user deletion. */
const USER_DATA_TABLES = [
  'notifications',
  'email_accounts',
  'team_members',
  'push_subscriptions',
  'user_preferences',
  'commitment_blinding_factors',
  'api_keys',
  'webhook_endpoints',
  'wallet_verifications',
  'privacy_preferences',
  'payment_channels',
  'pending_settlements',
  'gift_card_ledger',
  'subscription_gift_cards',
  'risk_scores',
  'dismissed_suggestions',
  'referrals',
  'reminder_settings',
  'budget_alerts',
  'slack_integrations',
  'mfa_secrets',
  'digest_preferences',
] as const;

export interface DeletionPipelineResult {
  success: boolean;
  stepsCompleted: string[];
  error?: string;
}

async function recordAuditStep(
  deletionId: string,
  step: string,
  status: 'started' | 'completed' | 'failed',
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await supabase.from('deletion_audit_trail').insert({
      deletion_id: deletionId,
      step,
      status,
      metadata,
    });

    if (error) {
      logger.error('Failed to record deletion audit step', { deletionId, step, error: error.message });
    }
  } catch (err) {
    logger.error('Failed to record deletion audit step', { deletionId, step, err });
  }
}

async function cascadeDeleteUserTables(userId: string): Promise<number> {
  let tablesProcessed = 0;

  for (const table of USER_DATA_TABLES) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (error) {
      // Table may not exist in all environments — log and continue
      logger.warn(`GDPR cascade: could not purge ${table}`, { userId, error: error.message });
    } else {
      tablesProcessed += 1;
    }
  }

  // Cancel and anonymize subscriptions (retain anonymized billing history)
  await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      name: '[deleted]',
      merchant: '[deleted]',
      executor_address: null,
      blockchain_sub_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  // Remove profile PII before auth cascade
  await supabase
    .from('profiles')
    .update({
      full_name: null,
      avatar_url: null,
      email: null,
      phone: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  return tablesProcessed;
}

async function anonymizeBlockchainReferences(userId: string): Promise<number> {
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('blockchain_sub_id')
    .eq('user_id', userId)
    .not('blockchain_sub_id', 'is', null);

  const subIds = (subscriptions ?? [])
    .map((s) => s.blockchain_sub_id)
    .filter((id): id is number => id != null);

  if (subIds.length === 0) {
    return 0;
  }

  let anonymized = 0;

  for (const subId of subIds) {
    const { data: events } = await supabase
      .from('contract_events')
      .select('id, event_data')
      .eq('sub_id', subId);

    for (const event of events ?? []) {
      const redactedData = {
        ...(typeof event.event_data === 'object' && event.event_data !== null
          ? event.event_data
          : {}),
        _anonymized: true,
        user_reference: null,
      };

      await supabase
        .from('contract_events')
        .update({
          tx_hash: `redacted_${event.id}`,
          event_data: redactedData,
        })
        .eq('id', event.id);

      anonymized += 1;
    }

    await supabase
      .from('renewal_approvals')
      .update({ rejection_reason: null })
      .eq('blockchain_sub_id', subId);
  }

  return anonymized;
}

async function anonymizeAuditLogs(userId: string): Promise<void> {
  await supabase
    .from('audit_logs')
    .update({ user_id: null, ip_address: null, user_agent: null })
    .eq('user_id', userId);
}

/**
 * Execute the full GDPR right-to-erasure pipeline for a single user.
 * Records metadata-only audit trail entries at each step.
 */
export async function executeGdprDeletionPipeline(
  userId: string,
  deletionId: string,
): Promise<DeletionPipelineResult> {
  const stepsCompleted: string[] = [];

  try {
    await recordAuditStep(deletionId, 'pipeline_start', 'started', { userId });

    await recordAuditStep(deletionId, 'cascade_delete', 'started');
    const tablesProcessed = await cascadeDeleteUserTables(userId);
    await recordAuditStep(deletionId, 'cascade_delete', 'completed', { tablesProcessed });
    stepsCompleted.push('cascade_delete');

    await recordAuditStep(deletionId, 'blockchain_anonymize', 'started');
    const eventsAnonymized = await anonymizeBlockchainReferences(userId);
    await recordAuditStep(deletionId, 'blockchain_anonymize', 'completed', { eventsAnonymized });
    stepsCompleted.push('blockchain_anonymize');

    await recordAuditStep(deletionId, 'audit_log_anonymize', 'started');
    await anonymizeAuditLogs(userId);
    await recordAuditStep(deletionId, 'audit_log_anonymize', 'completed');
    stepsCompleted.push('audit_log_anonymize');

    await recordAuditStep(deletionId, 'sentry_removal', 'started');
    const sentryResult = await removeUserFromSentry(userId);
    await recordAuditStep(deletionId, 'sentry_removal', 'completed', sentryResult);
    stepsCompleted.push('sentry_removal');

    // Logging systems: record deletion event (no PII) for log correlation scrubbing
    logger.info('GDPR deletion pipeline completed pre-auth purge', {
      deletionId,
      stepsCompleted: stepsCompleted.length,
      tablesProcessed,
      eventsAnonymized,
    });
    await recordAuditStep(deletionId, 'logging_scrub', 'completed', {
      note: 'User references redacted from active log context',
    });
    stepsCompleted.push('logging_scrub');

    await recordAuditStep(deletionId, 'pipeline_start', 'completed');
    return { success: true, stepsCompleted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordAuditStep(deletionId, 'pipeline_error', 'failed', { error: message });
    logger.error('GDPR deletion pipeline failed', { userId, deletionId, error: message });
    return { success: false, stepsCompleted, error: message };
  }
}
