import { Router, Request, Response } from 'express';
import { join } from 'node:path';
import { z } from 'zod';
import { InMemoryProviderStore } from '../v3/provider-store';
import { ReceiptService } from '../v3/receipt-service';
import { ScopeEnforcer } from '../v3/scope-enforcer';
import { InMemoryAgentRegistryReader, UpstreamCaller, V3GatewayService } from '../v3/gateway-service';
import { counterStoreHealth } from '../v3/counter-store-health';
import { createDegradedAlertHandler } from '../v3/degraded-alerts';
import { InMemoryMeter } from '../../../packages/metering/src/meter';
import { DegradedAdmissionController } from '../../../packages/metering/src/degraded-admission';
import { FileDegradedUsageLog } from '../../../packages/metering/src/degraded-log';
import { RateLimiter } from '../../../packages/metering/src/rate-limit';

const degradedModeFields = {
  failMode: z.enum(['fail_open', 'fail_closed']).optional(),
  /** Value the provider may serve unbilled during one outage (#1444). */
  exposureCeiling: z.number().finite().min(0).optional(),
};

const rateLimitFields = {
  /** Requests allowed per interval at steady state (#1447). */
  requestsPerInterval: z.number().finite().min(0).optional(),
  /** Length of the interval in milliseconds (#1447). */
  intervalMs: z.number().finite().positive().optional(),
  /** Burst headroom refilled at the same rate (#1447). */
  burstAllowance: z.number().finite().min(0).optional(),
};

const registerProviderSchema = z.object({
  identity: z.string().min(1),
  payoutAddress: z.string().min(1),
  upstreamBaseUrl: z.string().url(),
  agreementTerms: z.string().min(1),
  mode: z.enum(['staging', 'production']).default('staging'),
  degradedMode: z.object(degradedModeFields).optional(),
  /** Per-provider per-route burst limit; platform default until overridden (#1447). */
  rateLimit: z.object(rateLimitFields).optional(),
});

const registerRouteSchema = z.object({
  pathPattern: z.string().min(1),
  method: z.string().min(1),
  unit: z.string().min(1),
  price: z.number().positive(),
  quantityExtractor: z.string().min(1).default('constant:1'),
  /** Per-route rate-limit override; inherits the provider default (#1447). */
  rateLimit: z.object(rateLimitFields).optional(),
});

const reviseRouteSchema = z
  .object({
    pathPattern: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
    price: z.number().positive().optional(),
    quantityExtractor: z.string().min(1).optional(),
    rateLimit: z.object(rateLimitFields).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'at least one route field is required',
  });

const payoutAddressSchema = z.object({
  payoutAddress: z.string().min(1),
});

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function sendServiceError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'request failed';
  const status = message === 'provider not found' || message === 'route not found' ? 404 : 400;
  return res.status(status).json({ error: message });
}

const paidCallSchema = z.object({
  providerId: z.string().uuid(),
  path: z.string().min(1),
  upstreamMethod: z.string().min(1).default('POST'),
  quantity: z.number().positive().optional(),
  channelId: z.string().min(1),
  stateNonce: z.number().int().nonnegative(),
  rateCardVersion: z.string().min(1),
  exchangeRate: z.number().positive().optional().nullable(),
  body: z.unknown().optional(),
});

const grantSchema = z.object({
  agentId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  expiresAt: z.string().datetime().nullable().optional(),
  revokedAt: z.string().datetime().nullable().optional(),
});

const degradedModePolicySchema = z
  .object(degradedModeFields)
  .refine((value) => value.failMode !== undefined || value.exposureCeiling !== undefined, {
    message: 'at least one policy field is required',
  });

const rateLimitPolicySchema = z
  .object(rateLimitFields)
  .refine(
    (value) =>
      value.requestsPerInterval !== undefined ||
      value.intervalMs !== undefined ||
      value.burstAllowance !== undefined,
    {
      message: 'at least one policy field is required',
    },
  );

