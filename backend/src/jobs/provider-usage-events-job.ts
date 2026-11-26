import { createHmac } from 'crypto';
import cron from 'node-cron';
import { supabase } from '../config/database';
import logger from '../config/logger';

interface OutboxRow {
  id: string;
  payload: Record<string, unknown>;
}

/** Drain the durable usage outbox into the configured webhook in bounded batches. */
export async function dispatchProviderUsageEvents(): Promise<number> {
  const endpoint = process.env.PROVIDER_USAGE_WEBHOOK_URL;
  const secret = process.env.PROVIDER_USAGE_WEBHOOK_SECRET;
  if (!endpoint && !secret) return 0;
  if (!endpoint || !secret) throw new Error('provider usage webhook URL and secret must be configured together');
  const url = new URL(endpoint);
  if ((url.protocol !== 'https:' && url.hostname !== 'localhost') || url.username || url.password) {
    throw new Error('provider usage webhook must be an HTTPS URL without embedded credentials');
  }

  const { data, error } = await supabase.rpc('claim_provider_usage_events', { p_limit: 100 });
  if (error) throw error;
  const rows = (data ?? []) as OutboxRow[];
  if (rows.length === 0) return 0;

  const events = rows.map((row) => ({ id: row.id, schemaVersion: '1.0.0', ...row.payload }));
  const body = JSON.stringify({ schemaVersion: '1.0.0', events });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-syncro-usage-signature': createHmac('sha256', secret).update(body).digest('hex'),
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`provider usage webhook returned HTTP ${response.status}`);

    const { error: ackError } = await supabase.from('provider_usage_event_outbox')
      .update({ status: 'delivered', delivered_at: new Date().toISOString(), locked_until: null, last_error: null })
      .in('id', rows.map((row) => row.id));
    if (ackError) throw ackError;
    return rows.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryAt = new Date(Date.now() + 30_000).toISOString();
    const { error: retryError } = await supabase.from('provider_usage_event_outbox')
      .update({ status: 'pending', available_at: retryAt, locked_until: null, last_error: message.slice(0, 1000) })
      .in('id', rows.map((row) => row.id));
    if (retryError) logger.error('[provider-usage-events] Failed to release outbox lease', { error: retryError.message });
    logger.warn('[provider-usage-events] Batch delivery failed; retained for retry', { count: rows.length, error: message });
    return 0;
  }
}

export function startProviderUsageEventsJob(): void {
  cron.schedule('* * * * *', async () => {
    try {
      const delivered = await dispatchProviderUsageEvents();
      if (delivered > 0) logger.info('[provider-usage-events] Batch delivered', { count: delivered });
    } catch (error) {
      logger.error('[provider-usage-events] Dispatch failed', { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
