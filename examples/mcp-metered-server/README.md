# Example: metered MCP server (testnet)

An MCP server whose `echo` tool is wrapped with `meteredTool()` from
`@syncro/sdk`, so every call is charged on Stellar **testnet**. Callers get the
x402 payment challenge back in the tool result metadata, and settlement
receipts come back in `_meta["X-Syncro-Receipt"]`.

See [docs/integrations/mcp-metering.mdx](../../docs/integrations/mcp-metering.mdx)
for the protocol, the client payment flow, and the deferred stdio design.

## Requirements

- Node.js 20+
- A testnet payer Ed25519 key pair (PEM), never a mainnet key

## Run it

```bash
# From this directory. The SDK is published; for local changes use the
# workspace copy instead:  npm install ../../sdk
npm install

SYNCRO_NETWORK=testnet \
SYNCRO_PAYER_PUBLIC_KEY="$(cat payer-public.pem)" \
PRICE_USDC=0.01 \
  npm start
```

The server listens on `http://localhost:8787/mcp`.

## Try an unpaid call

`tools/call` without a proof comes back with `isError: true` and the challenge
in `_meta["PAYMENT-REQUIRED"]`:

```bash
curl -s http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"echo","arguments":{"text":"hello"}}}'
```

Pay the challenge with the payer testnet key, then retry the same call with a
`PAYMENT-SIGNATURE` header carrying the base64 x402 payload. The response
contains the echo output and the receipt in `_meta["X-Syncro-Receipt"]`.

## Files

- `src/server.ts` — the MCP server: tool registration, testnet proof
  verification, and the Streamable HTTP transport wiring.
