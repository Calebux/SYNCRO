---
"@syncro/sdk": minor
---

Add `meteredTool(handler, pricing)` — a provider-side wrapper that brings SYNCRO metering to MCP tool handlers. A tool call without a valid payment proof returns an `isError` result whose `_meta` carries the base64 x402 `PAYMENT-REQUIRED` challenge (the same value the HTTP middleware writes to that header); the client pays and retries with `_meta["PAYMENT-SIGNATURE"]`, and settled calls return their receipt in `_meta["X-Syncro-Receipt"]`. HTTP/SSE transports read the proof from the request header; header-less transports use `_meta`.
