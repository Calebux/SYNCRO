import { Router, Request, Response, NextFunction } from 'express';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { InMemoryProviderStore } from '../v3/provider-store';
import { receiptService } from '../v3/receipt-runtime';
import { ScopeEnforcer } from '../v3/scope-enforcer';
import { InMemoryAgentRegistryReader, UpstreamCaller, V3GatewayService } from '../v3/gateway-service';
import { counterStoreHealth } from '../v3/counter-store-health';
import { createDegradedAlertHandler } from '../v3/degraded-alerts';
import { InMemoryMeter } from '../../../packages/metering/src/meter';
import { DegradedAdmissionController } from '../../../packages/metering/src/degraded-admission';
import { FileDegradedUsageLog } from '../../../packages/metering/src/degraded-log';
import { RateLimiter } from '../../../packages/metering/src/rate-limit';
import { sendGatewayError } from '../errors/gateway-error-response';
import { authenticateProvider } from '../middleware/provider-auth';
import { ROUTE_UNITS } from '../v3/pricing';

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

/**
 * SSRF guard (#1612). Provider `upstreamBaseUrl` values are attacker-supplied
 * and the gateway proxies to them from inside its own network, so we must
 * reject anything that resolves to loopback, RFC1918, link-local, or cloud
 * metadata ranges — for both IPv4 and IPv6 — and re-check at call time to
 * defeat DNS rebinding.
 */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  const inRange = (base: string, bits: number) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network
    inRange('10.0.0.0', 8) || // RFC1918
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local + AWS/GCP metadata
    inRange('172.16.0.0', 12) || // RFC1918
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.168.0.0', 16) || // RFC1918
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved + broadcast
  );
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) — unwrap and check the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (lower === '::' || lower === '::1') return true; // unspecified / loopback
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('64:ff9b:')) return true; // NAT64
  return false;
}

function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // unparseable — fail closed
}

async function assertSafeUpstream(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('upstreamBaseUrl is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('upstreamBaseUrl must use http or https');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('upstreamBaseUrl must use https in production');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) throw new Error('upstreamBaseUrl is missing a hostname');
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    throw new Error('upstreamBaseUrl points at a blocked host');
  }
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new Error('upstreamBaseUrl resolves to a blocked address');
    }
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error('upstreamBaseUrl hostname could not be resolved');
  }
  if (addresses.length === 0) {
    throw new Error('upstreamBaseUrl hostname could not be resolved');
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error('upstreamBaseUrl resolves to a blocked address');
    }
  }
}

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
  unit: z.enum(ROUTE_UNITS),
  priceStroops: z.number().int().positive().safe(),
  maxBillableUnits: z.number().int().positive().safe().optional(),
  quantityExtractor: z.string().min(1).default('constant:1'),
  /** Per-route rate-limit override; inherits the provider default (#1447). */
  rateLimit: z.object(rateLimitFields).optional(),
});

const reviseRouteSchema = z
  .object({
    pathPattern: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
    unit: z.enum(ROUTE_UNITS).optional(),
    priceStroops: z.number().int().positive().safe().optional(),
    maxBillableUnits: z.number().int().positive().safe().optional(),
    quantityExtractor: z.string().min(1).optional(),
    effectiveFrom: z.string().datetime().optional(),
    rateLimit: z.object(rateLimitFields).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'at least one route field is required',
  });

const dryRunRouteSchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
});

const payoutAddressSchema = z.object({
  payoutAddress: z.string().min(1),
  challengeId: z.string().uuid().optional(),
});

