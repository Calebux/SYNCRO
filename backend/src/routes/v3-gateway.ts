import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { InMemoryProviderStore } from '../v3/provider-store';
import { ReceiptService } from '../v3/receipt-service';
import { ScopeEnforcer } from '../v3/scope-enforcer';
import { InMemoryAgentRegistryReader, UpstreamCaller, V3GatewayService } from '../v3/gateway-service';

const registerProviderSchema = z.object({
  identity: z.string().min(1),
  payoutAddress: z.string().min(1),
  upstreamBaseUrl: z.string().url(),
  agreementTerms: z.string().min(1),
  mode: z.enum(['staging', 'production']).default('staging'),
});

const registerRouteSchema = z.object({
  pathPattern: z.string().min(1),
  method: z.string().min(1),
  unit: z.string().min(1),
  price: z.number().positive(),
  quantityExtractor: z.string().min(1).default('constant:1'),
});

const reviseRouteSchema = z
  .object({
    pathPattern: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
    price: z.number().positive().optional(),
    quantityExtractor: z.string().min(1).optional(),
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

const service = new V3GatewayService(
  providerStore,
  scopeEnforcer,
  receiptService,
  upstreamCaller,
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
    return res.status(result.upstream.status).json(result.upstream.body);
  } catch (error) {
    if (service.isScopeError(error)) {
      return res.status(403).json({
        error: error.code,
        message: error.message,
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
export { registryReader, service as v3GatewayService };

