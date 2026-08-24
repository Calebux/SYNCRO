import { supabase, databaseRepository } from '../config/database';
import logger from '../config/logger';
import crypto from 'crypto';
import { Webhook, WebhookDelivery } from '../types/webhook';
import { emitSecurityEvent } from './audit-service';
import { validateOutboundUrl, SSRFError } from '../utils/ssrf-protection';

export interface WebhookDeadLetterDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: Record<string, unknown> | WebhookDelivery['payload'];
  response_code: number | null;
  response_body: string | null;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  retry_count: number;
  scheduled_at: string;
  delivered_at: string | null;
  is_dead_letter: boolean;
  dead_letter_at: string | null;
  dead_letter_reason: string | null;
  last_error_message: string | null;
  created_at: string;
}

interface DeadLetterRow extends WebhookDeadLetterDelivery {
  webhooks?: { id: string; user_id: string; url?: string };
}

interface DeadLetterStatsRow {
  webhook_id: string;
  total_dead_letter_deliveries?: number;
  dead_letters_24h?: number;
  most_recent_dead_letter?: string | null;
}

export interface WebhookDeadLetterReplay {
  id: string;
  webhook_delivery_id: string;
  idempotency_key: string;
  replay_request_by: string | null;
  status: 'pending' | 'processing' | 'success' | 'failed';
  response_code: number | null;
  response_body: string | null;
  error_message: string | null;
  attempted_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Dead-Letter Service for Webhook Deliveries
 * Handles moving failed deliveries to dead-letter state and replaying them
 */
export class WebhookDeadLetterService {
  /**
   * Move a failed delivery to dead-letter state
   */
  async moveToDeadLetter(
    deliveryId: string,
    reason: string,
    errorMessage: string
  ): Promise<WebhookDeadLetterDelivery> {
    const { data, error } = await databaseRepository
      .from('webhook_deliveries')
      .update({
        is_dead_letter: true,
        dead_letter_at: new Date().toISOString(),
        dead_letter_reason: reason,
        last_error_message: errorMessage,
        status: 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to move delivery to dead-letter:', error);
      throw error;
    }

    logger.warn(`Delivery ${deliveryId} moved to dead-letter: ${reason}`);
    return data as WebhookDeadLetterDelivery;
  }

  /**
   * Get all dead-letter deliveries for a webhook
   */
  async getDeadLetterDeliveries(userId: string, webhookId: string): Promise<WebhookDeadLetterDelivery[]> {
    // Verify ownership
    const { data: webhook } = await databaseRepository
      .from('webhooks')
      .select('id')
      .eq('id', webhookId)
      .eq('user_id', userId)
      .single();

    if (!webhook) {
      throw new Error('Webhook not found or access denied');
    }

    const { data, error } = await databaseRepository
      .from('webhook_deliveries')
      .select('*')
      .eq('webhook_id', webhookId)
      .eq('is_dead_letter', true)
      .order('dead_letter_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch dead-letter deliveries:', error);
      throw error;
    }

    return data as WebhookDeadLetterDelivery[];
  }

  /**
   * Get all dead-letter deliveries for a user across all webhooks
   */
  async getAllUserDeadLetters(userId: string): Promise<(WebhookDeadLetterDelivery & { webhook_url?: string })[]> {
    const { data, error } = await databaseRepository
      .from('webhook_deliveries')
      .select(`
        *,
        webhooks!inner(id, user_id, url)
      `)
      .eq('webhooks.user_id', userId)
      .eq('is_dead_letter', true)
      .order('dead_letter_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch user dead-letter deliveries:', error);
      throw error;
    }

    return (data as DeadLetterRow[] | null)?.map((d) => ({
      ...d,
      webhook_url: d.webhooks?.url,
    })) || [];
  }