const payoutChangeSchema = z.object({
  newAddress: z.string().min(1),
  challengeId: z.string().uuid(),
  coolingOffMs: z.number().int().positive().default(86_400_000),
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

function sendRouteRegistrationError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'registration failed';
  if (message === 'route already registered for provider') {
    return res.status(409).json({ error: message });
  }
  return sendServiceError(res, error);
}

/**
 * Provider auth + authorization middleware for `:providerId` routes.
 *
 * - 401 when no `x-provider-key` header is present or the key is invalid.
 * - 403 when the authenticated provider does not own the `:providerId` in the route.
 *
 * The gateway's own paid-call endpoint (`POST /gateway/paid`) and
 * challenge endpoints are excluded from this guard because they use
 * agent-level auth / are intentionally public.
 */
function requireProviderAuth(req: Request, res: Response, next: NextFunction): void {
  const providerId = routeParam(req.params.providerId);
  if (!providerId) {
    return res.status(400).json({ error: 'providerId is required' });
  }

  const authenticatedProviderId = (req as any).provider?.providerId;
  if (!authenticatedProviderId) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Provider authentication required',
    });
  }

  if (authenticatedProviderId !== providerId) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Provider does not own the requested resource',
    });
  }

  next();
}

const paidCallSchema = z.object({
  providerId: z.string().uuid(),
  path: z.string().min(1),
  upstreamMethod: z.string().min(1).default('POST'),
  channelId: z.string().min(1),
  stateNonce: z.number().int().nonnegative(),
  exchangeRate: z.number().positive().optional().nullable(),
  body: z.unknown().optional(),
});

/**
 * FX boundary (#1418). The gateway owns the rate; callers never supply it.
 * Returns the rate plus provenance so the receipt can record which rate was
 * used and when it was observed (#1613).
 */
export interface FxRateQuote {
  rate: number;
  source: string;
  observedAt: string;
}

export type FxRateProvider = () => Promise<FxRateQuote> | FxRateQuote;

/**
 * Default FX boundary used when no provider is injected. Reads the rate from
 * the gateway's own configuration (rate card / FX oracle), never from the
 * request. Fails closed if no rate is configured.
 */
export const defaultFxRateProvider: FxRateProvider = () => {
  const raw = process.env.GATEWAY_FX_RATE;
  const rate = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('gateway FX rate is not configured');
  }
  return {
    rate,
    source: process.env.GATEWAY_FX_RATE_SOURCE ?? 'gateway-config',
    observedAt: new Date().toISOString(),
  };
};

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

// Provider auth middleware applied to all :providerId routes below.
// POST /providers (registration) is intentionally excluded — providers
// don't have a providerId yet.
router.use('/providers/:providerId', authenticateProvider(providerStore));

// ── Provider registration (public — no providerId yet) ──────────────

router.post('/providers', async (req: Request, res: Response) => {
  const parsed = registerProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    await assertSafeUpstream(parsed.data.upstreamBaseUrl);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'invalid upstreamBaseUrl' });
  }
  const provider = service.registerProvider(parsed.data);
  return res.status(201).json({ data: provider });
});

// ── Provider read (owner only) ──────────────────────────────────────

