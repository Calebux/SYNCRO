# External Service Timeout and Retry Policies

This document outlines the centralized management of timeouts and retries for external dependencies in the SYNCRO backend.

## Centralized Client

All external HTTP requests should use the `ExternalServiceClient` located in `backend/src/utils/external-service-client.ts`. This client provides:

1.  **Service-specific Timeouts**: Prevents external latencies from hanging the backend.
2.  **Retry Policies**: Implements exponential backoff with jitter for transient failures.
3.  **Metrics Tracking**: Records total requests, successes, failures, and timeouts per service.
4.  **Admin Exposure**: Metrics are available via the `/api/v1/admin/metrics/external-services` endpoint.

## Configuration

Policies are defined in `backend/src/config/external-services.ts`.

| Service | Timeout (ms) | Max Retries | Initial Delay (ms) |
| :--- | :--- | :--- | :--- |
| **Gmail** | 15,000 | 3 | 1,000 |
| **Outlook** | 15,000 | 3 | 1,000 |
| **Stellar RPC** | 5,000 | 5 | 500 |
| **Stripe** | 10,000 | 2 | 1,000 |
| **Paystack** | 10,000 | 2 | 1,000 |
| **Exchange Rates** | 5,000 | 3 | 1,000 |
| **LLM (Gemini)** | 30,000 | 2 | 2,000 |
| **Outbound Webhooks** | 10,000 | 5 | 2,000 |
| **Slack** | 5,000 | 3 | 1,000 |
| **Telegram** | 10,000 | 3 | 1,000 |
| **Default** | 10,000 | 3 | 1,000 |

## Usage Example

```typescript
import { ExternalServiceClient } from '../utils/external-service-client';

const client = new ExternalServiceClient('exchange_rates');

async function getRates() {
  const data = await client.request('https://api.exchangerate-api.com/v4/latest/USD');
  return data;
}
```

## Metrics Monitoring

Admin users can monitor service health via:
`GET /api/v1/admin/metrics/external-services`

Example response:
```json
{
  "exchange_rates": {
    "totalRequests": 150,
    "successfulRequests": 148,
    "failedRequests": 2,
    "timeoutRequests": 1,
    "retryCount": 5
  }
}
```
