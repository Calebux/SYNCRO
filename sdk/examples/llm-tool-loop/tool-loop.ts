/**
 * Raw LLM tool-use loop over paid SYNCRO routes, with no agent framework.
 *
 * The loop only needs two things from the SDK:
 *   - `definitions`: JSON Schema tool specs (from `toToolDefinition`) to send to the model
 *   - `executeTool(call)`: runs a model tool call through `createPaidFetch`
 *
 * `Model` is the seam for a real LLM. Swap `scriptedModel` for a function that
 * calls your provider's tool-calling API and maps its tool calls to `ToolCall`
 * (see README.md in this folder).
 */
import { generateKeyPairSync, sign } from "node:crypto";
import {
  createPaidTools,
  type ProviderManifest,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
} from "../../src/v3/index.js";

// ─── Provider-neutral conversation types ────────────────────────────────────

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string; isError: boolean };

export interface ModelTurn {
  text?: string;
  toolCalls?: ToolCall[];
}

export type Model = (messages: Message[], tools: ToolDefinition[]) => Promise<ModelTurn>;

export interface ToolLoopResult {
  answer: string;
  messages: Message[];
  toolResults: ToolResult[];
  /** Total paid per asset, from settled calls. */
  spent: Record<string, number>;
}

// ─── The loop ───────────────────────────────────────────────────────────────

export async function runToolLoop(options: {
  model: Model;
  tools: ReturnType<typeof createPaidTools>;
  prompt: string;
  maxTurns?: number;
}): Promise<ToolLoopResult> {
  const { model, tools, prompt, maxTurns = 8 } = options;
  const messages: Message[] = [{ role: "user", content: prompt }];
  const toolResults: ToolResult[] = [];
  const spent: Record<string, number> = {};

  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = await model(messages, tools.definitions);
    messages.push({
      role: "assistant",
      ...(reply.text !== undefined && { content: reply.text }),
      ...(reply.toolCalls !== undefined && { toolCalls: reply.toolCalls }),
    });

    if (!reply.toolCalls?.length) {
      return { answer: reply.text ?? "", messages, toolResults, spent };
    }

    // Run every call from this turn, then hand all results back together.
    const results = await Promise.all(reply.toolCalls.map((call) => tools.executeTool(call)));
    results.forEach((result, i) => {
      toolResults.push(result);
      if (result.ok && result.receipt?.success && result.price) {
        const { asset, amount } = result.price;
        spent[asset] = (spent[asset] ?? 0) + Number(amount);
      }
      messages.push({
        role: "tool",
        callId: reply.toolCalls![i]!.id ?? `call_${turn}_${i}`,
        name: result.name,
        isError: !result.ok,
        content: JSON.stringify(
          result.ok
            ? { result: result.content, price: result.price, receipt: result.receipt }
            : { error: result.error, status: result.status },
        ),
      });
    });
  }

  throw new Error(`Tool loop did not finish within ${maxTurns} turns.`);
}

// ─── A scripted stand-in for an LLM ─────────────────────────────────────────

/**
 * Deterministic model stub so the example runs offline. It reads the cost
 * from each tool description (as a real model would), calls the cheapest
 * search tool once, then answers from the result.
 */
export const scriptedModel: Model = async (messages, tools) => {
  const toolMessage = [...messages].reverse().find((m) => m.role === "tool");
  if (toolMessage && toolMessage.role === "tool") {
    const payload = JSON.parse(toolMessage.content) as {
      result?: { hits?: string[] };
      price?: { amount: string; asset: string };
      error?: string;
    };
    if (payload.error) return { text: `I could not complete the search: ${payload.error}` };
    const hits = payload.result?.hits ?? [];
    return {
      text: `Found ${hits.length} result(s) via ${toolMessage.name} ` +
        `for ${payload.price?.amount} ${payload.price?.asset}: ${hits.join("; ")}`,
    };
  }

  const userPrompt = messages.find((m) => m.role === "user")?.content ?? "";
  const cheapest = tools
    .filter((tool) => tool.name.includes("search"))
    .map((tool) => ({ tool, cost: parseCost(tool.description) }))
    .sort((a, b) => a.cost - b.cost)[0];
  if (!cheapest) return { text: "No search tool is available." };

  return {
    toolCalls: [{ id: "call_1", name: cheapest.tool.name, arguments: JSON.stringify({ query: userPrompt }) }],
  };
};

function parseCost(description: string): number {
  const match = /Cost: ([\d.]+) /.exec(description);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

// ─── An in-process paid API so the example needs no network ────────────────

export const exampleManifest: ProviderManifest = {
  providerId: "example-search",
  gatewayUrl: "https://gateway.example.test/v1",
  routes: [
    {
      name: "search_basic",
      method: "GET",
      path: "/search",
      description: "Keyword search over the public index.",
      price: { amount: "0.001", asset: "USDC" },
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search query." } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "search_premium",
      method: "POST",
      path: "/search/premium",
      description: "Semantic search with reranking.",
      price: { amount: "0.01", asset: "USDC" },
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search query." } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  ],
};

/**
 * A fake gateway that answers the first request with a signed 402
 * `PAYMENT-REQUIRED` challenge and the paid retry with a result plus a
 * `PAYMENT-RESPONSE` receipt, exactly as `createPaidFetch` expects.
 */
export function createMockGateway(manifest: ProviderManifest = exampleManifest) {
  const gatewayKeys = generateKeyPairSync("ed25519");
  const payerKeys = generateKeyPairSync("ed25519");
  let settled = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const route = manifest.routes.find(
      (r) => `${manifest.gatewayUrl}${r.path}` === `${url.origin}${url.pathname}`,
    );
    if (!route) return new Response("not found", { status: 404 });

    const paid = new Headers(init.headers).get("PAYMENT-SIGNATURE");
    if (!paid) {
      const challenge = {
        x402Version: 2,
        resource: { url: url.toString() },
        accepts: [{
          scheme: "exact",
          network: "stellar:testnet",
          amount: String(route.price.amount),
          asset: route.price.asset,
          payTo: "GEXAMPLEPROVIDER",
        }],
      };
      const signature = sign(null, Buffer.from(canonicalize(challenge)), gatewayKeys.privateKey)
        .toString("base64");
      return new Response(JSON.stringify({ code: "PAYMENT_REQUIRED" }), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": btoa(JSON.stringify({ ...challenge, signature })),
        },
      });
    }

    settled += 1;
    const query = url.searchParams.get("query") ??
      (JSON.parse(String(init.body ?? "{}")) as { query?: string }).query;
    return new Response(JSON.stringify({ hits: [`${route.name}: top match for "${query}"`] }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "PAYMENT-RESPONSE": btoa(JSON.stringify({
          success: true,
          transaction: `tx_${settled}`,
          network: "stellar:testnet",
        })),
      },
    });
  }) as typeof fetch;

  return {
    fetchImpl,
    gatewayPublicKey: gatewayKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    spendingKey: payerKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}