router.get('/providers/:providerId', requireProviderAuth, (req: Request, res: Response) => {
  try {
    return res.json({ data: service.readProvider(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

// ── Mutating provider routes (owner only) ──────────────────────────

router.patch('/providers/:providerId/payout-address', requireProviderAuth, async (req: Request, res: Response) => {
  const parsed = payoutAddressSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  if (!parsed.data.challengeId) {
    return res.status(400).json({ error: 'challengeId is required — a verified payout challenge is needed before changing the payout address' });
  }
  try {
    const change = await service.createPendingPayoutChange({
      providerId: routeParam(req.params.providerId),
      newAddress: parsed.data.payoutAddress,
      challengeId: parsed.data.challengeId,
      requestedBy: req.headers['x-syncro-agent-id'] as string ?? 'unknown',
      coolingOffMs: 86_400_000,
    });
    return res.status(201).json({ data: change });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

// ── Payout change flow (owner only) ─────────────────────────────────

router.post('/providers/:providerId/payout-change', requireProviderAuth, async (req: Request, res: Response) => {
  const parsed = payoutChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const change = await service.createPendingPayoutChange({
      providerId: routeParam(req.params.providerId),
      newAddress: parsed.data.newAddress,
      challengeId: parsed.data.challengeId,
      requestedBy: req.headers['x-syncro-agent-id'] as string ?? 'unknown',
      coolingOffMs: parsed.data.coolingOffMs,
    });
    return res.status(201).json({ data: change });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.post('/providers/:providerId/payout-change/:changeId/cancel', requireProviderAuth, async (req: Request, res: Response) => {
  try {
    const change = await service.cancelPendingPayoutChange({
      providerId: routeParam(req.params.providerId),
      changeId: routeParam(req.params.changeId),
      requestedBy: req.headers['x-syncro-agent-id'] as string ?? 'unknown',
    });
    return res.json({ data: change });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.post('/providers/:providerId/payout-change/:changeId/apply', requireProviderAuth, async (req: Request, res: Response) => {
  try {
    const provider = await service.applyPendingPayoutChange({
      providerId: routeParam(req.params.providerId),
      changeId: routeParam(req.params.changeId),
    });
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
router.patch('/providers/:providerId/degraded-mode-policy', requireProviderAuth, (req: Request, res: Response) => {
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
router.patch('/providers/:providerId/rate-limit', requireProviderAuth, (req: Request, res: Response) => {
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

// ── Provider-scoped read routes (owner only) ───────────────────────

router.get('/providers/:providerId/routes', requireProviderAuth, (req: Request, res: Response) => {
  try {
    return res.json({ data: service.listRoutes(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.patch('/providers/:providerId/routes/:routeId', requireProviderAuth, (req: Request, res: Response) => {
  const parsed = reviseRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const result = service.reviseRoute(routeParam(req.params.providerId), routeParam(req.params.routeId), parsed.data);
    return res.json({ data: result });
  } catch (error) {
    return sendRouteRegistrationError(res, error);
  }
});

router.get('/providers/:providerId/rate-cards', requireProviderAuth, (req: Request, res: Response) => {
  try {
    return res.json({ data: service.listRateCards(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.get('/providers/:providerId/settlements', requireProviderAuth, (req: Request, res: Response) => {
  try {
    return res.json({ data: service.listSettlements(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.get('/providers/:providerId/revenue', requireProviderAuth, (req: Request, res: Response) => {
  try {
    return res.json({ data: service.revenue(routeParam(req.params.providerId)) });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

// ── Challenge endpoints (public — deliberate decision, documented in route registry) ──

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

// ── Mutating route registration (owner only) ────────────────────────

router.post('/providers/:providerId/routes', requireProviderAuth, (req: Request, res: Response) => {
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
    return sendRouteRegistrationError(res, error);
  }
});

router.post('/providers/:providerId/routes/dry-run', requireProviderAuth, (req: Request, res: Response) => {
  const parsed = dryRunRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const match = service.dryRunRoute(
      routeParam(req.params.providerId),
      parsed.data.method,
      parsed.data.path,
    );
    if (!match) {
      return res.status(404).json({ error: 'no matching route' });
    }
    return res.json({ data: match });
  } catch (error) {
    return sendServiceError(res, error);
  }
});

// ── Gateway paid call (agent auth, not provider auth) ──────────────

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
      exchangeRate: parsed.data.exchangeRate,
      channelId: parsed.data.channelId,
      stateNonce: parsed.data.stateNonce,
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
    // Everything that reaches here is classified against the shared gateway
    // taxonomy (#1617): the client gets a stable `code`/status and the
    // taxonomy's public message, while the internal `message` is logged with
    // the request id and never echoed back.
    return sendGatewayError(res, error);
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

// Receipt lookup stays public (deliberate decision, documented in route registry)
router.get('/receipts/:receiptId', async (req: Request, res: Response) => {
  try {
    const receipt = await service.getReceipt(routeParam(req.params.receiptId));
    if (!receipt) {
      return res.status(404).json({ error: 'receipt not found' });
    }
    return res.json({ data: receipt });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to retrieve receipt',
    });
  }
});

export default router;
export {
  registryReader,
  service as v3GatewayService,
  degradedAdmission,
  degradedUsageLog,
  rateLimiter,
  meter,
  providerStore,
};
