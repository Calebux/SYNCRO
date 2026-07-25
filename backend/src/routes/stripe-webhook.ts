import { Router, Request, Response } from 'express';
import logger from '../config/logger';
import { verifyStripeWebhook } from '../services/payment-webhook-verification';

const router = Router();

/**
 * POST /api/webhooks/stripe
 * Inbound Stripe webhook — verified via stripe.webhooks.constructEvent.
 */
router.post('/', (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string | undefined;
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  const result = verifyStripeWebhook(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);

  if (!result.valid) {
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  const event = result.event as { type?: string; id?: string };
  logger.info('[StripeWebhook] Received verified event', { type: event?.type, id: event?.id });

  return res.json({ received: true });
});

export default router;
