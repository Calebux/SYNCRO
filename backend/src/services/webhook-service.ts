import { supabase } from '../config/database';
import logger from '../config/logger';
import crypto from 'crypto';
import { 
  Webhook, 
  WebhookDelivery, 
  WebhookEventType, 
  WebhookCreateInput, 
  WebhookUpdateInput 
} from '../types/webhook';

export class WebhookService {
  private readonly MAX_RETRIES = 5;
  private readonly DISABLE_THRESHOLD = 10;

  /**
   * Register a new webhook
   */
  async registerWebhook(userId: string, input: WebhookCreateInput): Promise<Webhook> {
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    
    const { data, error } = await supabase
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
    const { data, error } = await supabase
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
    const { data, error } = await supabase
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
    const { error } = await supabase
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
  async dispatchEvent(userId: string, eventType: WebhookEventType, data: any): Promise<void> {
    try {
      // Find all enabled webhooks for this user subscribed to this event
      const { data: webhooks, error } = await supabase
        .from('webhooks')
        .select('*')
        .eq('user_id', userId)
        .eq('enabled', true)
        .contains('events', [eventType]);

      if (error) {
        logger.error('Failed to fetch webhooks for dispatch:', error);
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
      };

      for (const webhook of webhooks) {
        await this.createDelivery(webhook.id, eventType, eventPayload);
      }
    } catch (err) {
      logger.error('Error dispatching webhook event:', err);
    }
  }

  /**
   * Trigger a test event for a webhook
   */
  async triggerTestEvent(userId: string, webhookId: string): Promise<WebhookDelivery> {
    const { data: webhook, error } = await supabase
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
  private async createDelivery(webhookId: string, eventType: WebhookEventType, payload: any): Promise<WebhookDelivery> {
    const { data, error } = await supabase
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
    const { data: delivery, error: fetchError } = await supabase
      .from('webhook_deliveries')
      .select('*, webhooks!inner(*)')
      .eq('id', deliveryId)
      .single();

    if (fetchError || !delivery) {
      throw new Error(`Delivery ${deliveryId} not found`);
    }

    const webhook = (delivery as any).webhooks as Webhook;
    const payloadString = JSON.stringify(delivery.payload);
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payloadString)
      .digest('hex');

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Syncro-Signature': signature,
          'User-Agent': 'Syncro-Webhooks/1.0',
        },
        body: payloadString,
      });

      const responseText = await response.text();
      const isSuccess = response.ok;

      if (isSuccess) {
        return await this.updateDeliverySuccess(deliveryId, response.status, responseText.substring(0, 1000));
      } else {
        return await this.handleDeliveryFailure(deliveryId, webhook.id, response.status, responseText.substring(0, 1000));
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return await this.handleDeliveryFailure(deliveryId, webhook.id, 0, errorMsg);
    }
  }

  private async updateDeliverySuccess(deliveryId: string, code: number, body: string): Promise<WebhookDelivery> {
    const { data, error } = await supabase
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
    const { data: delivery } = await supabase
      .from('webhook_deliveries')
      .select('webhook_id')
      .eq('id', deliveryId)
      .single();
    
    if (delivery) {
      await supabase
        .from('webhooks')
        .update({ failure_count: 0 })
        .eq('id', delivery.webhook_id);
    }

    return data as WebhookDelivery;
  }

  private async handleDeliveryFailure(deliveryId: string, webhookId: string, code: number, body: string): Promise<WebhookDelivery> {
    const { data: currentDelivery } = await supabase
      .from('webhook_deliveries')
      .select('retry_count')
      .eq('id', deliveryId)
      .single();

    const retryCount = (currentDelivery?.retry_count || 0) + 1;
    let nextStatus: 'failed' | 'retrying' = 'failed';
    let scheduledAt = null;

    if (retryCount <= this.MAX_RETRIES) {
      nextStatus = 'retrying';
      // Exponential backoff: 30s, 5m, 30m, 2h, 6h
      const delays = [30, 300, 1800, 7200, 21600];
      const delay = delays[retryCount - 1] || 21600;
      scheduledAt = new Date(Date.now() + delay * 1000).toISOString();
    }

    const { data, error } = await supabase
      .from('webhook_deliveries')
      .update({
        status: nextStatus,
        response_code: code,
        response_body: body,
        retry_count: retryCount,
        scheduled_at: scheduledAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .select()
      .single();

    if (error) throw error;

    // Update webhook failure count
    const { data: webhook } = await supabase
      .from('webhooks')
      .select('failure_count')
      .eq('id', webhookId)
      .single();
    
    const newFailureCount = (webhook?.failure_count || 0) + 1;
    const enabled = newFailureCount < this.DISABLE_THRESHOLD;

    await supabase
      .from('webhooks')
      .update({ 
        failure_count: newFailureCount,
        enabled,
      })
      .eq('id', webhookId);

    if (!enabled) {
      logger.warn(`Webhook ${webhookId} disabled after ${newFailureCount} consecutive failures`);
    }

    return data as WebhookDelivery;
  }

  /**
   * Get delivery history for a webhook
   */
  async getDeliveries(userId: string, webhookId: string): Promise<WebhookDelivery[]> {
    // Verify ownership
    const { data: webhook } = await supabase
      .from('webhooks')
      .select('id')
      .eq('id', webhookId)
      .eq('user_id', userId)
      .single();

    if (!webhook) {
      throw new Error('Webhook not found or access denied');
    }

    const { data, error } = await supabase
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
    const { data: deliveries, error } = await supabase
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
}

export const webhookService = new WebhookService();
