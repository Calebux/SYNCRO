# Gateway Error Taxonomy

Gateway failures return JSON with `Content-Type: application/json` and a stable
`code`. Clients should branch on `code`, not on the status alone. The canonical
source for this table is `backend/src/errors/gateway-taxonomy.json`; the SDK
typed errors are generated from it.

| Code | Status | Client action | Retry | Default delay |
| --- | ---: | --- | --- | ---: |
| `GATEWAY_PAYMENT_REQUIRED` | 402 | Provide payment authorization | No | - |
| `GATEWAY_KEY_MISSING` | 401 | Provide credentials | No | - |
| `GATEWAY_KEY_INVALID` | 401 | Refresh credentials | No | - |
| `GATEWAY_KEY_REVOKED` | 403 | Replace credentials | No | - |
| `GATEWAY_SCOPE_DENIED` | 403 | Request scope access | No | - |
| `GATEWAY_GRANT_EXPIRED` | 403 | Refresh the grant | No | - |
| `GATEWAY_CAP_EXCEEDED` | 403 | Request a cap increase | No | - |
| `GATEWAY_CHANNEL_EXHAUSTED` | 402 | Fund the payment channel | No | - |
| `GATEWAY_METER_INSUFFICIENT` | 402 | Fund the meter | No | - |
| `GATEWAY_RATE_LIMITED` | 429 | Wait, then retry | Yes | 1s |
| `GATEWAY_UPSTREAM_UNAVAILABLE` | 503 | Retry | Yes | 5s |
| `GATEWAY_METER_DEGRADED` | 503 | Retry | Yes | 10s |
| `GATEWAY_BAD_REQUEST` | 400 | Fix the request | No | - |
| `GATEWAY_UNAUTHORIZED` | 401 | Provide credentials | No | - |
| `GATEWAY_INTERNAL` | 500 | Retry | Yes | 5s |

Retryable responses include `Retry-After` in seconds when a delay is defined.
The SDK exposes each code as a typed error with `code`, `status`, `action`,
`retryable`, and `retryAfterMs` properties. It retries only errors marked
retryable by the taxonomy and never retries payment, credential, scope, grant,
cap, channel, or meter-funding failures automatically.