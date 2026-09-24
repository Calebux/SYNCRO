import {
  GatewayErrorCode,
  GatewaySdkError,
  createGatewayErrorFromCode,
  createGatewayErrorFromHttpStatus,
} from "../generated/gateway-errors.js";
import { DefaultRetryPolicy, LogicalCallManager, LogicalCallOptions } from "./retry.js";

export interface GatewayClientOptions {
  fetchImpl?: typeof fetch;
  retryPolicy?: DefaultRetryPolicy;
  baseHeaders?: Record<string, string>;
}

interface GatewayErrorPayload {
  code?: GatewayErrorCode;
  message?: string;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) return undefined;
  const asNumber = Number(retryAfter);
  if (Number.isFinite(asNumber)) return asNumber * 1000;
  const asDate = Date.parse(retryAfter);
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, asDate - Date.now());
}

async function toGatewayError(response: Response): Promise<GatewaySdkError> {
  let payload: GatewayErrorPayload = {};
  try {
    payload = (await response.json()) as GatewayErrorPayload;
  } catch {
    payload = {};
  }

  const retryAfterMs = parseRetryAfterMs(response.headers);
  if (payload.code) {
    return createGatewayErrorFromCode(payload.code, {
      message: payload.message,
      status: response.status,
      retryAfterMs,
    });
  }

  const byStatus = createGatewayErrorFromHttpStatus(response.status, {
    message: payload.message ?? `Gateway responded with status ${response.status}.`,
    status: response.status,
    retryAfterMs,
  });
  return (
    byStatus ??
    createGatewayErrorFromCode("GATEWAY_INTERNAL", {
      message: payload.message ?? `Gateway responded with status ${response.status}.`,
      status: response.status,
      retryAfterMs,
    })
  );
}

export class GatewayClient {
  private readonly fetchImpl: typeof fetch;
  private readonly callManager: LogicalCallManager;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: GatewayClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.callManager = new LogicalCallManager(options.retryPolicy);
    this.baseHeaders = options.baseHeaders ?? {};
  }

  async logicalCallJson<T>(
    input: RequestInfo | URL,
    init: RequestInit = {},
    logicalCallOptions: LogicalCallOptions = {},
  ): Promise<T> {
    return this.callManager.executeWithRetry<T>(
      async ({ idempotencyKey }) => {
        const headers = new Headers(init.headers);
        for (const [name, value] of Object.entries(this.baseHeaders)) {
          headers.set(name, value);
        }
        headers.set("idempotency-key", idempotencyKey);

        const response = await this.fetchImpl(input, {
          ...init,
          headers,
        });

        if (!response.ok) {
          throw await toGatewayError(response);
        }

        return (await response.json()) as T;
      },
      logicalCallOptions,
    );
  }
}
