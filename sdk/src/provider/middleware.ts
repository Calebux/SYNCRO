import { pricing, type RoutePricing, type PricingDeclarationInput, type RoutePricingRule } from './pricing.js';

// ── Manifest types (inlined to keep the middleware self-contained) ───────────

/**
 * Minimal asset descriptor included in the provider manifest (issue #1828).
 */
export interface ManifestAssetDescriptor {
  asset: string;
  network: string;
  scheme: string;
  contract?: string;
}

/**
 * Minimal route descriptor included in the provider manifest (issue #1828).
 */
export interface ManifestRouteDescriptor {
  routeId?: string;
  pathPattern: string;
  method: string;
  unit: string;
  priceStroops?: number;
  price?: number;
  currency?: string;
  maxBillableUnits?: number;
  rateCardVersion?: string;
  effectiveFrom?: string;
}

/**
 * Minimal receipt key entry included in the provider manifest (issue #1828).
 * Mirrors ReceiptPublicKeyEntry from the backend ReceiptService.
 */
export interface ManifestReceiptKeyEntry {
  keyId: string;
  status: 'current' | 'previous';
  publicKeyPem: string;
  rotatedAt?: string;
}

/**
 * SyncroProviderManifest v1.0 — the wire shape the SDK provider middleware
 * serves at `GET /__syncro/manifest` and
 * `GET /.well-known/syncro/:providerId` (issue #1828).
 */
export interface SyncroProviderManifest {
  manifestVersion: '1.0';
  providerId?: string;
  identity?: string;
  gatewayUrl: string;
  mode: 'staging' | 'production';
  acceptedAssets: ManifestAssetDescriptor[];
  routes: ManifestRouteDescriptor[];
  receiptKeys: ManifestReceiptKeyEntry[];
  termsUrl: string;
  generatedAt: string;
}

export interface SyncroReceipt {
  id: string;
  timestamp: string;
  route: string;
  method: string;
  amount: number;
  currency: string;
  payer?: string;
  signature?: string;
  status: 'settled' | 'metered' | 'free';
  nonce?: string;
}

export type FailureMode = 'serve-free' | 'reject';

/** Minimal HTTP request surface the metering core needs. Framework adapters map their own types onto this. */
export interface MeteredRequest {
  method?: string;
  path?: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
  locals?: Record<string, unknown>;
}

/** Minimal HTTP response surface the metering core needs. */
export interface MeteredResponse {
  locals?: Record<string, unknown>;
  setHeader?: (name: string, value: string) => void;
  status?: (code: number) => { json: (body: unknown) => unknown };
}

export type MeteredNext = (err?: unknown) => unknown;

export type FailureHandler<Req extends MeteredRequest = MeteredRequest, Res extends MeteredResponse = MeteredResponse> = (
  error: Error,
  req: Req,
  res: Res,
  next: MeteredNext,
) => void;

