import { Router, Request, Response } from 'express';
import logger from '../config/logger';
import { verifyPayPalWebhook } from '../services/payment-webhook-verification';

const router = Router();

/**
 * POST /api/webhooks/paypal
 * Inbound PayPal webhook — verified via PayPal verify-webhook-signature API.
 */
router.post('/', async (req: Request, res: Response) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);

  const result = await verifyPayPalWebhook(
    rawBody,
    {
      transmissionId: req.headers['paypal-transmission-id'] as string,
      transmissionTime: req.headers['paypal-transmission-time'] as string,
      certUrl: req.headers['paypal-cert-url'] as string,
      authAlgo: req.headers['paypal-auth-algo'] as string,
      transmissionSig: req.headers['paypal-transmission-sig'] as string,
    },
    {
      webhookId: process.env.PAYPAL_WEBHOOK_ID,
      clientId: process.env.PAYPAL_CLIENT_ID,
      clientSecret: process.env.PAYPAL_CLIENT_SECRET,
      mode: process.env.PAYPAL_MODE,
    },
  );

  if (!result.valid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = result.event as { event_type?: string; id?: string };
  logger.info('[PayPalWebhook] Received verified event', {
    eventType: event?.event_type,
    id: event?.id,
  });

  return res.json({ received: true });
});

export default router;
