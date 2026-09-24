import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { createPaidFetch } from "../src/v3/paid-fetch.js";

describe("createPaidFetch", () => {
  const makeConfig = (overrides: Record<string, unknown> = {}) => ({
    spendingKey:
      "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIBiY8Kz3L5vF9xH2Q1nR8Y7Kz3L5vF9xH2Q1nR8Y7Kz3L\n-----END PRIVATE KEY-----",
    ...overrides,
  });

  it("throws when neither spendingKey nor sign is provided", () => {
    expect(() => createPaidFetch({})).toThrow(
      /Either `spendingKey` or `sign` must be provided/,
    );
  });

  it("throws when spendingKey is used in a browser environment", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error – simulate browser environment
    globalThis.window = {};
    try {
      expect(() =>
        createPaidFetch({ spendingKey: "raw-key" }),
      ).toThrow(/Spending keys should not be stored in the browser/);
    } finally {
      // @ts-expect-error – restore
      globalThis.window = originalWindow;
    }
  });

  it("returns a fetch-compatible function", () => {
    const fetch = createPaidFetch(makeConfig());
    expect(typeof fetch).toBe("function");
  });

  it("passes through normal (non-402) responses unchanged", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const fetch = createPaidFetch({ ...makeConfig(), fetchImpl });
    const response = await fetch("https://example.com/data");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.receipt).toBeUndefined();
  });

  it("handles a 402 challenge and retries with PAYMENT-SIGNATURE header", async () => {
    let callCount = 0;
    const fetchImpl = jest.fn(async (_input: RequestInfo, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        const paymentRequired = {
          x402Version: 2,
          accepts: [
            {
              scheme: "exact",
              network: "eip155:84532",
              amount: "1000",
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
              maxTimeoutSeconds: 60,
            },
          ],
        };
        return new Response(
          JSON.stringify({ code: "GATEWAY_CHANNEL_EXHAUSTED" }),
          {
            status: 402,
            headers: {
              "content-type": "application/json",
              "PAYMENT-REQUIRED": btoa(JSON.stringify(paymentRequired)),
            },
          },
        );
      }
      // Second call — verify PAYMENT-SIGNATURE header is present
      const headers = new Headers(init?.headers);
      const paymentSignature = headers.get("PAYMENT-SIGNATURE");
      expect(paymentSignature).toBeTruthy();

      const parsed = JSON.parse(atob(paymentSignature!));
      expect(parsed.x402Version).toBe(2);
      expect(parsed.accepted).toBeDefined();
      expect(parsed.payload).toBeDefined();
      expect(parsed.payload.signature).toBeTruthy();

      // Return a successful response with PAYMENT-RESPONSE header
      return new Response(
        JSON.stringify({ charged: true }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": btoa(
              JSON.stringify({
                success: true,
                transaction: "0xabc123",
                network: "eip155:84532",
              }),
            ),
          },
        },
      );
    });

    // Use a sign function so we don't depend on node:crypto in tests
    const sign = jest.fn((payload: string) => {
      return `sig-${Buffer.from(payload).toString("hex")}`;
    });

    const fetch = createPaidFetch({
      ...makeConfig(),
      fetchImpl,
      sign,
    });

    const response = await fetch("https://example.com/pay", {
      method: "POST",
      body: JSON.stringify({ amount: 100 }),
    });

    expect(response.status).toBe(200);
    expect(response.receipt).toBeDefined();
    expect(response.receipt?.success).toBe(true);
    expect(response.receipt?.transaction).toBe("0xabc123");
    expect(response.receipt?.network).toBe("eip155:84532");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("returns 402 response as-is when PAYMENT-REQUIRED header is missing", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "payment required" }), {
        status: 402,
        headers: { "content-type": "application/json" },
      }),
    );

    const fetch = createPaidFetch({ ...makeConfig(), fetchImpl });
    const response = await fetch("https://example.com/pay");

    expect(response.status).toBe(402);
    expect(response.receipt).toBeUndefined();
  });

  it("returns 402 response as-is when no accepts are present", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: "GATEWAY_CHANNEL_EXHAUSTED" }),
        {
          status: 402,
          headers: {
            "content-type": "application/json",
            "PAYMENT-REQUIRED": btoa(
              JSON.stringify({ x402Version: 2, accepts: [] }),
            ),
          },
        },
      ),
    );

    const fetch = createPaidFetch({ ...makeConfig(), fetchImpl });
    const response = await fetch("https://example.com/pay");

    expect(response.status).toBe(402);
    expect(response.receipt).toBeUndefined();
  });

  it("propagates idempotency-key header through retry", async () => {
    let callCount = 0;
    const fetchImpl = jest.fn(async (_input: RequestInfo, init?: RequestInit) => {
      callCount++;
      const headers = new Headers(init?.headers);
      const idempotencyKey = headers.get("idempotency-key");

      if (callCount === 1) {
        const paymentRequired = {
          x402Version: 2,
          accepts: [
            {
              scheme: "exact",
              network: "eip155:84532",
              amount: "1000",
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
              maxTimeoutSeconds: 60,
            },
          ],
        };
        return new Response(
          JSON.stringify({ code: "GATEWAY_CHANNEL_EXHAUSTED" }),
          {
            status: 402,
            headers: {
              "content-type": "application/json",
              "PAYMENT-REQUIRED": btoa(JSON.stringify(paymentRequired)),
            },
          },
        );
      }

      // Verify idempotency-key is preserved on retry
      expect(idempotencyKey).toBeTruthy();

      return new Response(
        JSON.stringify({ charged: true }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": btoa(
              JSON.stringify({ success: true, transaction: "0xdef456" }),
            ),
          },
        },
      );
    });

    const sign = jest.fn(() => "test-signature");

    const fetch = createPaidFetch({
      ...makeConfig(),
      fetchImpl,
      sign,
    });

    const response = await fetch("https://example.com/pay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "my-key-123",
      },
      body: JSON.stringify({ amount: 100 }),
    });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("extracts no receipt when PAYMENT-RESPONSE header is absent on retry", async () => {
    let callCount = 0;
    const fetchImpl = jest.fn(async (_input: RequestInfo, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        const paymentRequired = {
          x402Version: 2,
          accepts: [
            {
              scheme: "exact",
              network: "eip155:84532",
              amount: "1000",
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
              maxTimeoutSeconds: 60,
            },
          ],
        };
        return new Response(
          JSON.stringify({ code: "GATEWAY_CHANNEL_EXHAUSTED" }),
          {
            status: 402,
            headers: {
              "content-type": "application/json",
              "PAYMENT-REQUIRED": btoa(JSON.stringify(paymentRequired)),
            },
          },
        );
      }

      // Retry succeeds but has no PAYMENT-RESPONSE header
      return new Response(JSON.stringify({ charged: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const sign = jest.fn(() => "test-signature");

    const fetch = createPaidFetch({
      ...makeConfig(),
      fetchImpl,
      sign,
    });

    const response = await fetch("https://example.com/pay", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.receipt).toBeUndefined();
  });

  it("handles malformed PAYMENT-RESPONSE header gracefully", async () => {
    let callCount = 0;
    const fetchImpl = jest.fn(async (_input: RequestInfo, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        const paymentRequired = {
          x402Version: 2,
          accepts: [
            {
              scheme: "exact",
              network: "eip155:84532",
              amount: "1000",
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
              maxTimeoutSeconds: 60,
            },
          ],
        };
        return new Response(
          JSON.stringify({ code: "GATEWAY_CHANNEL_EXHAUSTED" }),
          {
            status: 402,
            headers: {
              "content-type": "application/json",
              "PAYMENT-REQUIRED": btoa(JSON.stringify(paymentRequired)),
            },
          },
        );
      }

      // Retry with malformed PAYMENT-RESPONSE header
      return new Response(JSON.stringify({ charged: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "PAYMENT-RESPONSE": "not-valid-base64!!!",
        },
      });
    });

    const sign = jest.fn(() => "test-signature");

    const fetch = createPaidFetch({
      ...makeConfig(),
      fetchImpl,
      sign,
    });

    const response = await fetch("https://example.com/pay", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.receipt).toBeUndefined();
  });

  it("does not retry on 402 if retry also returns 402 (infinite loop protection)", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: "GATEWAY_CHANNEL_EXHAUSTED" }),
        {
          status: 402,
          headers: {
            "content-type": "application/json",
            "PAYMENT-REQUIRED": btoa(
              JSON.stringify({
                x402Version: 2,
                accepts: [
                  {
                    scheme: "exact",
                    network: "eip155:84532",
                    amount: "1000",
                    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                    payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
                    maxTimeoutSeconds: 60,
                  },
                ],
              }),
            ),
          },
        },
      ),
    );

    const sign = jest.fn(() => "test-signature");

    const fetch = createPaidFetch({
      ...makeConfig(),
      fetchImpl,
      sign,
    });

    const response = await fetch("https://example.com/pay", {
      method: "POST",
    });

    expect(response.status).toBe(402);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // First call + one retry
    expect(sign).toHaveBeenCalledTimes(1);
  });
});
