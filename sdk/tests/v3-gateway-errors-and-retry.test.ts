import {
  GatewayChannelExhaustedError,
  GatewayRateLimitedError,
  createGatewayErrorFromCode,
} from "../src/generated/gateway-errors.js";
import { GatewayClient } from "../src/v3/gateway-client.js";
import { IdempotencyKeyReuseError, LogicalCallManager } from "../src/v3/retry.js";

describe("v3 generated gateway errors", () => {
  it("creates typed errors from taxonomy definition", () => {
    const err = createGatewayErrorFromCode("GATEWAY_RATE_LIMITED", {
      retryAfterSeconds: 2,
    });
    expect(err).toBeInstanceOf(GatewayRateLimitedError);
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(2000);
  });

  it("marks channel exhausted as non-retryable", () => {
    const err = createGatewayErrorFromCode("GATEWAY_CHANNEL_EXHAUSTED");
    expect(err).toBeInstanceOf(GatewayChannelExhaustedError);
    expect(err.retryable).toBe(false);
  });
});

describe("v3 retry + idempotency propagation", () => {
  it("reuses one idempotency key across retries and avoids double charge", async () => {
    const seenByLogicalCall = new Map<string, number>();
    const chargeCountByKey = new Map<string, number>();

    const fetchImpl: typeof fetch = async (_input, init) => {
      const idempotencyKey = new Headers(init?.headers).get("idempotency-key");
      if (!idempotencyKey) {
        throw new Error("missing idempotency key");
      }

      const attempts = (seenByLogicalCall.get(idempotencyKey) ?? 0) + 1;
      seenByLogicalCall.set(idempotencyKey, attempts);
      chargeCountByKey.set(idempotencyKey, (chargeCountByKey.get(idempotencyKey) ?? 0) + 1);

      if (attempts === 1) {
        return new Response(
          JSON.stringify({ code: "GATEWAY_RATE_LIMITED", message: "retry me once" }),
          { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } },
        );
      }

      return new Response(JSON.stringify({ charged: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = new GatewayClient({
      fetchImpl,
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
        jitterRatio: 0,
        maxTotalDurationMs: 200,
      },
    });

    const result = await client.logicalCallJson<{ charged: boolean }>("https://example.com/pay", {
      method: "POST",
      body: JSON.stringify({ amount: 100 }),
      headers: { "content-type": "application/json" },
    });

    expect(result.charged).toBe(true);
    expect(seenByLogicalCall.size).toBe(1);
    const onlyKey = Array.from(seenByLogicalCall.keys())[0];
    expect(seenByLogicalCall.get(onlyKey)).toBe(2);
    expect(chargeCountByKey.get(onlyKey)).toBe(2);
  });

  it("creates a new idempotency key for each distinct logical call", async () => {
    const capturedKeys: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      capturedKeys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = new GatewayClient({ fetchImpl });
    await client.logicalCallJson("https://example.com/pay", { method: "POST" });
    await client.logicalCallJson("https://example.com/pay", { method: "POST" });

    expect(capturedKeys[0]).toBeTruthy();
    expect(capturedKeys[1]).toBeTruthy();
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
  });

  it("detects accidental explicit idempotency key reuse", async () => {
    const manager = new LogicalCallManager();
    await manager.executeWithRetry(async () => "ok", { idempotencyKey: "fixed-key" });

    await expect(
      manager.executeWithRetry(async () => "ok", { idempotencyKey: "fixed-key" }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
  });

  it("surfaces underlying error when retry budget is exhausted", async () => {
    const err = createGatewayErrorFromCode("GATEWAY_RATE_LIMITED", { retryAfterMs: 50 });
    const manager = new LogicalCallManager(
      {
        maxAttempts: 10,
        baseDelayMs: 1,
        maxDelayMs: 1,
        jitterRatio: 0,
        maxTotalDurationMs: 5,
      },
      {
        sleepMs: async () => undefined,
      },
    );

    await expect(
      manager.executeWithRetry(async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });
});
