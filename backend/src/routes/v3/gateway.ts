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

  const middlewareStack = [
    lifecycle.resolveIdentity,
    lifecycle.resolveRouteAndPrice,
    lifecycle.checkScope,
    lifecycle.checkCap,
    lifecycle.verifyPayment,
    lifecycle.reserveMeter,
    lifecycle.proxyAndCommit(customUpstream),
  ];

  /**
   * Paid-Request Gateway Endpoints (routed generically through the same lifecycle stack)
   * Supports:
   *  - Call-billed route (/proxy)
   *  - Token-billed route (/inference)
   *  - Byte-billed route (/storage)
   *  - Compute/seconds-billed route (/compute)
   */
  router.post('/proxy', ...middlewareStack);
  router.post('/inference', ...middlewareStack);
  router.post('/storage', ...middlewareStack);
  router.post('/compute', ...middlewareStack);

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
