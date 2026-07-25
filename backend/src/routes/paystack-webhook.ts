import { Router, Request, Response } from 'express';
import logger from '../config/logger';
import { verifyPaystackWebhook } from '../services/payment-webhook-verification';

const router = Router();

/**
 * POST /api/webhooks/paystack
 * Inbound Paystack webhook — verified via HMAC-SHA512.
 */
router.post('/', (req: Request, res: Response) => {
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

  logger.info('[PaystackWebhook] Received verified event', {
    eventType,
    reference: data?.reference,
  });

  if (eventType === 'charge.success' && data?.reference) {
    logger.info('[PaystackWebhook] charge.success processed', { reference: data.reference });
  }
});

export default router;