  /**
   * Create a replay request for a dead-letter delivery
   */
  async createReplayRequest(
    deliveryId: string,
    userId: string,
    idempotencyKey?: string
  ): Promise<WebhookDeadLetterReplay> {
    // Verify the delivery exists and belongs to user's webhook
    const { data: delivery, error: fetchError } = await databaseRepository
      .from('webhook_deliveries')
      .select(`
        *,
        webhooks!inner(id, user_id)
      `)
      .eq('id', deliveryId)
      .eq('webhooks.user_id', userId)
      .eq('is_dead_letter', true)
      .single();

    if (fetchError || !delivery) {
      throw new Error('Dead-letter delivery not found or access denied');
    }

    // Use provided idempotency key or generate one
    const key = idempotencyKey || crypto.randomUUID();

    try {
      const { data, error } = await databaseRepository
        .from('webhook_dead_letter_replays')
        .insert({
          webhook_delivery_id: deliveryId,
          idempotency_key: key,
          replay_request_by: userId,
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        // If the key already exists, return the existing replay
        if (error.code === '23505') { // Unique constraint violation
          const { data: existingReplay, error: fetchExistingError } = await databaseRepository
            .from('webhook_dead_letter_replays')
            .select('*')
            .eq('idempotency_key', key)
            .single();

          if (fetchExistingError) {
            throw error; // Re-throw original error if fetch fails
          }

          logger.info(`Idempotent replay: using existing replay ${existingReplay.id}`);
          return existingReplay as WebhookDeadLetterReplay;
        }
        throw error;
      }

      logger.info(`Created replay request ${data.id} for delivery ${deliveryId}`);
      return data as WebhookDeadLetterReplay;
    } catch (error) {
      logger.error('Failed to create replay request:', error);
      throw error;
    }
  }

  /**
   * Get replay history for a dead-letter delivery
   */
  async getReplayHistory(userId: string, deliveryId: string): Promise<WebhookDeadLetterReplay[]> {
    // Verify ownership
    const { data: delivery } = await databaseRepository
      .from('webhook_deliveries')
      .select('*, webhooks!inner(user_id)')
      .eq('id', deliveryId)
      .eq('webhooks.user_id', userId)
      .single();

    if (!delivery) {
      throw new Error('Delivery not found or access denied');
    }

    const { data, error } = await databaseRepository
      .from('webhook_dead_letter_replays')
      .select('*')
      .eq('webhook_delivery_id', deliveryId)
      .order('attempted_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch replay history:', error);
      throw error;
    }

    return data as WebhookDeadLetterReplay[];
  }

