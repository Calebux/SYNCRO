import { pricing, type RoutePricing, type PricingDeclarationInput, type RoutePricingRule } from './pricing.js';

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
    : 'serve-free';

  const headerName = options.headerName || 'X-Syncro-Payment-Proof';
  const receiptHeaderName = options.receiptHeaderName || 'X-Syncro-Receipt';

  return async (req: Req, res: Res, next: MeteredNext) => {
    const method = req.method ?? '';
    const path = req.path || req.url?.split('?')[0] || '/';
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
        if (typeof res.status === 'function') {
          return res.status(503).json({
            error: 'Service Unavailable',
            message: 'SYNCRO payment verification gateway unreachable',
            details: errorMessage(err),
          });
        }
        return next(err);
      }
    }
  };
}
