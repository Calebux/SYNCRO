import { describe, it, expect, jest } from "@jest/globals";
import { pricing, metered, hostedGateway } from "../src/index.js";

describe("Provider SDK", () => {
  describe("pricing() declaration", () => {
    it("should create default pricing when given a number", () => {
      const rateCard = pricing(0.05);
      expect(rateCard.defaultPrice).toBe(0.05);
      expect(rateCard.currency).toBe("USDC");

      const match = rateCard.match("GET", "/api/anything");
      expect(match.price).toBe(0.05);
      expect(match.currency).toBe("USDC");
    });

    it("should match exact and route-specific pricing rules", () => {
      const rateCard = pricing({
        defaultPrice: 0.01,
        currency: "USDC",
        routes: {
          "GET /api/v1/free-data": 0,
          "POST /api/v1/generate": 0.10,
          "/api/v1/compute": { price: 0.25, currency: "USDC", description: "Compute task" },
        },
      });

      expect(rateCard.match("GET", "/api/v1/free-data").price).toBe(0);
      expect(rateCard.match("POST", "/api/v1/generate").price).toBe(0.10);
      expect(rateCard.match("GET", "/api/v1/compute").price).toBe(0.25);
      expect(rateCard.match("GET", "/api/v1/compute").description).toBe("Compute task");
      expect(rateCard.match("GET", "/api/v1/unknown").price).toBe(0.01);
    });
  });

  describe("metered() middleware", () => {
    it("should serve free when route price is 0", async () => {
      const rateCard = pricing({
        routes: { "GET /api/public": 0 },
      });

      const mw = metered(rateCard);
      const req = { method: "GET", path: "/api/public", headers: {} };
      const setHeaderMock = jest.fn();
      const res = { setHeader: setHeaderMock, locals: {} };
      const next = jest.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.locals.syncroReceipt).toBeDefined();
      expect(res.locals.syncroReceipt.amount).toBe(0);
      expect(res.locals.syncroReceipt.status).toBe("free");
    });

    it("should reject request with 402 when payment proof is missing", async () => {
      const rateCard = pricing(0.05);
      const mw = metered(rateCard);

      const req = { method: "POST", path: "/api/generate", headers: {}, originalUrl: "/api/generate" };
      const setHeaderMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const jsonMock = jest.fn();
      const res = { setHeader: setHeaderMock, status: statusMock, json: jsonMock, locals: {} };
      const next = jest.fn();

      await mw(req, res, next);

      expect(statusMock).toHaveBeenCalledWith(402);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Payment Required" })
      );
      expect(setHeaderMock).toHaveBeenCalledWith("PAYMENT-REQUIRED", expect.any(String));
    });

    it("should allow request with valid payment proof and issue receipt", async () => {
      const rateCard = pricing(0.05);
      const mw = metered(rateCard);

      const req = {
        method: "POST",
        path: "/api/generate",
        headers: { "x-syncro-payment-proof": "proof_abc123" },
      };
      const setHeaderMock = jest.fn();
      const res = { setHeader: setHeaderMock, locals: {} };
      const next = jest.fn();

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.locals.syncroReceipt).toBeDefined();
      expect(res.locals.syncroReceipt.amount).toBe(0.05);
      expect(res.locals.syncroReceipt.status).toBe("settled");
      expect(res.locals.syncroReceipt.payer).toBe("proof_abc123");
      expect(setHeaderMock).toHaveBeenCalledWith("X-Syncro-Receipt", expect.any(String));
    });

    it("should serve-free on failure when failure mode is serve-free", async () => {
      const rateCard = pricing(0.05);
      const mw = metered(rateCard, {
        onFailure: "serve-free",
        verifyProof: () => {
          throw new Error("Gateway connection lost");
        },
      });

      const req = {
        method: "POST",
        path: "/api/generate",
        headers: { "x-syncro-payment-proof": "proof_abc123" },
      };
      const setHeaderMock = jest.fn();
      const res = { setHeader: setHeaderMock, locals: {} };
      const next = jest.fn();

      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      await mw(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.locals.syncroReceipt.status).toBe("free");
      consoleWarnSpy.mockRestore();
    });

    it("should reject on failure when failure mode is reject", async () => {
      const rateCard = pricing(0.05);
      const mw = metered(rateCard, {
        onFailure: "reject",
        verifyProof: () => {
          throw new Error("Gateway connection lost");
        },
      });

      const req = {
        method: "POST",
        path: "/api/generate",
        headers: { "x-syncro-payment-proof": "proof_abc123" },
      };
      const setHeaderMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const jsonMock = jest.fn();
      const res = { setHeader: setHeaderMock, status: statusMock, json: jsonMock, locals: {} };
      const next = jest.fn();

      await mw(req, res, next);

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Service Unavailable" })
      );
    });
  });

  describe("hostedGateway()", () => {
    it("should configure hosted gateway correctly", () => {
      const gateway = hostedGateway({
        target: "https://api.my-service.com",
        pricing: {
          defaultPrice: 0.02,
          routes: { "GET /items": 0.01 },
        },
      });

      expect(gateway.target).toBe("https://api.my-service.com");
      expect(gateway.pricing.defaultPrice).toBe(0.02);
      expect(gateway.pricing.match("GET", "/items").price).toBe(0.01);
    });
  });
});
