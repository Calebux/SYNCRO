/**
 * Example: an MCP server that charges per tool call on Stellar testnet.
 *
 * Every call to the `echo` tool is wrapped with `meteredTool()` from
 * `@syncro/sdk`. A caller that has not paid receives the x402 challenge in the
 * tool result metadata (`_meta["PAYMENT-REQUIRED"]`); after paying, the caller
 * retries with `PAYMENT-SIGNATURE` and gets the echo output plus a settlement
 * receipt in `_meta["X-Syncro-Receipt"]`.
 *
 * Testnet only: the server refuses to start unless `SYNCRO_NETWORK=testnet`.
 * See docs/integrations/mcp-metering.mdx for the full protocol and the client
 * payment flow.
 */
import { createServer } from "node:http";
import { verify as verifySignature } from "node:crypto";
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { meteredTool, type SyncroReceipt } from "@syncro/sdk";

// ── Testnet configuration ────────────────────────────────────────────────────

if (process.env.SYNCRO_NETWORK !== "testnet") {
  throw new Error("This example is testnet-only. Start it with SYNCRO_NETWORK=testnet.");
}

const PORT = Number(process.env.PORT ?? "8787");
const PRICE_USDC = Number(process.env.PRICE_USDC ?? "0.01");
const PAYER_PUBLIC_KEY = process.env.SYNCRO_PAYER_PUBLIC_KEY;

if (!PAYER_PUBLIC_KEY) {
  throw new Error(
    "Set SYNCRO_PAYER_PUBLIC_KEY to the testnet payer's Ed25519 public key (PEM).",
  );
}

// ── Payment proof verification ───────────────────────────────────────────────
//
// A proof is a base64-encoded x402 payload:
//   { x402Version, accepted, payload: { signature } }
// The signature is Ed25519 over the canonical JSON of the challenge the server
// issued, signed by the payer's testnet key.

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
    .join(",")}}`;
}

function verifyTestnetProof(proof: string | undefined): boolean {
  if (!proof) return false;

  let envelope: { x402Version?: number; accepted?: unknown; payload?: { signature?: string } };
  try {
    envelope = JSON.parse(Buffer.from(proof, "base64").toString("utf8"));
  } catch {
    return false;
  }

  const signature = envelope.payload?.signature;
  if (!envelope.accepted || typeof signature !== "string") return false;

  const unsigned = {
    x402Version: envelope.x402Version ?? 2,
    accepted: envelope.accepted,
    payload: {},
  };

  try {
    return verifySignature(
      null,
      Buffer.from(canonicalizeJson(unsigned), "utf8"),
      PAYER_PUBLIC_KEY,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

// ── Metered MCP server ───────────────────────────────────────────────────────

const server = new McpServer({ name: "syncro-metered-echo", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    title: "Echo",
    description: `Echoes text back. Costs ${PRICE_USDC} USDC (testnet) per call.`,
    inputSchema: { text: z.string() },
  },
  meteredTool(
    async ({ text }) => ({ content: [{ type: "text", text }] }),
    { defaultPrice: PRICE_USDC, currency: "USDC" },
    {
      toolName: "echo",
      verifyProof: (proof) => verifyTestnetProof(proof),
      meterCall: (receipt: SyncroReceipt) => {
        console.log(
          `[syncro] settled ${receipt.id} route=${receipt.route} ` +
            `amount=${receipt.amount} ${receipt.currency} payer=${receipt.payer}`,
        );
      },
    },
  ),
);

// ── HTTP transport (Streamable HTTP) ─────────────────────────────────────────
//
// HTTP is the first transport the wrapper targets: the payment proof arrives in
// the `PAYMENT-SIGNATURE` request header, which the transport exposes to the
// tool handler as `extra.requestInfo.headers`.

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

createServer(app).listen(PORT, () => {
  console.log(
    `[syncro] metered MCP server on http://localhost:${PORT}/mcp ` +
      `(Stellar testnet, ${PRICE_USDC} USDC per echo call)`,
  );
});
