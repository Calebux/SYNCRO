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
import { meteredRouteRegistry } from '../../services/v3/metering-units';
import { receiptService } from '../../v3/receipt-runtime';
import { createHmac, timingSafeEqual } from 'crypto';

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

/** How long a signed quote stays valid before it must be re-requested. */
const QUOTE_TTL_MS = 60_000;

/** Channel-independent rate limit for the side-effect-free quote endpoint. */
const QUOTE_RATE_LIMIT_WINDOW_MS = 60_000;
const QUOTE_RATE_LIMIT_MAX = 120;

const quoteRequestSchema = z
  .object({
    method: z.string().min(1).max(16),
    path: z.string().min(1).max(2048),
    sizeHint: z.number().finite().nonnegative().optional(),
  })
  .strict();

interface SignedQuote {
  method: string;
  path: string;
  sizeHint: number | null;
  price: number;
  unit: string;
  asset: string;
  rateCardVersion: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

/** Deterministic serialization of the signed quote fields (excludes signature). */
function quoteSigningPayload(quote: Omit<SignedQuote, 'signature'>): string {
  return JSON.stringify([
    quote.method,
    quote.path,
    quote.sizeHint,
    quote.price,
    quote.unit,
    quote.asset,
    quote.rateCardVersion,
    quote.issuedAt,
    quote.expiresAt,
  ]);
}

function signQuote(quote: Omit<SignedQuote, 'signature'>): string {
  return receiptService.signMessage(quoteSigningPayload(quote));
}

function verifyQuoteSignature(quote: SignedQuote): boolean {
  const expected = signQuote({
    method: quote.method,
    path: quote.path,
    sizeHint: quote.sizeHint,
    price: quote.price,
    unit: quote.unit,
    asset: quote.asset,
    rateCardVersion: quote.rateCardVersion,
    issuedAt: quote.issuedAt,
    expiresAt: quote.expiresAt,
  });
  const a = Buffer.from(expected);
  const b = Buffer.from(quote.signature ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * In-memory, channel-independent fixed-window limiter keyed by client IP.
 * Quotes are free and unauthenticated, so they must be throttled without
 * requiring a channel identity.
 */
function makeQuoteRateLimiter() {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + QUOTE_RATE_LIMIT_WINDOW_MS };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > QUOTE_RATE_LIMIT_MAX) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: 'Too Many Requests', message: 'Quote rate limit exceeded' });
      return;
    }
    next();
  };
}

/**
 * Resolve the metered route a quote refers to. The quote path is the gateway
 * route (e.g. `/api/v3/gateway/proxy`); fall back to the bare route segment.
 */
function resolveQuoteRoute(path: string) {
  const normalized = path.split('?')[0].replace(/\/+$/, '');
  const direct = meteredRouteRegistry.getRouteConfig(normalized);
  if (direct) return direct;
  const segment = normalized.split('/').filter(Boolean).pop();
  if (!segment) return null;
  return meteredRouteRegistry.getRouteConfig(`/api/v3/gateway/${segment}`) ?? null;
}

/**
 * Compute the quoted price using the same rate-card math as the charge path so
 * constant-priced routes quote exactly what they will be billed.
 */
