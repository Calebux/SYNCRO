import {
  createPaidFetch,
  type PaidFetchConfig,
  type PaidResponse,
  type PaymentReceipt,
} from "./paid-fetch.js";

// ─────────────────────────────────────────────────────────────────────────────
// Framework-neutral LLM tool adapter for paid routes (issue #1821)
//
// `toToolDefinition` turns a paid route from a provider manifest into a plain
// JSON Schema (draft-07) tool spec. `executeTool` runs a model's tool call
// against that route through `createPaidFetch`. Neither depends on an LLM SDK:
// the spec maps onto any provider's tool-calling API with a field rename, e.g.
//
//   Anthropic Messages:  { name, description, input_schema: parameters }
//   OpenAI-style:        { type: "function", function: { name, description, parameters } }
// ─────────────────────────────────────────────────────────────────────────────

/** A JSON Schema document (draft-07). */
export type JsonSchema = { [keyword: string]: unknown };

/** Price of one call to a paid route. */
export interface PaidRoutePrice {
  /** Decimal amount, e.g. `"0.002"`. Strings avoid float rounding. */
  amount: string | number;
  /** Asset code the amount is denominated in, e.g. `"USDC"`. */
  asset: string;
  /** Billing unit. Defaults to `"call"`. */
  unit?: string;
}

/**
 * One paid route as listed in a provider manifest. This is the subset of the
 * `/.well-known/syncro.json` route entry (#1828) the tool adapter needs.
 */
export interface PaidRoute {
  /** Tool name. Derived from method and path when omitted. */
  name?: string;
  /** HTTP method. Defaults to `GET`. */
  method?: string;
  /**
   * Path relative to the manifest's `gatewayUrl`. Path parameters use
   * `{name}` or `:name` and become required string arguments.
   */
  path: string;
  /** What the route does, written for the model. */
  description?: string;
  price: PaidRoutePrice;
  /** JSON Schema (draft-07, `type: "object"`) for the route's arguments. */
  parameters?: JsonSchema;
}

/** The parts of a provider manifest the tool adapter reads. */
export interface ProviderManifest {
  providerId?: string;
  /** Base URL that route paths are resolved against. */
  gatewayUrl: string;
  routes: PaidRoute[];
}

/** Framework-neutral tool spec. `parameters` is a draft-07 object schema. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** A tool call as emitted by a model. */
export interface ToolCall {
  /** Provider's call id (e.g. Anthropic `tool_use.id`), echoed on the result. */
  id?: string;
  name: string;
  /** Arguments as an object or a JSON string (OpenAI-style providers send strings). */
  arguments: Record<string, unknown> | string;
}

/** Result of running a tool call. `executeTool` never throws; failures set `ok: false`. */
export interface ToolResult {
  callId?: string;
  name: string;
  ok: boolean;
  /** HTTP status of the final response, when a request was made. */
  status?: number;
  /** Parsed JSON response body, or text for non-JSON responses. */
  content?: unknown;
  /** Settlement receipt, present when a 402 challenge was paid. */
  receipt?: PaymentReceipt;
  /** Advertised price of the route. */
  price?: PaidRoutePrice;
  /** Why the call failed, written so the model can react. */
  error?: string;
}

export interface ExecuteToolOptions {
  manifest: ProviderManifest;
  /** A fetch returned by `createPaidFetch`. Takes precedence over `paidFetch`. */
  fetch?: typeof fetch;
  /** Config used to build the paid fetch when `fetch` is not given. */
  paidFetch?: PaidFetchConfig;
}

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const PATH_PARAM_PATTERN = /\{([A-Za-z0-9_]+)\}|:([A-Za-z0-9_]+)/g;
const BODYLESS_METHODS = new Set(["GET", "HEAD", "DELETE", "OPTIONS"]);

/**
 * Build a JSON Schema tool spec for a paid route. The route's price is
 * appended to the description so the model can prefer cheaper tools.
 *
 * @throws when the route has an invalid name, price, or parameter schema.
 */
