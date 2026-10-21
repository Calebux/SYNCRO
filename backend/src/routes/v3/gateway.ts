import { Router, Request, Response, NextFunction } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { z } from 'zod';
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
import { optionalAuthenticate, AuthenticatedRequest, UserRole } from '../../middleware/auth';

/**
 * Minimal view of the provider registry needed to authorize the unit-economics
 * endpoint (#1619). Only the ownership key — the provider's Stellar payout
 * address — crosses this boundary.
 */
export interface ProviderDirectory {
  payoutAddressOf(providerId: string): string | null;
}

export interface V3GatewayRouterDeps {
  /**
   * Resolves a provider's payout address. Defaults to the in-process v3
   * provider registry, loaded lazily so this router's import graph stays free
   * of the heavier lifecycle module.
   */
  providers?: ProviderDirectory;
}

/** Challenge shape the owning provider must sign to read its economics. */
const ECONOMICS_CHALLENGE_PREFIX = 'syncro-provider-economics:';

/**
 * `targetPrice` must be a single, finite, positive number. `Number(x)` alone
 * accepts `NaN`/`Infinity`/arrays, so validate the raw query value instead of
 * coercing first (#1619).
 */
const targetPriceSchema = z.union([z.string(), z.number()]).pipe(
  z.coerce
    .number({ invalid_type_error: 'targetPrice must be a positive number' })
    .finite()
    .positive(),
);

function defaultProviderDirectory(): ProviderDirectory {
  // Lazy require keeps the v3 lifecycle module out of this router's imports
  // until the endpoint that needs it is actually called.
  const load = (): ProviderDirectory => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { v3GatewayService } = require('./v3-gateway') as {
      v3GatewayService: { readProvider(providerId: string): { payoutAddress: string } };
    };
    return {
      payoutAddressOf(providerId: string): string | null {
        try {
          return v3GatewayService.readProvider(providerId).payoutAddress;
        } catch {
          return null;
        }
      },
    };
  };

  let cached: ProviderDirectory | null = null;
  return {
    payoutAddressOf(providerId: string): string | null {
      cached ??= load();
      return cached.payoutAddressOf(providerId);
    },
  };
}

const OPERATOR_ROLES: UserRole[] = ['owner', 'operator', 'admin'];

/**
 * Authorize a read of a provider's economics: either an authenticated
 * operator/owner/admin, or a caller that proves control of the provider's
 * payout address by signing the challenge for that provider. Anything else is
 * rejected, so unauthenticated and cross-provider reads cannot leak margins.
 */
function makeEconomicsAuthorizer(providers: ProviderDirectory) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const providerId = req.params.providerId;

    // Optional auth: continues silently when no credentials are supplied so a
    // provider can instead prove ownership with a signed challenge below.
    await optionalAuthenticate(req, res, () => {});

    if (req.user && OPERATOR_ROLES.includes(req.user.role)) {
      next();
      return;
    }

    // Fall back to proof of payout-address control for the owning provider.
    const challenge = req.header('x-syncro-provider-challenge') ?? '';
    const signature = req.header('x-syncro-provider-signature') ?? '';
    if (!challenge || !signature) {
      res.status(403).json({ error: 'Forbidden', message: 'Not authorized for this provider' });
      return;
    }

    if (!challenge.startsWith(`${ECONOMICS_CHALLENGE_PREFIX}${providerId}:`)) {
      res.status(403).json({ error: 'Forbidden', message: 'Challenge is not bound to this provider' });
      return;
    }

    const payoutAddress = providers.payoutAddressOf(providerId);
    if (!payoutAddress) {
      res.status(404).json({ error: 'Not Found', message: 'Provider not found' });
      return;
    }

    let verified = false;
    try {
      verified = Keypair.fromPublicKey(payoutAddress).verify(
        Buffer.from(challenge),
        Buffer.from(signature, 'base64'),
      );
    } catch {
      verified = false;
    }

    if (!verified) {
      res.status(403).json({ error: 'Forbidden', message: 'Invalid provider signature' });
      return;
    }

    next();
  };
}

export function createV3GatewayRouter(
  customUpstream?: UpstreamProvider,
  deps: V3GatewayRouterDeps = {},
): Router {
  const router = Router();
  const lifecycle = createGatewayLifecycle();
  const providers = deps.providers ?? defaultProviderDirectory();
  const economicsAuthorizer = makeEconomicsAuthorizer(providers);

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
   * Unit economics & batching policy metrics endpoint (#1619).
   *
   * Restricted to authenticated operators and the owning provider — margins and
   * volume signals must not be readable by anyone who guesses a provider id.
   */
  router.get('/economics/:providerId', economicsAuthorizer, (req, res: Response) => {
    const providerId = req.params.providerId;

    const parsedTarget = targetPriceSchema.safeParse(req.query.targetPrice ?? 10);
    if (!parsedTarget.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'targetPrice must be a positive number',
      });
    }
    const targetPrice = parsedTarget.data;

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