function computeQuotePrice(
  routeConfig: ReturnType<typeof meteredRouteRegistry.getRouteConfig>,
  sizeHint: number | undefined,
): number {
  const units = sizeHint ?? routeConfig.reservationBound;
  return Math.round(units * routeConfig.unitPrice * 100) / 100;
}

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
  const quoteRateLimiter = makeQuoteRateLimiter();

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
   *
   * The agent identity is resolved from the authenticated credential by
   * `lifecycle.resolveIdentity`; the `x-syncro-agent-id` header is only a hint
   * and must match the authenticated identity (enforced in resolveIdentity).
   */
  router.post('/proxy', ...middlewareStack);
  router.post('/inference', ...middlewareStack);
  router.post('/storage', ...middlewareStack);
  router.post('/compute', ...middlewareStack);

  /**
   * Explicit Challenge endpoint (402 generation)
   */
  router.get('/challenge', (req, res: Response) => {
    const query = z.object({
      routeId: z.enum(['proxy', 'inference', 'storage', 'compute']).optional(),
    }).strict().safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Only a valid routeId query parameter is accepted',
      });
    }

    const routeId = query.data.routeId ?? 'proxy';
    const routeConfig = meteredRouteRegistry.getRouteConfig(`/api/v3/gateway/${routeId}`);
    const amount = Math.round(routeConfig.reservationBound * routeConfig.unitPrice * 100) / 100;
    const contract = process.env.SOROBAN_CONTRACT_ADDRESS;
    if (!contract) {
      return res.status(503).json({
        error: 'Payment challenge unavailable',
        message: 'No payment contract is configured for this network',
      });
    }

    const { challenge, headerValue } = generatePaymentChallenge({
      settlementAsset: routeConfig.settlementAsset,
      amount: String(amount),
      rate: String(routeConfig.unitPrice),
      contract,
      chain: `stellar:${process.env.STELLAR_NETWORK ?? 'testnet'}`,
    }, (message) => receiptService.signMessage(message));
    res.setHeader('PAYMENT-REQUIRED', headerValue);
    return res.status(402).json({
      error: 'Payment required: machine-readable payment instruction challenge',
      challenge,
    });
  });

  /**
   * Side-effect-free quote endpoint (#1845).
   *
   * Prices a prospective call from the rate card without reserving meters or
   * touching the payment lifecycle. The returned quote is signed so a later
   * dispute can reference it, and carries an expiry that is enforced if the
   * quote is presented again.
   */
  router.post('/quote', quoteRateLimiter, (req: Request, res: Response) => {
    const parsed = quoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'method, path and an optional non-negative sizeHint are required',
      });
    }

    const { method, path, sizeHint } = parsed.data;
    const routeConfig = resolveQuoteRoute(path);
    if (!routeConfig) {
      return res.status(404).json({ error: 'Not Found', message: 'No metered route matches this path' });
    }

    const issuedAt = Date.now();
    const expiresAt = issuedAt + QUOTE_TTL_MS;
    const unsigned: Omit<SignedQuote, 'signature'> = {
      method: method.toUpperCase(),
      path,
      sizeHint: sizeHint ?? null,
      price: computeQuotePrice(routeConfig, sizeHint),
      unit: routeConfig.unit,
      asset: routeConfig.settlementAsset,
      rateCardVersion: routeConfig.version,
      issuedAt,
      expiresAt,
    };
    const quote: SignedQuote = { ...unsigned, signature: signQuote(unsigned) };

    return res.status(200).json({
      success: true,
      data: {
        price: quote.price,
        unit: quote.unit,
        asset: quote.asset,
        rateCardVersion: quote.rateCardVersion,
        expiresAt: new Date(quote.expiresAt).toISOString(),
        quote,
      },
    });
  });

  /**
   * Validate a previously issued quote. Rejects tampered or expired quotes so a
   * stale price cannot be presented as the basis for a charge.
   */
  router.post('/quote/verify', quoteRateLimiter, (req: Request, res: Response) => {
    const parsed = z
      .object({
        method: z.string().min(1).max(16),
        path: z.string().min(1).max(2048),
        sizeHint: z.number().finite().nonnegative().nullable().optional(),
        price: z.number().finite().nonnegative(),
        unit: z.string(),
        asset: z.string(),
        rateCardVersion: z.string(),
        issuedAt: z.number().int().nonnegative(),
        expiresAt: z.number().int().nonnegative(),
        signature: z.string().min(1),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation Error', message: 'Malformed quote' });
    }

    const quote: SignedQuote = { ...parsed.data, sizeHint: parsed.data.sizeHint ?? null };
    if (!verifyQuoteSignature(quote)) {
      return res.status(400).json({ error: 'Invalid quote', message: 'Quote signature does not verify' });
    }
    if (Date.now() > quote.expiresAt) {
      return res.status(410).json({ error: 'Quote expired', message: 'This quote is no longer valid' });
    }

    return res.json({ success: true, data: { valid: true, quote } });
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