const registryReader = new InMemoryAgentRegistryReader();
const providerStore = new InMemoryProviderStore();
const scopeEnforcer = new ScopeEnforcer(registryReader, {
  cacheTtlMs: 5_000,
  cacheSoftTtlMs: 2_500,
});
const receiptService = new ReceiptService();
const upstreamCaller: UpstreamCaller = {
  async call({ upstreamBaseUrl, method, path, body }) {
    const runtimeFetch = (globalThis as unknown as { fetch?: (...args: any[]) => Promise<any> }).fetch;
    if (!runtimeFetch) {
      throw new Error('fetch is not available in this runtime');
    }
    const target = new URL(path, upstreamBaseUrl).toString();
    const response = await runtimeFetch(target, {
      method: method.toUpperCase(),
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = await response.text();
    }
    return {
      status: response.status,
      body: payload,
    };
  },
};

/**
 * Everything served unbilled while the counter store was down lands here
 * (#1444). The path is configurable because reconciliation runs from wherever
 * the gateway runs; the default keeps it next to the other local state.
 */
const degradedUsageLog = new FileDegradedUsageLog(
  process.env.METER_DEGRADED_LOG_PATH ??
    join(process.cwd(), 'data', 'metering', 'degraded-usage.jsonl'),
);

/**
 * Counter-store outage admission (#1444). The policy is per provider — cheap
 * high-volume routes fail open within a budget, expensive ones fail closed —
 * and every transition pages the operator.
 */
const degradedAdmission = new DegradedAdmissionController({
  isCounterStoreAvailable: () => counterStoreHealth.isAvailable(),
  log: degradedUsageLog,
  onEvent: createDegradedAlertHandler(),
});

/**
 * Per-agent x route burst rate limiting (#1447). The service installs each
 * route's effective policy (route override ?? provider default) the moment a
 * provider registers or revises a route, so nothing is ever served unlimited.
 */
const rateLimiter = new RateLimiter();
const meter = new InMemoryMeter();

const service = new V3GatewayService(
  providerStore,
  scopeEnforcer,
  receiptService,
  upstreamCaller,
  meter,
  degradedAdmission,
  rateLimiter,
);

const router = Router();

router.post('/providers', (req: Request, res: Response) => {
  const parsed = registerProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const provider = service.registerProvider(parsed.data);
  return res.status(201).json({ data: provider });
});

router.get('/providers/:providerId', (req: Request, res: Response) => {
  try {
    return res.json({ data: service.readProvider(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.patch('/providers/:providerId/payout-address', (req: Request, res: Response) => {
  const parsed = payoutAddressSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const provider = service.updatePayoutAddress(routeParam(req.params.providerId), parsed.data.payoutAddress);
    return res.json({ data: provider });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/**
 * Re-policy what this provider does while the counter store is down (#1444):
 * fail open (serve unbilled) or fail closed (refuse), and how much value it
 * may serve unbilled during a single outage.
 */
router.patch('/providers/:providerId/degraded-mode-policy', (req: Request, res: Response) => {
  const parsed = degradedModePolicySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const provider = service.updateDegradedModePolicy(
      routeParam(req.params.providerId),
      parsed.data,
    );
    return res.json({ data: provider.degradedMode });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'update failed';
    if (message === 'no degraded mode changes') {
      return res.status(400).json({ error: message });
    }
    return sendServiceError(res, error);
  }
});

/**
 * Re-policy this provider's per-route burst limits (#1447). Routes with their
 * own override keep it; routes inheriting the provider default pick up the
 * change immediately.
 */
router.patch('/providers/:providerId/rate-limit', (req: Request, res: Response) => {
  const parsed = rateLimitPolicySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const provider = service.updateRateLimit(
      routeParam(req.params.providerId),
      parsed.data,
    );
    return res.json({ data: provider.rateLimit });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'update failed';
    if (message === 'no rate limit changes') {
      return res.status(400).json({ error: message });
    }
    return sendServiceError(res, error);
  }
});

/**
 * Current degraded posture (#1444): whether the counter store is down, which
 * providers are refusing, and how much unbilled exposure each has spent.
 * This is the endpoint the console reads.
 */
router.get('/gateway/degraded', (_req: Request, res: Response) => {
  return res.json({
    data: {
      ...degradedAdmission.snapshot(),
      counterStoreAvailable: counterStoreHealth.isAvailable(),
      logPath: degradedUsageLog.filePath,
    },
  });
});

router.get('/providers/:providerId/routes', (req: Request, res: Response) => {
  try {
    return res.json({ data: service.listRoutes(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.patch('/providers/:providerId/routes/:routeId', (req: Request, res: Response) => {
  const parsed = reviseRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const result = service.reviseRoute(routeParam(req.params.providerId), routeParam(req.params.routeId), parsed.data);
    return res.json({ data: result });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.get('/providers/:providerId/rate-cards', (req: Request, res: Response) => {
  try {
    return res.json({ data: service.listRateCards(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.get('/providers/:providerId/settlements', (req: Request, res: Response) => {
  try {
    return res.json({ data: service.listSettlements(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.get('/providers/:providerId/revenue', (req: Request, res: Response) => {
  try {
    return res.json({ data: service.revenue(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.post('/providers/:providerId/payout-challenge', (req: Request, res: Response) => {
  try {
    const result = service.createPayoutChallenge(routeParam(req.params.providerId));
    return res.json({ data: result });
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : 'not found' });
  }
});

router.post('/providers/:providerId/payout-verify', (req: Request, res: Response) => {
  const signature = req.body?.signature;
  if (typeof signature !== 'string' || signature.length === 0) {
    return res.status(400).json({ error: 'signature is required' });
  }
  try {
    const provider = service.verifyPayoutChallenge(routeParam(req.params.providerId), signature);
    return res.json({ data: provider });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'verification failed' });
  }
});

router.post('/providers/:providerId/routes', (req: Request, res: Response) => {
  const parsed = registerRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const route = service.registerRoute({
      providerId: routeParam(req.params.providerId),
      ...parsed.data,
    });
    return res.status(201).json({ data: route });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'registration failed' });
  }
});

router.post('/gateway/paid', async (req: Request, res: Response) => {
  const parsed = paidCallSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const agentId = req.header('x-syncro-agent-id');
  if (!agentId) {
    return res.status(401).json({ error: 'missing x-syncro-agent-id' });
  }

  try {
    const result = await service.processPaidCall({
      providerId: parsed.data.providerId,
      method: parsed.data.upstreamMethod,
      path: parsed.data.path,
      body: parsed.data.body,
      query: req.query as Record<string, unknown>,
      agentId,
      quantity: parsed.data.quantity,
      exchangeRate: parsed.data.exchangeRate,
      channelId: parsed.data.channelId,
      stateNonce: parsed.data.stateNonce,
      rateCardVersion: parsed.data.rateCardVersion,
    });

    const receiptUrl = `/api/v3/receipts/${result.receipt.receiptId}`;
    if (result.inlineReceiptHeader) {
      res.setHeader('X-SYNCRO-RECEIPT', result.inlineReceiptHeader);
    }
    res.setHeader('X-SYNCRO-RECEIPT-URL', receiptUrl);
    // The call was served while the counter store was down: tell the agent so
    // it can decide whether to keep going on a meter it cannot see (#1444).
    if (result.meterDegraded) {
      res.setHeader('X-Meter-Degraded', '1');
    }
    return res.status(result.upstream.status).json(result.upstream.body);
  } catch (error) {
    if (service.isScopeError(error)) {
      return res.status(403).json({
        error: error.code,
        message: error.message,
      });
    }

    // Counter store down and the provider's policy refuses this call (#1444).
    // 503 + Retry-After is the taxonomy's GATEWAY_METER_DEGRADED contract, so
    // the SDK retries it instead of surfacing a hard failure.
    if (service.isMeterDegradedError(error)) {
      return res
        .status(error.status)
        .set('Retry-After', String(error.retryAfterSeconds))
        .json({
          error: error.code,
          code: error.code,
          message: error.message,
          reason: error.reason,
        });
    }

    // Per-agent rate limit exceeded (#1447). 429 + Retry-After is the
    // taxonomy's GATEWAY_RATE_LIMITED contract: a back-off hint, not a
    // rejection of the agent's funds.
    if (service.isMeterRateLimitedError(error)) {
      return res
        .status(error.status)
        .set('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))))
        .json({
          error: error.code,
          code: error.code,
          message: error.message,
          route: error.route,
          retryAfterMs: error.retryAfterMs,
          action: error.action,
        });
    }

    // Out of metering headroom (#1447). 402 GATEWAY_METER_INSUFFICIENT — the
    // "fund me" rejection, deliberately distinct from the "slow down" above.
    if (service.isMeterInsufficientFundsError(error)) {
      return res.status(error.status).json({
        error: error.code,
        code: error.code,
        message: error.message,
        route: error.route,
        available: error.available,
        needed: error.needed,
        limit: error.limit,
        action: error.action,
      });
    }

    const message = error instanceof Error ? error.message : 'paid request failed';
    return res.status(400).json({ error: message });
  }
});

router.post('/registry/grants', (req: Request, res: Response) => {
  if (process.env.ENABLE_TESTNET_ACTIONS !== 'true') {
    return res.status(403).json({
      error: 'grant seeding is disabled outside testnet staging mode',
    });
  }

  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  registryReader.setGrant({
    agentId: parsed.data.agentId,
    scopes: parsed.data.scopes,
    expiresAt: parsed.data.expiresAt ?? null,
    revokedAt: parsed.data.revokedAt ?? null,
  });
  scopeEnforcer.invalidate(parsed.data.agentId);
  return res.status(201).json({ data: parsed.data });
});

router.get('/receipts/:receiptId', (req: Request, res: Response) => {
  const receipt = service.getReceipt(routeParam(req.params.receiptId));
  if (!receipt) {
    return res.status(404).json({ error: 'receipt not found' });
  }
  return res.json({ data: receipt });
});

export default router;
export {
  registryReader,
  service as v3GatewayService,
  degradedAdmission,
  degradedUsageLog,
  rateLimiter,
  meter,
};

