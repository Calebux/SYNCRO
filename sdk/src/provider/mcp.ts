/**
 * Provider-side metering wrapper for MCP (Model Context Protocol) tool
 * handlers (issue #1818).
 *
 * `meteredTool()` brings the SYNCRO x402 payment flow to MCP servers. MCP
 * transports carry no HTTP status code, so an unpaid tool call comes back as a
 * normal tool result flagged `isError` whose metadata holds the base64-encoded
 * x402 challenge under `_meta["PAYMENT-REQUIRED"]` — byte for byte the value
 * the HTTP `metered()` middleware writes to the `PAYMENT-REQUIRED` header. The
 * client pays, retries the same tool call with the proof attached, and the
 * wrapper verifies it, runs the handler, then returns the settlement receipt
 * in `_meta["X-Syncro-Receipt"]`.
 *
 * Where the proof is read from, per transport:
 * - HTTP / SSE: the `PAYMENT-SIGNATURE` (or `X-Syncro-Payment-Proof`) request
 *   header, exposed on the handler's request info.
 * - Any transport: the call's `_meta["PAYMENT-SIGNATURE"]`.
 *
 * stdio transport is intentionally not wired up yet; see
 * docs/integrations/mcp-metering.mdx for the deferred design.
 *
 * @example
 * ```ts
 * import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 * import { meteredTool } from "@syncro/sdk";
 *
 * const server = new McpServer({ name: "metered-demo", version: "1.0.0" });
 * server.registerTool(
 *   "summarize",
 *   { inputSchema: { text: z.string() } },
 *   meteredTool(
 *     async ({ text }) => ({ content: [{ type: "text", text }] }),
 *     0.01,
 *     { toolName: "summarize", verifyProof: (proof) => verifyWithGateway(proof) },
 *   ),
 * );
 * ```
 */

import { pricing, type PricingDeclarationInput, type RoutePricing, type RoutePricingRule } from './pricing.js';
import { servedFreeStats, type FailureMode, type SyncroReceipt } from './middleware.js';

// ── Minimal structural MCP types ─────────────────────────────────────────────
//
// Deliberately structural: the SDK does not take a hard dependency on
// `@modelcontextprotocol/sdk`. These mirror the shapes the MCP TypeScript SDK
// uses for tool handlers, so `meteredTool()` results slot straight into
// `server.registerTool()`.

