import type { SyncroSDK } from '../index.js';
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

export type FailureHandler = (error: Error, req: any, res: any, next: any) => void;

export interface MeteredOptions {
  sdk?: SyncroSDK;
  apiKey?: string;
  baseURL?: string;
  onFailure?: FailureMode | FailureHandler;
  headerName?: string;
  receiptHeaderName?: string;
  verifyProof?: (proof: string, cost: RoutePricingRule, req: any) => Promise<boolean> | boolean;
  meterCall?: (receipt: SyncroReceipt, req: any) => Promise<void> | void;
}

export function metered(
  pricingInput: RoutePricing | PricingDeclarationInput,
  options: MeteredOptions = {}
): (req: any, res: any, next: any) => Promise<any> {
  const routePricing = typeof pricingInput === 'object' && pricingInput !== null && 'match' in pricingInput
    ? (pricingInput as RoutePricing)
    : pricing(pricingInput as any);

  const failureMode: FailureMode = typeof options.onFailure === 'string'
    ? options.onFailure
    : 'serve-free';

  const headerName = options.headerName || 'X-Syncro-Payment-Proof';
  const receiptHeaderName = options.receiptHeaderName || 'X-Syncro-Receipt';

  return async (req: any, res: any, next: any) => {
    const method = req.method;
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

    const proof = req.headers?.[headerName.toLowerCase()] ||
                  req.headers?.[headerName] ||
                  req.headers?.['authorization']?.replace(/^Bearer\s+/i, '') ||
                  req.headers?.['payment-signature'];

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

        if (typeof res.status === 'function' && typeof res.json === 'function') {
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
        payer: proof,
        status: 'settled',
      };

      if (typeof res.setHeader === 'function') {
        res.setHeader(receiptHeaderName, JSON.stringify(receipt));
      }
      res.locals = res.locals || {};
      res.locals.syncroReceipt = receipt;

      if (options.meterCall) {
        await options.meterCall(receipt, req);
      } else if (options.sdk) {
        try {
          await (options.sdk as any).client.post('/provider/meter', {
            receipt,
            path,
            method,
          });
        } catch (meterErr) {
          console.warn('[SyncroSDK] Failed to report meter usage:', meterErr);
        }
      }

      return next();
    } catch (err: any) {
      if (typeof options.onFailure === 'function') {
        return options.onFailure(err, req, res, next);
      }

      if (failureMode === 'serve-free') {
        console.warn('[SyncroSDK] SYNCRO verification/metering unreachable, serving free per failure mode:', err?.message);
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
        if (typeof res.status === 'function' && typeof res.json === 'function') {
          return res.status(503).json({
            error: 'Service Unavailable',
            message: 'SYNCRO payment verification gateway unreachable',
            details: err?.message,
          });
        }
        return next(err);
      }
    }
  };
}
