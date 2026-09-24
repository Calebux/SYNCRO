import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../config/logger';
import {
  generatePaymentChallenge,
  parsePaymentProof,
  verifyPaymentProof,
  PaymentProof,
} from './v3/payment-challenge-service';
import { spendCapService } from './v3/spend-cap-service';
import { unitEconomicsService } from './v3/unit-economics-service';

export interface UpstreamProvider {
  name: string;
  endpoint: string;
  forward: (req: Request, res: Response, body: any) => Promise<any>;
}

export interface ReservationRecord {
  reservationId: string;
  agentId: string;
  route: string;
  priceUpperBound: number;
  reservedAt: number;
  status: 'reserved' | 'committed' | 'released';
}

export class MeterReservationTracker {
  private reservations = new Map<string, ReservationRecord>();

  reserve(agentId: string, route: string, priceUpperBound: number): string {
    const reservationId = `res_${crypto.randomBytes(8).toString('hex')}`;
    this.reservations.set(reservationId, {
      reservationId,
      agentId,
      route,
      priceUpperBound,
      reservedAt: Date.now(),
      status: 'reserved',
    });
    return reservationId;
  }

  commit(reservationId: string, actualUsage: number): boolean {
    const res = this.reservations.get(reservationId);
    if (!res || res.status !== 'reserved') return false;
    res.status = 'committed';
    this.reservations.set(reservationId, res);
    return true;
  }

  release(reservationId: string, reason: string): boolean {
    const res = this.reservations.get(reservationId);
    if (!res || res.status !== 'reserved') return false;
    res.status = 'released';
    this.reservations.set(reservationId, res);
    logger.info(`[MeterReservation] Released reservation ${reservationId}: ${reason}`);
    return true;
  }

  get(reservationId: string): ReservationRecord | null {
    return this.reservations.get(reservationId) || null;
  }

  getStrandedCount(): number {
    return Array.from(this.reservations.values()).filter((r) => r.status === 'reserved').length;
  }

  clear(): void {
    this.reservations.clear();
  }
}

export const meterReservationTracker = new MeterReservationTracker();

export interface GatewayContext {
  identity?: {
    agentId: string;
    apiKey: string;
    scopes: string[];
  };
  routePlan?: {
    path: string;
    priceUpperBound: number;
    actualPrice: number;
    requiredScope: string;
    providerId: string;
  };
  paymentProof?: PaymentProof;
  reservationId?: string;
  receipt?: {
    receiptId: string;
    requestHash: string;
    cost: number;
    issuedAt: string;
    providerSignature: string;
  };
}

export interface GatewayRequest extends Request {
  gatewayCtx?: GatewayContext;
}