export function toToolDefinition(route: PaidRoute): ToolDefinition {
  const method = normalizeMethod(route.method);
  const name = route.name ?? deriveToolName(method, route.path);
  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid tool name "${name}": use 1-64 letters, digits, "_" or "-".`,
    );
  }

  const parameters = buildParameters(route);
  const summary = route.description?.trim() || `${method} ${route.path}`;
  const description = `${summary} Cost: ${formatPrice(route.price)}.`;

  return { name, description, parameters };
}

/**
 * Build tool specs for every route in a manifest, plus an executor bound to it.
 *
 * @example
 * ```ts
 * const tools = createPaidTools({ manifest, paidFetch: { sign, gatewayPublicKey } });
 * // pass tools.definitions to the model, then for each tool call:
 * const result = await tools.executeTool(call);
 * ```
 */
export function createPaidTools(options: ExecuteToolOptions): {
  definitions: ToolDefinition[];
  executeTool: (call: ToolCall) => Promise<ToolResult>;
} {
  const fetchImpl = resolveFetch(options);
  const entries = indexRoutes(options.manifest);
  return {
    definitions: [...entries.values()].map((entry) => entry.definition),
    executeTool: (call) => runToolCall(call, options.manifest, entries, fetchImpl),
  };
}

/**
 * Run one model tool call against the matching manifest route through
 * `createPaidFetch`. Never throws: unknown tools, bad arguments, payment
 * failures, and HTTP errors come back as `{ ok: false, error }` so they can be
 * returned to the model as a tool error.
 */
export async function executeTool(
  call: ToolCall,
  options: ExecuteToolOptions,
): Promise<ToolResult> {
  return createPaidTools(options).executeTool(call);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

interface RouteEntry {
  route: PaidRoute;
  method: string;
  definition: ToolDefinition;
}

function resolveFetch(options: ExecuteToolOptions): typeof fetch {
  if (options.fetch) return options.fetch;
  if (options.paidFetch) return createPaidFetch(options.paidFetch);
  throw new Error(
    "Provide `fetch` (from createPaidFetch) or `paidFetch` config to execute paid tools.",
  );
}

function indexRoutes(manifest: ProviderManifest): Map<string, RouteEntry> {
  const entries = new Map<string, RouteEntry>();
  for (const route of manifest.routes) {
    const definition = toToolDefinition(route);
    if (entries.has(definition.name)) {
      throw new Error(`Duplicate tool name "${definition.name}" in provider manifest.`);
    }
    entries.set(definition.name, {
      route,
      method: normalizeMethod(route.method),
      definition,
    });
  }
  return entries;
}

async function runToolCall(
  call: ToolCall,
  manifest: ProviderManifest,
  entries: Map<string, RouteEntry>,
  fetchImpl: typeof fetch,
): Promise<ToolResult> {
  const base: ToolResult = { name: call.name, ok: false };
  if (call.id !== undefined) base.callId = call.id;

  const entry = entries.get(call.name);
  if (!entry) {
    return { ...base, error: `Unknown tool "${call.name}".` };
  }
  base.price = entry.route.price;

  const args = parseArguments(call.arguments);
  if (!args) {
    return { ...base, error: "Tool arguments must be a JSON object." };
  }

  const required = entry.definition.parameters.required;
  const missing = Array.isArray(required)
    ? required.filter((key): key is string => typeof key === "string" && args[key] === undefined)
    : [];
  if (missing.length > 0) {
    return { ...base, error: `Missing required argument(s): ${missing.join(", ")}.` };
  }

  const { url, init } = buildRequest(manifest.gatewayUrl, entry, args);

  let response: PaidResponse;
  try {
    response = (await fetchImpl(url, init)) as PaidResponse;
  } catch (err) {
    return { ...base, error: `Request failed: ${errorMessage(err)}` };
  }

  const content = await readBody(response);
  const result: ToolResult = { ...base, status: response.status, content };
  if (response.receipt) result.receipt = response.receipt;

  if (response.status === 402) {
    return {
      ...result,
      error: "Payment required: the payment challenge could not be verified or paid.",
    };
  }
  if (!response.ok) {
    return { ...result, error: `Provider returned HTTP ${response.status}.` };
  }
  return { ...result, ok: true };
}

function buildParameters(route: PaidRoute): JsonSchema {
  const schema: JsonSchema = route.parameters
    ? structuredClone(route.parameters)
    : { type: "object", properties: {}, additionalProperties: false };

  if (schema.type !== "object") {
    throw new Error(`Parameters for route "${route.path}" must be a JSON Schema with type "object".`);
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? [...(schema.required as unknown[])] : [];

  for (const param of pathParams(route.path)) {
    if (!(param in properties)) {
      properties[param] = { type: "string", description: `Path parameter "${param}".` };
    }
    if (!required.includes(param)) required.push(param);
  }

  schema.properties = properties;
  if (required.length > 0) schema.required = required;
  return schema;
}

function buildRequest(
  gatewayUrl: string,
  entry: RouteEntry,
  args: Record<string, unknown>,
): { url: string; init: RequestInit } {
  const remaining: Record<string, unknown> = { ...args };
  const path = entry.route.path.replace(
    PATH_PARAM_PATTERN,
    (_match, braced: string | undefined, colon: string | undefined) => {
      const key = (braced ?? colon) as string;
      const value = remaining[key];
      delete remaining[key];
      return encodeURIComponent(String(value));
    },
  );

  const url = new URL(`${gatewayUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  const init: RequestInit = { method: entry.method };

  if (BODYLESS_METHODS.has(entry.method)) {
    for (const [key, value] of Object.entries(remaining)) {
      if (value === undefined || value === null) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        url.searchParams.append(
          key,
          typeof item === "object" ? JSON.stringify(item) : String(item),
        );
      }
    }
  } else {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(remaining);
  }

  return { url: url.toString(), init };
}

async function readBody(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text === "") return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function parseArguments(raw: ToolCall["arguments"]): Record<string, unknown> | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return {};
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function pathParams(path: string): string[] {
  const names: string[] = [];
  for (const match of path.matchAll(PATH_PARAM_PATTERN)) {
    const name = match[1] ?? match[2];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function deriveToolName(method: string, path: string): string {
  const slug = `${method}_${path}`
    .toLowerCase()
    .replace(PATH_PARAM_PATTERN, (_m, braced: string | undefined, colon: string | undefined) => `by_${braced ?? colon}`)
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return slug.slice(0, 64);
}

function formatPrice(price: PaidRoutePrice): string {
  if (!isRecord(price)) {
    throw new Error("Route is missing a price.");
  }
  const raw = price.amount;
  const valid =
    (typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "")) &&
    Number.isFinite(Number(raw)) &&
    Number(raw) >= 0;
  if (!valid) {
    throw new Error(`Invalid route price amount: ${JSON.stringify(price?.amount)}.`);
  }
  if (typeof price.asset !== "string" || price.asset.trim() === "") {
    throw new Error("Route price must name an asset.");
  }
  return `${String(price.amount).trim()} ${price.asset} per ${price.unit?.trim() || "call"}`;
}

function normalizeMethod(method: string | undefined): string {
  return (method ?? "GET").trim().toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
