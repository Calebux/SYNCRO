/**
 * Cloudflare Workers adapter for SYNCRO provider middleware.
 * 
 * Uses WebCrypto-only primitives (no Node.js built-ins) and optionally
 * integrates with Durable Objects for payment reservation state.
 * 
 * @example Basic Worker
 * ```ts
 * import { workersMetered } from '@syncro/sdk/provider/workers';
 * 
 * const pricing = {
 *   'GET /api/hello': 0.01,
 *   'POST /api/data': 0.05,
 * };
 * 
 * export default {
 *   async fetch(request: Request, env: Env): Promise<Response> {
 *     return workersMetered(request, pricing, {
 *       async handler(req) {
 *         return new Response(JSON.stringify({ message: 'Hello, paid world!' }), {
 *           headers: { 'Content-Type': 'application/json' },
 *         });
 *       },
 *     });
 *   },
 * };
 * ```
 */

import {
  metered,
  type MeteredOptions,
  type MeteredRequest,
  type MeteredResponse,
} from './middleware.js';
import { pricing, type RoutePricing, type PricingDeclarationInput } from './pricing.js';

export interface WorkersMeteredOptions extends Omit<MeteredOptions, 'verifyProof' | 'meterCall'> {
  /**
   * Optional handler function that processes the request after payment verification.
   * If not provided, returns a simple success response.
   */
  handler?: (req: Request) => Response | Promise<Response>;
  
  /**
   * Optional Durable Object namespace for storing reservation state.
   * When provided, enables stateful payment tracking across requests.
   */
  reservationStore?: DurableObjectNamespace;
  
  /**
   * Custom payment proof verification function.
   * Default implementation does basic signature validation using WebCrypto.
   */
  verifyProof?: (proof: string | undefined, amount: number, currency: string) => Promise<boolean>;
}

/**
 * Extract headers from a Cloudflare Workers Request into a plain object.
 */
function extractHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

/**
 * Cloudflare Workers adapter for the metered() middleware.
 * 
 * This function wraps the core metered() logic to work seamlessly with
 * Cloudflare Workers' Request/Response API and WebCrypto primitives.
 * 
 * @param request - Incoming Cloudflare Workers Request
 * @param pricingInput - Pricing configuration (routes and prices)
 * @param options - Configuration options including handler and verification
 * @returns Response with payment verification and receipts
 */
export async function workersMetered(
  request: Request,
  pricingInput: RoutePricing | PricingDeclarationInput,
  options: WorkersMeteredOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Convert Request to MeteredRequest facade
  const facadeReq: MeteredRequest = {
    method: request.method,
    path,
    url: path,
    originalUrl: path,
    headers: extractHeaders(request),
  };

  // Capture response from middleware
  const responseCapture: {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string>;
  } = {
    headers: {},
  };

  const facadeRes: MeteredResponse = {
    locals: {},
    setHeader(name: string, value: string) {
      responseCapture.headers[name] = value;
    },
    status(code: number) {
      responseCapture.statusCode = code;
      return {
        json(body: unknown) {
          responseCapture.body = body;
          return body;
        },
      };
    },
  };

  // Build metered options with Workers-compatible defaults
  const meteredOptions: MeteredOptions = {
    ...options,
    verifyProof: options.verifyProof
      ? async (proof, costRule) => {
          return options.verifyProof!(proof, costRule.price, costRule.currency || 'USDC');
        }
      : undefined,
  };

  const middleware = metered(pricingInput, meteredOptions);
  
  let nextError: unknown;
  let nextCalled = false;

  await middleware(facadeReq, facadeRes, (err?: unknown) => {
    nextCalled = true;
    nextError = err;
    return undefined;
  });

  // If middleware returned a response (402, 503, etc.), return it
  if (responseCapture.statusCode !== undefined) {
    return new Response(JSON.stringify(responseCapture.body), {
      status: responseCapture.statusCode,
      headers: {
        'Content-Type': 'application/json',
        ...responseCapture.headers,
      },
    });
  }

  // If middleware called next with an error, return 500
  if (nextError) {
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: nextError instanceof Error ? nextError.message : String(nextError),
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...responseCapture.headers,
        },
      },
    );
  }

  // Payment verified, call the handler
  const handler = options.handler || defaultHandler;
  const response = await handler(request);

  // Merge receipt headers from middleware into response
  if (Object.keys(responseCapture.headers).length > 0) {
    const mergedHeaders = new Headers(response.headers);
    for (const [name, value] of Object.entries(responseCapture.headers)) {
      mergedHeaders.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: mergedHeaders,
    });
  }

  return response;
}

/**
 * Default handler that returns a simple success message.
 */
function defaultHandler(_req: Request): Response {
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Request processed successfully',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Simple WebCrypto-based proof verification (placeholder for 1% implementation).
 * In production, this should verify Ed25519 signatures against the SYNCRO gateway.
 */
export async function verifyProofWithWebCrypto(
  proof: string | undefined,
  _amount: number,
  _currency: string,
): Promise<boolean> {
  // For 1% implementation: basic validation that proof exists and has content
  // Real implementation would use crypto.subtle.verify() with Ed25519
  if (!proof || typeof proof !== 'string') {
    return false;
  }
  
  // Basic format check: proof should be non-empty and look like base64 or hex
  const isValidFormat = proof.length > 10 && /^[A-Za-z0-9+/=_-]+$/.test(proof);
  
  return isValidFormat;
}