/** A single MCP content block (text, image, resource, …). */
export interface McpContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** The `CallToolResult` shape returned by MCP tool handlers. */
export interface McpCallToolResult {
  content?: McpContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Request metadata the MCP HTTP/SSE transports expose to tool handlers. */
export interface McpRequestInfo {
  headers?: Record<string, string | string[] | undefined>;
  url?: string | URL;
}

/** The `extra` argument MCP passes as the second tool handler parameter. */
export interface McpToolExtra {
  sessionId?: string;
  requestInfo?: McpRequestInfo;
  _meta?: Record<string, unknown>;
  signal?: unknown;
  [key: string]: unknown;
}

/** An MCP tool handler: `(args, extra) => CallToolResult`. */
export type McpToolHandler<Args extends Record<string, unknown> = Record<string, unknown>> = (
  args: Args,
  extra: McpToolExtra,
) => McpCallToolResult | Promise<McpCallToolResult>;

/** How the payment proof reached the tool call. */
export type McpProofTransport = 'http' | 'meta' | 'none';

/** Context handed to `verifyProof`, `meterCall`, and custom failure handlers. */
export interface MeteredToolContext<Args extends Record<string, unknown> = Record<string, unknown>> {
  /** MCP tool name, used for pricing matching and the receipt `route`. */
  toolName: string;
  /** The tool call arguments. */
  args: Args;
  /** The MCP `extra` object for this call. */
  extra: McpToolExtra;
  /** The payment proof as received, if any. */
  proof?: string;
  /** Where the proof was found. */
  transport: McpProofTransport;
}

/** Custom failure handler, mirroring the HTTP middleware's `FailureHandler`. */
export type MeteredToolFailureHandler<Args extends Record<string, unknown> = Record<string, unknown>> = (
  error: Error,
  ctx: MeteredToolContext<Args>,
) => McpCallToolResult | Promise<McpCallToolResult>;

/** Metadata keys the wrapper reads/writes on the tool result. */
export interface MeteredToolMetaKeys {
  /** `_meta` key carrying the base64 x402 challenge. Default `PAYMENT-REQUIRED`. */
  challenge?: string;
  /** `_meta` key carrying the settlement receipt. Default `X-Syncro-Receipt`. */
  receipt?: string;
  /** `_meta` key the client echoes the proof in. Default `PAYMENT-SIGNATURE`. */
  proof?: string;
}

export interface MeteredToolOptions<Args extends Record<string, unknown> = Record<string, unknown>> {
  /** MCP tool name; drives pricing rule matching and the receipt `route`. */
  toolName?: string;
  /** SYNCRO gateway/provider API key, echoed as the challenge `payTo` hint. */
  apiKey?: string;
  /** Request header carrying the proof on HTTP/SSE transports. */
  headerName?: string;
  /** Verify the proof against the SYNCRO gateway. Defaults to "proof present". */
  verifyProof?: (
    proof: string | undefined,
    cost: RoutePricingRule,
    ctx: MeteredToolContext<Args>,
  ) => Promise<boolean> | boolean;
  /** Called after a paid call settles so providers can report usage. */
  meterCall?: (receipt: SyncroReceipt, ctx: MeteredToolContext<Args>) => Promise<void> | void;
  /** Behaviour when verification/metering throws. Defaults to `'reject'`. */
  onFailure?: FailureMode | MeteredToolFailureHandler<Args>;
  /** Override the default `_meta` keys. */
  metaKeys?: MeteredToolMetaKeys;
}

// ── Internals ────────────────────────────────────────────────────────────────

function encodeBase64(value: string): string {
  const buffer = (globalThis as { Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (buffer) {
    return buffer.from(value, 'utf8').toString('base64');
  }
  return btoa(value);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRoutePricing(value: RoutePricing | PricingDeclarationInput): value is RoutePricing {
  return typeof value === 'object' && value !== null && 'match' in value;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function extractProof(
  extra: McpToolExtra,
  args: Record<string, unknown>,
  headerName: string,
  proofMetaKey: string,
): { proof?: string; transport: McpProofTransport } {
  const headers = extra.requestInfo?.headers;
  if (headers) {
    const lower = headerName.toLowerCase();
    const fromHeader =
      headerValue(headers[lower]) ||
      headerValue(headers[headerName]) ||
      headerValue(headers['authorization'])?.replace(/^Bearer\s+/i, '') ||
      headerValue(headers['payment-signature']);
    if (fromHeader) return { proof: fromHeader, transport: 'http' };
  }

  const meta = extra._meta ?? (args as { _meta?: Record<string, unknown> })._meta;
  for (const key of [proofMetaKey, 'PAYMENT-SIGNATURE', 'X-Syncro-Payment-Proof']) {
    const value = meta?.[key];
    if (typeof value === 'string' && value.length > 0) return { proof: value, transport: 'meta' };
  }

  return { transport: 'none' };
}

function buildReceipt(
  toolName: string,
  amount: number,
  currency: string,
  status: SyncroReceipt['status'],
  proof: string | undefined,
): SyncroReceipt {
  return {
    id: `rcpt_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    route: toolName,
    method: 'CALL',
    amount,
    currency,
    status,
    ...(proof === undefined ? {} : { payer: proof }),
  };
}

function attachReceipt(
  result: McpCallToolResult,
  receipt: SyncroReceipt,
  receiptKey: string,
): McpCallToolResult {
  return { ...result, _meta: { ...(result._meta ?? {}), [receiptKey]: receipt } };
}

function paymentRequiredResult(
  challenge: Record<string, unknown>,
  challengeKey: string,
  proofMetaKey: string,
  toolName: string,
  rule: RoutePricingRule,
): McpCallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text:
          `Payment required for tool "${toolName}": ${rule.price} ${rule.currency ?? 'USDC'} per call. ` +
          `Pay the x402 challenge in _meta["${challengeKey}"] and retry with _meta["${proofMetaKey}"].`,
      },
    ],
    _meta: { [challengeKey]: encodeBase64(JSON.stringify(challenge)) },
  };
}

function serviceUnavailableResult(err: unknown): McpCallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: 'SYNCRO payment verification gateway unreachable; retry shortly.',
      },
    ],
    _meta: {
      'Retry-After': '5',
      'syncro/error': {
        error: 'Service Unavailable',
        retryAfter: 5,
        details: errorMessage(err),
      },
    },
  };
}

let serveFreeWarningLogged = false;

function warnServeFreeOnce(): void {
  if (serveFreeWarningLogged) return;
  serveFreeWarningLogged = true;
  console.warn(
    '[SyncroSDK] MCP tool metering failureMode "serve-free" is active: tool calls will be served free when ' +
    'SYNCRO metering is unreachable. This gives away your tools on outages. Set onFailure: "reject" (the default) ' +
    'to return an error instead.',
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Wrap an MCP tool handler so every call is metered through SYNCRO and the
 * 402 flow is carried over the MCP transport.
 *
 * @param handler The MCP tool handler to wrap.
 * @param pricingInput Price for this tool — a number, a `RoutePricingRule`, a
 *   declaration map, or a prebuilt `RoutePricing`. The tool is matched as the
 *   pseudo-route `CALL <toolName>`, so keys like `{ "CALL summarize": 0.01 }`
 *   or `{ summarize: 0.01 }` both work.
 * @param options Metering options (gateway verification, failure mode, keys).
 */
export function meteredTool<Args extends Record<string, unknown> = Record<string, unknown>>(
  handler: McpToolHandler<Args>,
  pricingInput: RoutePricing | PricingDeclarationInput,
  options: MeteredToolOptions<Args> = {},
): McpToolHandler<Args> {
  const routePricing = isRoutePricing(pricingInput) ? pricingInput : pricing(pricingInput);
  const failureMode: FailureMode = typeof options.onFailure === 'string' ? options.onFailure : 'reject';

  if (failureMode === 'serve-free') {
    warnServeFreeOnce();
  }

  const headerName = options.headerName || 'X-Syncro-Payment-Proof';
  const challengeKey = options.metaKeys?.challenge || 'PAYMENT-REQUIRED';
  const receiptKey = options.metaKeys?.receipt || 'X-Syncro-Receipt';
  const proofMetaKey = options.metaKeys?.proof || 'PAYMENT-SIGNATURE';
  const toolName = options.toolName || 'mcp:tool';

  return async (args: Args, extra: McpToolExtra): Promise<McpCallToolResult> => {
    // Tool names are matched case-insensitively so `{ "CALL summarize": 0.01 }`
    // and `{ summarize: 0.01 }` both hit; pricing rule keys are uppercased.
    const rule = routePricing.match('CALL', toolName.toUpperCase());
    const currency = rule.currency || routePricing.currency;

    if (rule.price <= 0) {
      const receipt = buildReceipt(toolName, 0, currency, 'free', undefined);
      return attachReceipt(await handler(args, extra), receipt, receiptKey);
    }

    const { proof, transport } = extractProof(extra, args, headerName, proofMetaKey);
    const ctx: MeteredToolContext<Args> = {
      toolName,
      args,
      extra,
      transport,
      ...(proof === undefined ? {} : { proof }),
    };

    try {
      const verified = options.verifyProof
        ? await options.verifyProof(proof, rule, ctx)
        : typeof proof === 'string' && proof.length > 0;

      if (!verified) {
        const challenge: Record<string, unknown> = {
          x402Version: 2,
          error: 'Payment proof required or invalid',
          resource: {
            url: `mcp://tool/${toolName}`,
            description: rule.description || `Call to MCP tool ${toolName}`,
          },
          accepts: [
            {
              scheme: 'exact',
              amount: String(rule.price),
              asset: currency,
              payTo: options.apiKey ? 'syncro-provider' : 'gateway',
            },
          ],
        };
        return paymentRequiredResult(challenge, challengeKey, proofMetaKey, toolName, rule);
      }

      const receipt = buildReceipt(toolName, rule.price, currency, 'settled', proof);
      if (options.meterCall) {
        await options.meterCall(receipt, ctx);
      }
      return attachReceipt(await handler(args, extra), receipt, receiptKey);
    } catch (err: unknown) {
      if (typeof options.onFailure === 'function') {
        return options.onFailure(toError(err), ctx);
      }

      if (failureMode === 'serve-free') {
        servedFreeStats.count += 1;
        console.warn(
          '[SyncroSDK] SYNCRO verification/metering unreachable, serving MCP tool free per failure mode:',
          errorMessage(err),
        );
        const freeReceipt = buildReceipt(toolName, 0, currency, 'free', undefined);
        return attachReceipt(await handler(args, extra), freeReceipt, receiptKey);
      }

      return serviceUnavailableResult(err);
    }
  };
}
