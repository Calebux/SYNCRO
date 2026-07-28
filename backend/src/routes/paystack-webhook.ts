import { Router, Request, Response } from 'express';
import logger from '../config/logger';
import { verifyPaystackWebhook } from '../services/payment-webhook-verification';
import { supabase } from '../config/database';

const router = Router();

/**
 * POST /api/webhooks/paystack
 * Inbound Paystack webhook — verified via HMAC-SHA512.
 * Enforces idempotency to prevent double-processing on provider re-delivery.
 */
router.post('/', async (req: Request, res: Response) => {
  // Send 200 immediately to acknowledge receipt
  res.sendStatus(200);

  const signature = req.headers['x-paystack-signature'] as string | undefined;
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  const result = verifyPaystackWebhook(rawBody, signature, process.env.PAYSTACK_SECRET_KEY);

  if (!result.valid) {
    logger.warn('[PaystackWebhook] Rejected — invalid signature', { error: result.error });
    return;
  }

  const event = result.event as { event?: string; data?: Record<string, unknown> } | undefined;
  const eventType = event?.event;
  const data = event?.data;
  const reference = data?.reference as string | undefined;

  logger.info('[PaystackWebhook] Received verified event', {
    eventType,
    reference,
  });

  // Use reference as idempotency key
  if (!reference) {
    logger.warn('[PaystackWebhook] Missing reference, cannot enforce idempotency', { eventType });
    return;
  }

  // Check if we've already processed this event
  try {
    const { data: existingRecord, error: checkError } = await supabase
      .from('webhook_events')
      .select('id, processed_at')
      .eq('provider', 'paystack')
      .eq('event_id', reference)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      logger.error('[PaystackWebhook] Failed to check idempotency', {
        reference,
        error: checkError.message,
      });
      return;
    }

    if (existingRecord) {
      logger.info('[PaystackWebhook] Duplicate event detected, skipping', {
        reference,
        processedAt: existingRecord.processed_at,
      });
      return;
    }

    // Store webhook event BEFORE processing to prevent concurrent duplicate processing
    const { error: insertError, data: newRecord } = await supabase
      .from('webhook_events')
      .insert({
        provider: 'paystack',
        event_id: reference,
        event_type: eventType || 'unknown',
        event_data: event,
        processed: false,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) {
      // Check if it's a unique constraint violation (concurrent delivery)
      if (insertError.code === '23505') {
        logger.info('[PaystackWebhook] Concurrent delivery detected', { reference });
        return;
      }
      logger.error('[PaystackWebhook] Failed to store webhook event', {
        reference,
        error: insertError.message,
      });
      return;
    }

    // Process the event
    if (eventType === 'charge.success' && reference) {
      logger.info('[PaystackWebhook] charge.success processed', { reference });
      // TODO: Add payment processing logic here
    }

    // Mark event as processed
    await supabase
      .from('webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', newRecord.id);

  } catch (err) {
    logger.error('[PaystackWebhook] Error processing webhook', {
      reference,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
