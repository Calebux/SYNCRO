/**
 * Default wiring of the Envoy ext_authz service onto the existing paid-path
 * gateway lifecycle (#1826).
 *
 * Admission reuses the exact lifecycle middlewares the SYNCRO gateway runs
 * (`resolveIdentity` … `reserveMeter`), driven against an in-memory
 * request/response pair built from the request Envoy forwarded. The original
 * downstream path is presented as if it were mounted under
 * `/api/v3/gateway`, so route pricing, the 402 challenge and the payment-proof
 * request hash are identical to a call made through the gateway itself.
 *
 * Settlement mirrors `proxyAndCommit`, minus the proxying: Envoy has already
 * called the upstream.
 */
import { randomUUID } from 'node:crypto';
import logger from '../../config/logger';
import {
  createGatewayLifecycle,
  GatewayRequest,
  meterReservationTracker,
} from '../../services/v3/gateway-lifecycle';
import {
  extractQuantityAndCalculatePrice,
  meteredRouteRegistry,
} from '../../services/v3/metering-units';
import { spendCapService } from '../../services/v3/spend-cap-service';
import { meterUsageLedgerService } from '../../services/usage/meter-usage-ledger';
import { agentConsoleService } from '../agent-console-service';
import { receiptService } from '../receipt-runtime';
import type { AdmitOutcome, CheckRequest, ExtAuthzDeps } from './envoy-ext-authz';

/** Mount point the lifecycle's route registry expects. */
const GATEWAY_MOUNT = '/api/v3/gateway';

type Step = (req: GatewayRequest, res: any, next: (err?: unknown) => void) => unknown;

/** Minimal Express response stand-in that records what a lifecycle step wrote. */
class CapturedResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown = undefined;
  writableEnded = false;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: unknown): this {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }

  json(body: unknown): this {
    this.headers['content-type'] = 'application/json';
    this.body = body;
    this.writableEnded = true;
    return this;
  }
}

/** Run one middleware; resolves true if it called next(), false if it responded. */
async function runStep(step: Step, req: GatewayRequest, res: CapturedResponse): Promise<boolean> {
  let advanced = false;
  let failure: unknown;
  await step(req, res, (err?: unknown) => {
    if (err) failure = err;
    else advanced = true;
  });
  if (failure) throw failure;
  if (!advanced && !res.writableEnded) {
    throw new Error('Admission step neither responded nor continued');
  }
  return advanced;
}

function buildRequest(check: CheckRequest): GatewayRequest {
  const noop = function (this: unknown) {
    return this;
  };
  const req = {
    method: check.method.toUpperCase(),
    path: check.path,
    url: check.path,
    originalUrl: `${GATEWAY_MOUNT}${check.path}`,
    headers: check.headers,
    query: check.query,
    body: check.body,
    header(name: string) {
      return check.headers[name.toLowerCase()];
    },
    get(name: string) {
      return check.headers[name.toLowerCase()];
    },
    // reserveMeter listens for client disconnects; ext_authz settles or
    // TTL-releases reservations itself, so these are inert here.
    on: noop,
    once: noop,
    removeListener: noop,
  };
  return req as unknown as GatewayRequest;
}

export function createLifecycleExtAuthzDeps(): ExtAuthzDeps {
  const lifecycle = createGatewayLifecycle();
  const steps: Step[] = [
    lifecycle.resolveIdentity,
    lifecycle.resolveRouteAndPrice,
    lifecycle.checkScope,
    lifecycle.checkCap,
    lifecycle.verifyPayment,
    lifecycle.reserveMeter,
  ] as Step[];

  return {
    async admit(check): Promise<AdmitOutcome> {
      const req = buildRequest(check);
      const res = new CapturedResponse();
      for (const step of steps) {
        if (!(await runStep(step, req, res))) {
          return { admitted: false, status: res.statusCode, headers: res.headers, body: res.body };
        }
      }

      const ctx = req.gatewayCtx!;
      const plan = ctx.routePlan!;
      return {
        admitted: true,
        call: {
          agentId: ctx.identity!.agentId,
          reservationId: ctx.reservationId!,
          routePath: plan.path,
          unitName: plan.unitName,
          unitPrice: plan.unitPrice,
          reservationBound: plan.reservationBound,
          priceUpperBound: plan.priceUpperBound,
          channelId: ctx.paymentProof!.channelId,
          stateNonce: ctx.paymentProof!.sequenceNumber,
          requestMethod: req.method,
          requestPath: check.path,
          requestQuery: check.query,
        },
      };
    },

    async measure(call, upstream) {
      const result = await extractQuantityAndCalculatePrice(
        meteredRouteRegistry.getRouteConfig(call.routePath),
        { headers: upstream.headers, body: upstream.body, streamEnded: true },
      );
      return {
        units: result.quantity,
        amount: result.actualPrice,
        fallbackUsed: !result.extractedSuccessfully,
      };
    },

    async commit(call, m) {
      meterReservationTracker.commit(call.reservationId, m.amount, m.units, m.fallbackUsed);
      spendCapService.consumeLocal(call.agentId, m.amount);
      agentConsoleService.recordPresentedSpend(call.agentId, m.amount);
      const ledger = await meterUsageLedgerService.commit({
        reservationId: call.reservationId,
        actualUnits: m.units,
        actualAmount: m.amount,
        fallbackUsed: m.fallbackUsed,
        unitPrice: call.unitPrice,
      });
      if (!ledger.metered && !ledger.queuedForReplay) {
        logger.error('[ExtAuthz] Served usage could not be recorded for reconciliation', {
          reservationId: call.reservationId,
          agentId: call.agentId,
          amount: m.amount,
        });
      }
    },

    async release(call, reason) {
      meterReservationTracker.release(call.reservationId, reason);
      await meterUsageLedgerService.release(call.reservationId, reason);
    },

    async issueReceipt(call, m) {
      const receipt = await receiptService.issueReceipt({
        receiptId: randomUUID(),
        route: call.routePath,
        unit: call.unitName,
        quantity: m.units,
        amount: m.amount,
        rateCardVersion: 'v1',
        exchangeRate: null,
        channelId: call.channelId,
        stateNonce: call.stateNonce,
        requestMethod: call.requestMethod,
        requestPath: call.requestPath,
        requestQuery: call.requestQuery,
      });
      return {
        receiptId: receipt.receiptId,
        inlineHeader: receiptService.headerFitsInline(receipt)
          ? receiptService.encodeHeaderValue(receipt)
          : null,
      };
    },

    onError(message, meta) {
      logger.error(`[ExtAuthz] ${message}`, meta);
    },
  };
}
