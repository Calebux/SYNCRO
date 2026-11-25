import { describe, it, expect, jest } from "@jest/globals";
import Ajv from "ajv";
import {
  createPaidTools,
  executeTool,
  toToolDefinition,
  type PaidRoute,
  type ProviderManifest,
} from "../src/v3/tools.js";
import {
  createMockGateway,
  exampleManifest,
  runToolLoop,
  scriptedModel,
} from "../examples/llm-tool-loop/tool-loop.js";

// Ajv's default class implements JSON Schema draft-07, the draft used in this repo.
const ajv = new Ajv({ strict: true });

const route = (overrides: Partial<PaidRoute> = {}): PaidRoute => ({
  method: "GET",
  path: "/v1/search",
  description: "Search the index.",
  price: { amount: "0.002", asset: "USDC" },
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  ...overrides,
});

const manifest = (routes: PaidRoute[]): ProviderManifest => ({
  gatewayUrl: "https://gateway.example.test/api/",
  routes,
});

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
  });

describe("toToolDefinition", () => {
  it("emits a name, a cost-bearing description and the route's parameter schema", () => {
    const def = toToolDefinition(route({ name: "search" }));
    expect(def).toEqual({
      name: "search",
      description: "Search the index. Cost: 0.002 USDC per call.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    });
  });

  it("includes a custom billing unit in the cost", () => {
    const def = toToolDefinition(route({ price: { amount: 0.5, asset: "XLM", unit: "1K tokens" } }));
    expect(def.description).toBe("Search the index. Cost: 0.5 XLM per 1K tokens.");
  });

  it("derives a provider-safe name from method and path, including path params", () => {
    expect(toToolDefinition(route({ path: "/v1/items/{itemId}/price" })).name)
      .toBe("get_v1_items_by_itemid_price");
    expect(toToolDefinition(route({ method: "post", path: "/v1/jobs/:id" })).name)
      .toBe("post_v1_jobs_by_id");
  });

  it("adds path parameters as required string properties", () => {
    const def = toToolDefinition(route({ path: "/v1/items/{itemId}", parameters: undefined }));
    expect(def.parameters).toEqual({
      type: "object",
      properties: { itemId: { type: "string", description: 'Path parameter "itemId".' } },
      required: ["itemId"],
      additionalProperties: false,
    });
  });

  it("does not mutate the manifest route", () => {
    const r = route({ path: "/v1/items/{itemId}" });
    const before = structuredClone(r);
    toToolDefinition(r);
    expect(r).toEqual(before);
  });

  it("falls back to METHOD path when the route has no description", () => {
    expect(toToolDefinition(route({ description: undefined })).description)
      .toBe("GET /v1/search Cost: 0.002 USDC per call.");
  });

  it.each([
    ["invalid name", { name: "has spaces" }, /Invalid tool name/],
    ["negative price", { price: { amount: -1, asset: "USDC" } }, /Invalid route price/],
    ["non-numeric price", { price: { amount: "free", asset: "USDC" } }, /Invalid route price/],
    ["missing asset", { price: { amount: "1", asset: "" } }, /must name an asset/],
    ["non-object parameters", { parameters: { type: "string" } }, /type "object"/],
  ])("rejects a route with %s", (_label, overrides, message) => {
    expect(() => toToolDefinition(route(overrides as Partial<PaidRoute>))).toThrow(message);
  });

  describe("JSON Schema draft-07 validity", () => {
    const routes: PaidRoute[] = [
      route(),
      route({ path: "/v1/items/{itemId}", parameters: undefined }),
      route({
        method: "POST",
        path: "/v1/orders/:orderId/refund",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", enum: ["duplicate", "fraud"] },
            amount: { type: "number", minimum: 0 },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["reason"],
        },
      }),
      ...exampleManifest.routes,
    ];

    it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
      "%s produces a valid draft-07 schema",
      (_label, r) => {
        const def = toToolDefinition(r);
        expect(ajv.validateSchema(def.parameters)).toBe(true);
        expect(ajv.errors ?? null).toBeNull();
        // Compiling in strict mode also rejects unknown keywords and bad structure.
        expect(() => ajv.compile(def.parameters)).not.toThrow();
        expect(def.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      },
    );
  });
});

describe("executeTool", () => {
  it("sends GET arguments as a query string through the paid fetch", async () => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ hits: ["a"] }));

    const result = await executeTool(
      { id: "call_1", name: "search", arguments: { query: "x y", limit: 3, tags: ["a", "b"] } },
      { manifest: manifest([route({ name: "search" })]), fetch: fetchImpl as typeof fetch },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://gateway.example.test/api/v1/search?query=x+y&limit=3&tags=a&tags=b");
    expect(init).toEqual({ method: "GET" });
    expect(result).toEqual({
      callId: "call_1",
      name: "search",
      ok: true,
      status: 200,
      content: { hits: ["a"] },
      price: { amount: "0.002", asset: "USDC" },
    });
  });

  it("fills path params and sends other arguments as a JSON body", async () => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ refunded: true }));
    const r = route({
      name: "refund",
      method: "POST",
      path: "/v1/orders/{orderId}/refund",
      parameters: { type: "object", properties: { reason: { type: "string" } } },
    });

    const result = await executeTool(
      { name: "refund", arguments: JSON.stringify({ orderId: "o/1", reason: "dup" }) },
      { manifest: manifest([r]), fetch: fetchImpl as typeof fetch },
    );

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://gateway.example.test/api/v1/orders/o%2F1/refund");
    expect(init).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "dup" }),
    });
    expect(result.ok).toBe(true);
  });

  it("returns the receipt attached by createPaidFetch", async () => {
    const receipt = { success: true, transaction: "tx_9", network: "stellar:testnet" };
    const fetchImpl = (async () =>
      Object.assign(jsonResponse({ ok: 1 }), { receipt })) as unknown as typeof fetch;

    const result = await executeTool(
      { name: "search", arguments: { query: "q" } },
      { manifest: manifest([route({ name: "search" })]), fetch: fetchImpl },
    );
    expect(result.receipt).toEqual(receipt);
  });

  it.each([
    ["an unknown tool", { name: "nope", arguments: {} }, /Unknown tool "nope"/],
    ["non-JSON arguments", { name: "search", arguments: "{bad" }, /must be a JSON object/],
    ["array arguments", { name: "search", arguments: "[1]" }, /must be a JSON object/],
    ["a missing required argument", { name: "search", arguments: {} }, /Missing required argument\(s\): query/],
  ])("returns a tool error without calling the provider for %s", async (_label, call, message) => {
    const fetchImpl = jest.fn(async () => jsonResponse({}));
    const result = await executeTool(call, {
      manifest: manifest([route({ name: "search" })]),
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(message);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [402, /Payment required/],
    [503, /HTTP 503/],
  ])("reports HTTP %i as a tool error instead of throwing", async (status, message) => {
    const fetchImpl = (async () => jsonResponse({ code: "X" }, { status })) as unknown as typeof fetch;
    const result = await executeTool(
      { name: "search", arguments: { query: "q" } },
      { manifest: manifest([route({ name: "search" })]), fetch: fetchImpl },
    );
    expect(result).toMatchObject({ ok: false, status, content: { code: "X" } });
    expect(result.error).toMatch(message);
  });

  it("reports network failures as a tool error", async () => {
    const fetchImpl = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    const result = await executeTool(
      { name: "search", arguments: { query: "q" } },
      { manifest: manifest([route({ name: "search" })]), fetch: fetchImpl },
    );
    expect(result).toMatchObject({ ok: false, error: "Request failed: ECONNRESET" });
  });

  it("returns non-JSON bodies as text", async () => {
    const fetchImpl = (async () => new Response("plain", { status: 200 })) as unknown as typeof fetch;
    const result = await executeTool(
      { name: "search", arguments: { query: "q" } },
      { manifest: manifest([route({ name: "search" })]), fetch: fetchImpl },
    );
    expect(result.content).toBe("plain");
  });

  it("requires a fetch or paid fetch config", async () => {
    await expect(
      executeTool({ name: "search", arguments: {} }, { manifest: manifest([route()]) }),
    ).rejects.toThrow(/Provide `fetch`/);
  });

  it("rejects manifests with duplicate tool names", () => {
    expect(() =>
      createPaidTools({
        manifest: manifest([route({ name: "dup" }), route({ name: "dup", path: "/v2" })]),
        fetch: (async () => jsonResponse({})) as unknown as typeof fetch,
      }),
    ).toThrow(/Duplicate tool name "dup"/);
  });
});

