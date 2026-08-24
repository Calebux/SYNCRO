import { supabase, databaseRepository } from '../config/database';
import logger from '../config/logger';
import crypto from 'crypto';
import { 
  Webhook, 
  WebhookDelivery, 
  WebhookEventType,
  WebhookEventPayloadMap,
  WebhookCreateInput, 
  WebhookUpdateInput 
} from '../types/webhook';
import { webhookDeadLetterService, WebhookDeadLetterReplay } from './webhook-dead-letter-service';
import { ExternalServiceClient } from '../utils/external-service-client';
import { emitSecurityEvent } from './audit-service';
import { getRequestId } from '../middleware/requestContext';

export class WebhookService {
  private readonly DISABLE_THRESHOLD = 10;
  private readonly client = new ExternalServiceClient('outbound_webhooks');

  /**
   * Register a new webhook
   */
  async registerWebhook(userId: string, input: WebhookCreateInput): Promise<Webhook> {
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    
    const { data, error } = await databaseRepository
      .from('webhooks')
      .insert({
        user_id: userId,
        url: input.url,
        secret,
        events: input.events,
        enabled: true,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to register webhook:', error);
      throw new Error(`Failed to register webhook: ${error.message}`);
    }

    return data as Webhook;
  }

  /**
   * Update an existing webhook
   */
  async updateWebhook(userId: string, webhookId: string, input: WebhookUpdateInput): Promise<Webhook> {
    const { data, error } = await databaseRepository
      .from('webhooks')
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq('id', webhookId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update webhook:', error);
      throw new Error(`Failed to update webhook: ${error.message}`);
    }

    return data as Webhook;
  }

  /**
   * List webhooks for a user
   */
  async listWebhooks(userId: string): Promise<Webhook[]> {
    const { data, error } = await databaseRepository
      .from('webhooks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to list webhooks:', error);
      throw new Error(`Failed to list webhooks: ${error.message}`);
    }

    return data as Webhook[];
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(userId: string, webhookId: string): Promise<void> {
    const { error } = await databaseRepository
      .from('webhooks')
      .delete()
      .eq('id', webhookId)
      .eq('user_id', userId);

    if (error) {
      logger.error('Failed to delete webhook:', error);
      throw new Error(`Failed to delete webhook: ${error.message}`);
    }
  }

  /**
   * Dispatch an event to all applicable webhooks
   */
  async dispatchEvent<E extends WebhookEventType>(userId: string, eventType: E, data: WebhookEventPayloadMap[E]): Promise<void> {
    const correlationId = getRequestId();
    
    try {
      // Find all enabled webhooks for this user subscribed to this event
      const { data: webhooks, error } = await databaseRepository
        .from('webhooks')
        .select('*')
        .eq('user_id', userId)
        .eq('enabled', true)
        .contains('events', [eventType]);

      if (error) {
        logger.error('Failed to fetch webhooks for dispatch:', { error, correlationId });
        return;
      }

      if (!webhooks || webhooks.length === 0) {
        return;
      }

      const eventPayload = {
        id: `evt_${crypto.randomUUID()}`,
        type: eventType,
        created: Math.floor(Date.now() / 1000),
        data,
        correlationId, // Include correlation ID in webhook payload for end-to-end tracing
      };

      for (const webhook of webhooks) {
        await this.createDelivery(webhook.id, eventType, eventPayload);
      }
      
      logger.debug('Webhook event dispatched', { eventType, webhookCount: webhooks.length, correlationId });
    } catch (err) {
      logger.error('Error dispatching webhook event:', { err, eventType, correlationId });
    }
  }

  /**
   * Trigger a test event for a webhook
   */
  async triggerTestEvent(userId: string, webhookId: string): Promise<WebhookDelivery> {
    const { data: webhook, error } = await databaseRepository
      .from('webhooks')
      .select('*')
      .eq('id', webhookId)
      .eq('user_id', userId)
      .single();

    if (error || !webhook) {
      throw new Error('Webhook not found or access denied');
    }

    const eventPayload = {
      id: `evt_test_${crypto.randomUUID()}`,
      type: 'test.event',
      created: Math.floor(Date.now() / 1000),
      data: { message: 'This is a test event from SYNCRO' },
    };

    const delivery = await this.createDelivery(webhook.id, 'test.event' as WebhookEventType, eventPayload);
    
    // Attempt immediate delivery for test events
    return await this.sendDelivery(delivery.id);
  }

  /**
   * Create a delivery record
   */
  private async createDelivery<E extends WebhookEventType>(webhookId: string, eventType: E, payload: { id: string; type: E; created: number; data: WebhookEventPayloadMap[E] }): Promise<WebhookDelivery> {
    const { data, error } = await databaseRepository
      .from('webhook_deliveries')
      .insert({
        webhook_id: webhookId,
        event_type: eventType,
        payload,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create webhook delivery record:', error);
      throw error;
    }

    // Proactively attempt delivery if it's the first try
    // In a real production system, this might be handled by a queue worker
    this.sendDelivery(data.id).catch(err => {
      logger.error(`Initial delivery attempt failed for ${data.id}:`, err);
    });

    return data as WebhookDelivery;
  }

  /**
   * Execute an HTTP POST for a delivery
   */
  async sendDelivery(deliveryId: string): Promise<WebhookDelivery> {
    const { data: delivery, error: fetchError } = await databaseRepository
      .from('webhook_deliveries')
      .select('*, webhooks!inner(*)')
      .eq('id', deliveryId)
      .single();

    if (fetchError || !delivery) {
      throw new Error(`Delivery ${deliveryId} not found`);
    }

    const webhook = (delivery as WebhookDelivery & { webhooks: Webhook }).webhooks;
    const payloadString = JSON.stringify(delivery.payload);
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payloadString)
      .digest('hex');

    // ── SSRF guard (dispatch-time, with DNS resolution) ───────────────────
    // The webhook URL was validated at creation/update time by the schema, but
    // we re-validate here with a DNS lookup to protect against:
    //   - DNS rebinding attacks
    //   - Webhooks that were registered before SSRF checks were added
    //   - Any URL that bypassed schema validation
    try {
      await validateOutboundUrl(webhook.url, { resolveDns: true });
    } catch (ssrfErr) {
      const reason = ssrfErr instanceof SSRFError ? ssrfErr.message : String(ssrfErr);
      logger.warn(`SSRF check blocked webhook delivery ${deliveryId}: ${reason}`, {
        webhookId: webhook.id,
        url: webhook.url,
      });
      emitSecurityEvent('webhook.ssrf_blocked', {
        severity: 'high',
        resourceType: 'webhook',
        resourceId: webhook.id,
        reason,
        details: { deliveryId, url: webhook.url },
      });
      return await this.handleDeliveryFailure(
        deliveryId,
        webhook.id,
        0,
        `SSRF protection blocked delivery: ${reason}`,
      );
    }
    // ─────────────────────────────────────────────────────────────────────

    try {
      const data = await this.client.request<unknown>(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Syncro-Signature': signature,
          'User-Agent': 'Syncro-Webhooks/1.0',
        },
        body: payloadString,
      });

      // ExternalServiceClient throws on !response.ok, so we handle it in catch
      return await this.updateDeliverySuccess(deliveryId, 200, JSON.stringify(data).substring(0, 1000));
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const status = errorMsg.includes('status')
        ? parseInt(errorMsg.match(/\d+/)?.[0] || '0', 10)
        : 0;
      return await this.handleDeliveryFailure(deliveryId, webhook.id, status, errorMsg);
    }
  }

  private async updateDeliverySuccess(deliveryId: string, code: number, body: string): Promise<WebhookDelivery> {
    const { data, error } = await databaseRepository
      .from('webhook_deliveries')
      .update({
        status: 'success',
        response_code: code,
        response_body: body,
        delivered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .select()
      .single();

    if (error) throw error;
    
    // Reset failure count on success
    const { data: delivery } = await databaseRepository
      .from('webhook_deliveries')
      .select('webhook_id')
      .eq('id', deliveryId)
      .single();
    
    if (delivery) {
      await databaseRepository
        .from('webhooks')
        .update({ failure_count: 0 })
        .eq('id', delivery.webhook_id);
    }

    return data as WebhookDelivery;
  }

  private async handleDeliveryFailure(deliveryId: string, webhookId: string, code: number, body: string): Promise<WebhookDelivery> {
    const { data: currentDelivery } = await databaseRepository
      .from('webhook_deliveries')
      .select('retry_count')
      .eq('id', deliveryId)
      .single();

    const retryCount = (currentDelivery?.retry_count || 0) + 1;
    let nextStatus: 'failed' | 'retrying' = 'failed';
    let scheduledAt = null;

    // Check if we've exhausted retries
    if (retryCount > this.MAX_RETRIES) {
      // Move to dead-letter
      logger.warn(`Delivery ${deliveryId} exhausted retries (${retryCount}), moving to dead-letter`);
      const errorReason = body || `HTTP ${code || 'network error'}`;
      await webhookDeadLetterService.moveToDeadLetter(
        deliveryId,
        `Exhausted ${this.MAX_RETRIES} retries`,
        errorReason
      );
      emitSecurityEvent('webhook.dead_letter_exhausted', {
        severity: 'medium',
        resourceType: 'webhook',
        resourceId: webhookId,
        reason: `Delivery ${deliveryId} exhausted retries (${retryCount})`,
        details: { deliveryId, retryCount, error: errorReason },
      });
    } else if (retryCount <= this.MAX_RETRIES) {
      nextStatus = 'retrying';
      // Exponential backoff: 30s, 5m, 30m, 2h, 6h
      const delays = [30, 300, 1800, 7200, 21600];
      const delay = delays[retryCount - 1] || 21600;
      scheduledAt = new Date(Date.now() + delay * 1000).toISOString();
    }

    const { data, error } = await databaseRepository
      .from('webhook_deliveries')
      .update({
        status: nextStatus,
        response_code: code,
        response_body: body,
        retry_count: retryCount,
        scheduled_at: scheduledAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error_message: body || `HTTP ${code || 'network error'}`,
      })
      .eq('id', deliveryId)
      .select()
      .single();

    if (error) throw error;

    // Update webhook failure count
    const { data: webhook } = await databaseRepository
      .from('webhooks')
      .select('failure_count')
      .eq('id', webhookId)
      .single();
    
    const newFailureCount = (webhook?.failure_count || 0) + 1;
    const enabled = newFailureCount < this.DISABLE_THRESHOLD;

    await databaseRepository
      .from('webhooks')
      .update({ 
        failure_count: newFailureCount,
        enabled,
      })
      .eq('id', webhookId);

    if (!enabled) {
      logger.warn(`Webhook ${webhookId} disabled after ${newFailureCount} consecutive failures`);
      emitSecurityEvent('webhook.auto_disabled', {
        severity: 'high',
        resourceType: 'webhook',
        resourceId: webhookId,
        reason: `Disabled after ${newFailureCount} consecutive failures`,
        details: { failureCount: newFailureCount },
      });
    } else if (newFailureCount >= this.DISABLE_THRESHOLD / 2) {
      emitSecurityEvent('webhook.anomalous_failure_rate', {
        severity: 'medium',
        resourceType: 'webhook',
        resourceId: webhookId,
        reason: `Elevated failure rate: ${newFailureCount}/${this.DISABLE_THRESHOLD} consecutive failures`,
        details: { failureCount: newFailureCount, disableThreshold: this.DISABLE_THRESHOLD },
      });
    }

    return data as WebhookDelivery;
  }

  /**
   * Get delivery history for a webhook
   */
  async getDeliveries(userId: string, webhookId: string): Promise<WebhookDelivery[]> {
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
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Failed to fetch deliveries: ${error.message}`);
    }

    return data as WebhookDelivery[];
  }

  /**
   * Process retries for all webhooks
   */
  async processRetries(): Promise<void> {
    const now = new Date().toISOString();
    const { data: deliveries, error } = await databaseRepository
      .from('webhook_deliveries')
      .select('id')
      .eq('status', 'retrying')
      .lte('scheduled_at', now);

    if (error) {
      logger.error('Failed to fetch webhook retries:', error);
      return;
    }

    if (!deliveries || deliveries.length === 0) return;

    logger.info(`Processing ${deliveries.length} webhook retries`);

    for (const delivery of deliveries) {
      this.sendDelivery(delivery.id).catch(err => {
        logger.error(`Retry delivery failed for ${delivery.id}:`, err);
      });
    }
  }

  /**
   * Get dead-letter deliveries for a webhook
   */
  async getDeadLetterDeliveries(userId: string, webhookId: string) {
    return webhookDeadLetterService.getDeadLetterDeliveries(userId, webhookId);
  }

  /**
   * Get all dead-letter deliveries for a user
   */
  async getAllUserDeadLetters(userId: string) {
    return webhookDeadLetterService.getAllUserDeadLetters(userId);
  }

  /**
   * Create a replay request for a dead-letter delivery
   */
  async createDeadLetterReplay(userId: string, deliveryId: string, idempotencyKey?: string) {
    return webhookDeadLetterService.createReplayRequest(deliveryId, userId, idempotencyKey);
  }

  /**
   * Get replay history for a dead-letter delivery
   */
  async getDeadLetterReplayHistory(userId: string, deliveryId: string) {
    return webhookDeadLetterService.getReplayHistory(userId, deliveryId);
  }

  /**
   * Execute a replay for a dead-letter delivery
   */
  async executeDeadLetterReplay(userId: string, replayId: string): Promise<WebhookDeadLetterReplay> {
    // Fetch the replay
    const { data: replay, error: replayError } = await databaseRepository
      .from('webhook_dead_letter_replays')
      .select('*, webhook_deliveries!inner(*, webhooks!inner(*))')
      .eq('id', replayId)
      .single();

    if (replayError || !replay) {
      throw new Error('Replay request not found');
    }

    const delivery = replay.webhook_deliveries as WebhookDelivery & { webhooks: Webhook };
    const webhook = delivery.webhooks;

    // Verify ownership
    if (webhook.user_id !== userId) {
      throw new Error('Access denied');
    }

    return webhookDeadLetterService.executeReplay(replayId, webhook, delivery);
  }

  /**
   * Get dead-letter statistics for a user
   */
  async getDeadLetterStats(userId: string) {
    return webhookDeadLetterService.getDeadLetterStats(userId);
  }
}

export const webhookService = new WebhookService();