export function createGatewayLifecycle() {
  const reservationTracker = meterReservationTracker;

  return {
    // 1. Resolve Identity
    resolveIdentity: async (req: GatewayRequest, res: Response, next: NextFunction) => {
      req.gatewayCtx = req.gatewayCtx || {};
      const authHeader = req.headers['authorization'] || req.headers['x-api-key'];
      const apiKey = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '') : undefined;

      if (!apiKey) {
        // Return 402 actionable challenge if unfunded / unauthenticated
        const { challenge, headerValue } = generatePaymentChallenge({
          amount: '100',
          rate: '100',
        });
        res.setHeader('PAYMENT-REQUIRED', headerValue);
        return res.status(402).json({
          error: 'Payment required: unauthenticated or unfunded agent request',
          challenge,
        });
      }

      // Resolve key to agent identity
      req.gatewayCtx.identity = {
        agentId: apiKey.startsWith('agent_') ? apiKey : `agent_${apiKey.slice(0, 10)}`,
        apiKey,
        scopes: ['llm:call', 'compute:run'],
      };
      next();
    },

    // 2. Resolve Route and Price
    resolveRouteAndPrice: async (req: GatewayRequest, res: Response, next: NextFunction) => {
      const ctx = req.gatewayCtx!;
      ctx.routePlan = {
        path: req.path,
        priceUpperBound: 10,
        actualPrice: 8,
        requiredScope: 'llm:call',
        providerId: 'provider_testnet_1',
      };
      next();
    },

    // 3. Check Scope
    checkScope: async (req: GatewayRequest, res: Response, next: NextFunction) => {
      const ctx = req.gatewayCtx!;
      const hasScope = ctx.identity?.scopes.includes(ctx.routePlan!.requiredScope);
      if (!hasScope) {
        return res.status(403).json({
          error: `Missing required scope: ${ctx.routePlan!.requiredScope}`,
        });
      }
      next();
    },

    // 4. Check Cap (On-chain spend cap admission)
    checkCap: async (req: GatewayRequest, res: Response, next: NextFunction) => {
      const ctx = req.gatewayCtx!;
      const capCheck = spendCapService.canTransact(
        ctx.identity!.agentId,
        ctx.routePlan!.priceUpperBound
      );

      if (!capCheck.canTransact) {
        return res.status(402).json({
          error: 'Spend cap admission failed',
          remainingAllowance: capCheck.remainingAllowance,
          requiredAmount: capCheck.requiredAmount,
          reason: capCheck.reason,
        });
      }
      next();
    },

    // 5. Verify Payment Proof (if header supplied, or challenge if missing)
    verifyPayment: async (req: GatewayRequest, res: Response, next: NextFunction) => {
      const ctx = req.gatewayCtx!;
      const paymentSignatureHeader = req.headers['payment-signature'] as string;

      if (!paymentSignatureHeader) {
        const { challenge, headerValue } = generatePaymentChallenge({
          amount: String(ctx.routePlan!.priceUpperBound),
        });
        res.setHeader('PAYMENT-REQUIRED', headerValue);
        return res.status(402).json({
          error: 'Payment required: Please provide PAYMENT-SIGNATURE header with valid channel state proof',
          challenge,
        });
      }

      const proof = parsePaymentProof(paymentSignatureHeader);
      if (!proof) {
        return res.status(402).json({
          error: 'Invalid payment proof structure in PAYMENT-SIGNATURE header',
        });
      }

      const verification = verifyPaymentProof(proof, ctx.routePlan!.priceUpperBound);
      if (!verification.valid) {
        return res.status(402).json({
          error: verification.error,
          code: verification.code,
          details: verification.details,
        });
      }

      ctx.paymentProof = proof;
      next();
    },

    // 6. Reserve at Meter (strictly AFTER admission passes!)
    reserveMeter: async (req: GatewayRequest, res: Response, next: NextFunction) => {
      const ctx = req.gatewayCtx!;
      const reservationId = reservationTracker.reserve(
        ctx.identity!.agentId,
        ctx.routePlan!.path,
        ctx.routePlan!.priceUpperBound
      );
      ctx.reservationId = reservationId;

      // Handle client disconnect to guarantee reservation release
      req.on('close', () => {
        if (!res.writableEnded && ctx.reservationId) {
          reservationTracker.release(ctx.reservationId, 'Client disconnected prematurely');
        }
      });

      next();
    },

    // 7. Proxy Upstream & Commit Usage & Attach Receipt
    proxyAndCommit: (upstreamProvider?: UpstreamProvider) => {
      return async (req: GatewayRequest, res: Response, next: NextFunction) => {
        const ctx = req.gatewayCtx!;
        const reservationId = ctx.reservationId!;

        try {
          let upstreamResult: any;

          if (upstreamProvider) {
            upstreamResult = await upstreamProvider.forward(req, res, req.body);
          } else {
            // Default simulated upstream call
            if (req.body?.simulateUpstreamError) {
              throw new Error('Upstream provider error simulated');
            }
            upstreamResult = { status: 'success', data: { response: 'Hello from Upstream Agent API' } };
          }

          // Commit actual usage
          const actualUsage = ctx.routePlan!.actualPrice;
          reservationTracker.commit(reservationId, actualUsage);
          spendCapService.consumeLocal(ctx.identity!.agentId, actualUsage);

          // Generate Receipt
          const requestHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
          const receipt = {
            receiptId: `rcpt_${crypto.randomBytes(8).toString('hex')}`,
            requestHash,
            cost: actualUsage,
            issuedAt: new Date().toISOString(),
            providerSignature: `sig_prov_${crypto.randomBytes(16).toString('hex')}`,
          };
          ctx.receipt = receipt;

          res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify(receipt)).toString('base64'));
          return res.status(200).json({
            ...upstreamResult,
            receipt,
          });
        } catch (err: any) {
          // Guarantee reservation is released on ANY error/exception path!
          reservationTracker.release(reservationId, `Upstream call failed: ${err.message}`);
          return res.status(502).json({
            error: `Upstream gateway error: ${err.message}`,
            reservationReleased: true,
          });
        }
      };
    },
  };
}