export interface MeteredOptions<Req extends MeteredRequest = MeteredRequest, Res extends MeteredResponse = MeteredResponse> {
  apiKey?: string;
  baseURL?: string;
  onFailure?: FailureMode | FailureHandler<Req, Res>;
  headerName?: string;
  receiptHeaderName?: string;
  verifyProof?: (proof: string | undefined, cost: RoutePricingRule, req: Req) => Promise<boolean> | boolean;
  meterCall?: (receipt: SyncroReceipt, req: Req) => Promise<void> | void;
  /**
   * Optional manifest to serve at `GET /__syncro/manifest` (and
   * `GET /.well-known/syncro/<providerId>` when `providerId` is set).
   *
   * When present the middleware intercepts these paths and responds with the
   * manifest before the payment check, so a consumer agent can discover the
   * provider's prices and receipt-signing keys without making a paid call
   * (issue #1828).
   *
   * Pass a static object or an async factory (called once per request so the
   * provider can serve a live snapshot from its own registry).
   */
  manifest?: SyncroProviderManifest | (() => SyncroProviderManifest | Promise<SyncroProviderManifest>);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Process-wide counter of requests served free because metering failed while
 * `failureMode: 'serve-free'` was active. Providers can read this to see the
 * cost of serving free on metering outages.
 */
export const servedFreeStats = {
  count: 0,
};

let serveFreeWarningLogged = false;

function warnServeFreeOnce(): void {
  if (serveFreeWarningLogged) return;
  serveFreeWarningLogged = true;
  console.warn(
    '[SyncroSDK] failureMode "serve-free" is active: requests will be served free when SYNCRO metering is unreachable. ' +
    'This gives away your API on outages. Set onFailure: "reject" (the default) to return 503 instead.',
  );
}

export function metered<
  Req extends MeteredRequest = MeteredRequest,
  Res extends MeteredResponse = MeteredResponse,
>(
  pricingInput: RoutePricing | PricingDeclarationInput,
  options: MeteredOptions<Req, Res> = {},
): (req: Req, res: Res, next: MeteredNext) => Promise<unknown> {
  const routePricing = typeof pricingInput === 'object' && pricingInput !== null && 'match' in pricingInput
    ? (pricingInput as RoutePricing)
    : pricing(pricingInput as PricingDeclarationInput);

  const failureMode: FailureMode = typeof options.onFailure === 'string'
    ? options.onFailure
    : 'reject';

  if (failureMode === 'serve-free') {
    warnServeFreeOnce();
  }

  const headerName = options.headerName || 'X-Syncro-Payment-Proof';
  const receiptHeaderName = options.receiptHeaderName || 'X-Syncro-Receipt';

  return async (req: Req, res: Res, next: MeteredNext) => {
    const method = req.method ?? '';
    const path = req.path || req.url?.split('?')[0] || '/';

    // ── Manifest intercept (issue #1828) ──────────────────────────────────
    // Serve the manifest at `GET /__syncro/manifest` and
    // `GET /.well-known/syncro/:providerId` (any path ending in that prefix).
    // This runs before the payment check so consumers can discover prices
    // without any paid credential.
    if (options.manifest && method.toUpperCase() === 'GET') {
      const isManifestPath =
        path === '/__syncro/manifest' ||
        path.startsWith('/__syncro/manifest?') ||
        path.startsWith('/.well-known/syncro/');

      if (isManifestPath) {
        try {
          const manifest =
            typeof options.manifest === 'function'
              ? await options.manifest()
              : options.manifest;

          if (typeof res.setHeader === 'function') {
            res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
            res.setHeader('Content-Type', 'application/json');
          }
          if (typeof res.status === 'function') {
            return res.status(200).json({ data: manifest });
          }
          // Fallback: attach manifest to locals and continue
          res.locals = res.locals || {};
          res.locals.syncroManifest = manifest;
          return next();
        } catch (err) {
          if (typeof res.status === 'function') {
            return res.status(503).json({
              error: 'Service Unavailable',
              message: 'Manifest generation failed',
            });
          }
          return next(err);
        }
      }
    }
    // ── End manifest intercept ────────────────────────────────────────────
    const costRule = routePricing.match(method, path);

    if (costRule.price <= 0) {
      const receipt: SyncroReceipt = {
        id: `rcpt_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        route: path,
        method,
        amount: 0,
        currency: costRule.currency || routePricing.currency,
        status: 'free',
      };
      if (typeof res.setHeader === 'function') {
        res.setHeader(receiptHeaderName, JSON.stringify(receipt));
      }
      res.locals = res.locals || {};
      res.locals.syncroReceipt = receipt;
      return next();
    }

    const headers = req.headers ?? {};
    const proof = headerValue(headers[headerName.toLowerCase()]) ||
                  headerValue(headers[headerName]) ||
                  headerValue(headers['authorization'])?.replace(/^Bearer\s+/i, '') ||
                  headerValue(headers['payment-signature']);

    try {
      let isVerified = false;
      if (options.verifyProof) {
        isVerified = await options.verifyProof(proof, costRule, req);
      } else {
        if (proof && typeof proof === 'string' && proof.length > 0) {
          isVerified = true;
        } else {
          isVerified = false;
        }
      }

      if (!isVerified) {
        const paymentRequiredPayload = {
          x402Version: 2,
          error: 'Payment proof required or invalid',
          resource: {
            url: req.originalUrl || path,
            description: costRule.description || `Call to ${path}`,
          },
          accepts: [{
            scheme: 'exact',
            amount: String(costRule.price),
            asset: costRule.currency || routePricing.currency,
            payTo: options.apiKey ? 'syncro-provider' : 'gateway',
          }]
        };

        if (typeof res.setHeader === 'function') {
          res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequiredPayload)).toString('base64'));
        }

        if (typeof res.status === 'function') {
          return res.status(402).json({
            error: 'Payment Required',
            message: 'Valid payment proof (X-Syncro-Payment-Proof or PAYMENT-SIGNATURE) is required',
            required: costRule,
          });
        }
        return next(new Error('Payment Required'));
      }

      const receipt: SyncroReceipt = {
        id: `rcpt_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        route: path,
        method,
        amount: costRule.price,
        currency: costRule.currency || routePricing.currency,
        ...(proof === undefined ? {} : { payer: proof }),
        status: 'settled',
      };

      if (typeof res.setHeader === 'function') {
        res.setHeader(receiptHeaderName, JSON.stringify(receipt));
      }
      res.locals = res.locals || {};
      res.locals.syncroReceipt = receipt;

      if (options.meterCall) {
        await options.meterCall(receipt, req);
      }

      return next();
    } catch (err: unknown) {
      if (typeof options.onFailure === 'function') {
        return options.onFailure(toError(err), req, res, next);
      }

      if (failureMode === 'serve-free') {
        servedFreeStats.count += 1;
        console.warn('[SyncroSDK] SYNCRO verification/metering unreachable, serving free per failure mode:', errorMessage(err));
        const freeReceipt: SyncroReceipt = {
          id: `rcpt_free_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          route: path,
          method,
          amount: 0,
          currency: costRule.currency || routePricing.currency,
          status: 'free',
        };
        if (typeof res.setHeader === 'function') {
          res.setHeader(receiptHeaderName, JSON.stringify(freeReceipt));
        }
        res.locals = res.locals || {};
        res.locals.syncroReceipt = freeReceipt;
        return next();
      } else {
        if (typeof res.setHeader === 'function') {
          res.setHeader('Retry-After', '5');
        }
        if (typeof res.status === 'function') {
          return res.status(503).json({
            error: 'Service Unavailable',
            message: 'SYNCRO payment verification gateway unreachable',
            retryAfter: 5,
            details: errorMessage(err),
          });
        }
        return next(err);
      }
    }
  };
}
