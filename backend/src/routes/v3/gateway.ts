import { Router, Response } from 'express';
import {
  createGatewayLifecycle,
  GatewayRequest,
  meterReservationTracker,
  UpstreamProvider,
} from '../../services/v3/gateway-lifecycle';
import {
  generatePaymentChallenge,
  parsePaymentProof,
  verifyPaymentProof,
} from '../../services/v3/payment-challenge-service';
import { spendCapService } from '../../services/v3/spend-cap-service';
import { unitEconomicsService } from '../../services/v3/unit-economics-service';

export function createV3GatewayRouter(customUpstream?: UpstreamProvider): Router {
  const router = Router();
  const lifecycle = createGatewayLifecycle();

  /**
   * Main Paid-Request Gateway Endpoint
   * Sequence:
   * 1. resolveIdentity
   * 2. resolveRouteAndPrice
   * 3. checkScope
   * 4. checkCap
   * 5. verifyPayment
   * 6. reserveMeter
   * 7. proxyAndCommit
   */
  router.post(
    '/proxy',
    lifecycle.resolveIdentity,
    lifecycle.resolveRouteAndPrice,
    lifecycle.checkScope,
    lifecycle.checkCap,
    lifecycle.verifyPayment,
    lifecycle.reserveMeter,
    lifecycle.proxyAndCommit(customUpstream)
  );

  /**
   * Explicit Challenge endpoint (402 generation)
   */
  router.get('/challenge', (req, res: Response) => {
    const { challenge, headerValue } = generatePaymentChallenge({
      settlementAsset: (req.query.asset as string) || undefined,
      amount: (req.query.amount as string) || undefined,
      rate: (req.query.rate as string) || undefined,
      channelAddress: (req.query.channel as string) || undefined,
      contract: (req.query.contract as string) || undefined,
      chain: (req.query.chain as string) || undefined,
    });
    res.setHeader('PAYMENT-REQUIRED', headerValue);
    return res.status(402).json({
      error: 'Payment required: machine-readable payment instruction challenge',
      challenge,
    });
  });

  /**
   * Unit economics & batching policy metrics endpoint
   */
  router.get('/economics/:providerId', (req, res: Response) => {
    const providerId = req.params.providerId;
    const targetPrice = Number(req.query.targetPrice || 10);
    const recommendation = unitEconomicsService.deriveBatchingPolicy(providerId, targetPrice);
    const alerts = unitEconomicsService.getAlerts().filter((a) => a.providerId === providerId);
    return res.json({
      success: true,
      data: {
        recommendation,
        alerts,
      },
    });
  });

  return router;
}

export default createV3GatewayRouter();