describe("example: raw tool-use loop with no framework", () => {
  it("pays a 402 challenge end to end through createPaidFetch and picks the cheaper tool", async () => {
    const gateway = createMockGateway();
    const tools = createPaidTools({
      manifest: exampleManifest,
      paidFetch: {
        spendingKey: gateway.spendingKey,
        gatewayPublicKey: gateway.gatewayPublicKey,
        fetchImpl: gateway.fetchImpl,
      },
    });

    const result = await runToolLoop({ model: scriptedModel, tools, prompt: "payment channels" });

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      name: "search_basic",
      ok: true,
      status: 200,
      receipt: { success: true, transaction: "tx_1", network: "stellar:testnet" },
    });
    expect(result.spent).toEqual({ USDC: 0.001 });
    expect(result.answer).toContain("search_basic");
    expect(result.answer).toContain('top match for "payment channels"');
  });

  it("surfaces an unverifiable challenge to the model as a tool error", async () => {
    const gateway = createMockGateway();
    const otherGateway = createMockGateway();
    const tools = createPaidTools({
      manifest: exampleManifest,
      paidFetch: {
        spendingKey: gateway.spendingKey,
        gatewayPublicKey: otherGateway.gatewayPublicKey, // wrong key: challenge must not be paid
        fetchImpl: gateway.fetchImpl,
      },
    });

    const result = await runToolLoop({ model: scriptedModel, tools, prompt: "q" });

    expect(result.toolResults[0]).toMatchObject({ ok: false, status: 402 });
    expect(result.toolResults[0]?.receipt).toBeUndefined();
    expect(result.spent).toEqual({});
    expect(result.answer).toMatch(/could not complete the search: Payment required/);
  });
});