  /**
   * Execute a replay for a dead-letter delivery
   */
  async executeReplay(
    replayId: string,
    webhook: Pick<Webhook, 'id' | 'url' | 'secret'>,
    delivery: Pick<WebhookDelivery, 'payload'>,
  ): Promise<WebhookDeadLetterReplay> {
    // Update status to processing
    await databaseRepository
      .from('webhook_dead_letter_replays')
      .update({ status: 'processing' })
      .eq('id', replayId);

    try {
      // ── SSRF guard (replay-time, with DNS resolution) ─────────────────
      // Dead-letter replays re-use the original webhook URL which may have
      // been registered before SSRF checks were added, or the DNS record
      // may have changed since registration (rebinding).
      try {
        await validateOutboundUrl(webhook.url, { resolveDns: true });
      } catch (ssrfErr) {
        const reason = ssrfErr instanceof SSRFError ? ssrfErr.message : String(ssrfErr);
        logger.warn(`SSRF check blocked dead-letter replay ${replayId}: ${reason}`, {
          webhookId: webhook.id,
          url: webhook.url,
        });
        emitSecurityEvent('webhook.ssrf_blocked', {
          severity: 'high',
          resourceType: 'webhook',
          resourceId: webhook.id,
          reason,
          details: { replayId, url: webhook.url },
        });

        const { data: failedData, error: failedError } = await databaseRepository
          .from('webhook_dead_letter_replays')
          .update({
            status: 'failed',
            error_message: `SSRF protection blocked replay: ${reason}`,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', replayId)
          .select()
          .single();

        if (failedError) throw failedError;
        return failedData as WebhookDeadLetterReplay;
      }
      // ─────────────────────────────────────────────────────────────────
      const payloadString = JSON.stringify(delivery.payload);
      const signature = crypto
        .createHmac('sha256', webhook.secret)
        .update(payloadString)
        .digest('hex');

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Syncro-Signature': signature,
          'User-Agent': 'Syncro-Webhooks/1.0',
          'X-Syncro-Replay': 'true',
          'X-Syncro-Replay-Id': replayId,
        },
        body: payloadString,
      });

      const responseText = await response.text();
      const isSuccess = response.ok;

      const updateData: {
        response_code: number;
        response_body: string;
        completed_at: string;
        updated_at: string;
        status?: 'success' | 'failed';
        error_message?: string;
      } = {
        response_code: response.status,
        response_body: responseText.substring(0, 1000),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (isSuccess) {
        updateData.status = 'success';
        logger.info(`Replay ${replayId} succeeded`);
      } else {
        updateData.status = 'failed';
        updateData.error_message = `HTTP ${response.status}: ${responseText.substring(0, 200)}`;
        logger.warn(`Replay ${replayId} failed with status ${response.status}`);
      }

      const { data, error } = await databaseRepository
        .from('webhook_dead_letter_replays')
        .update(updateData)
        .eq('id', replayId)
        .select()
        .single();

      if (error) throw error;

      // If successful, update the original delivery as well
      if (isSuccess) {
        await databaseRepository
          .from('webhook_deliveries')
          .update({
            status: 'success',
            delivered_at: new Date().toISOString(),
            response_code: response.status,
            response_body: responseText.substring(0, 1000),
            updated_at: new Date().toISOString(),
          })
          .eq('id', delivery.id);

        // Reset webhook failure count on successful replay
        const { data: webhook } = await databaseRepository
          .from('webhooks')
          .select('failure_count')
          .eq('id', delivery.webhook_id)
          .single();

        if (webhook) {
          await databaseRepository
            .from('webhooks')
            .update({ 
              failure_count: Math.max(0, (webhook.failure_count || 1) - 1),
              enabled: true, // Re-enable the webhook
            })
            .eq('id', delivery.webhook_id);
        }
      }

      return data as WebhookDeadLetterReplay;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Replay ${replayId} encountered error:`, err);

      const { data, error } = await databaseRepository
        .from('webhook_dead_letter_replays')
        .update({
          status: 'failed',
          error_message: errorMsg,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', replayId)
        .select()
        .single();

      if (error) throw error;
      return data as WebhookDeadLetterReplay;
    }
  }

  /**
   * Get statistics for dead-letter deliveries
   */
  async getDeadLetterStats(userId: string): Promise<{
    total_dead_letters: number;
    dead_letters_24h: number;
    dead_letters_7d: number;
    by_webhook: Array<{
      webhook_id: string;
      webhook_url: string;
      count: number;
      most_recent: string;
    }>;
  }> {
    const { data, error } = await databaseRepository
      .from('webhook_dead_letter_stats')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      logger.error('Failed to fetch dead-letter stats:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return {
        total_dead_letters: 0,
        dead_letters_24h: 0,
        dead_letters_7d: 0,
        by_webhook: [],
      };
    }

    const rows = data as DeadLetterStatsRow[];
    const total_dead_letters = rows.reduce(
      (sum, row) => sum + (row.total_dead_letter_deliveries || 0),
      0,
    );
    const dead_letters_24h = rows.reduce(
      (sum, row) => sum + (row.dead_letters_24h || 0),
      0,
    );

    return {
      total_dead_letters,
      dead_letters_24h,
      dead_letters_7d: total_dead_letters, // We'd need another view for this
      by_webhook: rows.map((row) => ({
        webhook_id: row.webhook_id,
        webhook_url: '', // Would need to join webhooks table
        count: row.total_dead_letter_deliveries,
        most_recent: row.most_recent_dead_letter,
      })),
    };
  }
}

export const webhookDeadLetterService = new WebhookDeadLetterService();
