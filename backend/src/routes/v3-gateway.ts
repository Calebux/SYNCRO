import { Router, Request, Response } from 'express';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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

const dryRunRouteSchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
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

function sendRouteRegistrationError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'registration failed';
  if (message === 'route already registered for provider') {
    return res.status(409).json({ error: message });
  }
  return sendServiceError(res, error);
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
    // Re-check at call time to defeat DNS rebinding (#1612).
    await assertSafeUpstream(target);
    const response = await runtimeFetch(target, {
      method: method.toUpperCase(),
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Never follow redirects — a public host could 302 to a private one.
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get?.('location');
      if (location) {
        const redirectTarget = new URL(location, target).toString();
        await assertSafeUpstream(redirectTarget);
      }
      throw new Error('upstream redirects are not followed');
    }

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
    const provider =

/* … truncated 10376 chars — edit only what you need near the top … */
