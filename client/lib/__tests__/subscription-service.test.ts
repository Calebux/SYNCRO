import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubscriptionService, Subscription } from "../subscription-service";

vi.mock("../api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
}));

import { apiGet, apiPost, apiDelete, apiPatch } from "../api";

const mockSubscription = (overrides = {}): Subscription => ({
  id: 1,
  name: "Netflix",
  category: "Entertainment",
  price: 15.99,
  status: "active",
  renewsIn: 10,
  userId: "user-123",
  createdAt: new Date(),
  ...overrides,
});

describe("SubscriptionService", () => {
  let service: SubscriptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SubscriptionService();
  });

  describe("getSubscriptions", () => {
    it("should return list of subscriptions", async () => {
      const subs = [
        mockSubscription(),
        mockSubscription({ id: 2, name: "Spotify" }),
      ];
      vi.mocked(apiGet).mockResolvedValue({ subscriptions: subs });

      const result = await service.getSubscriptions("user-123");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Netflix");
    });
  });

  describe("createSubscription", () => {
    it("should create and return a new subscription", async () => {
      const sub = mockSubscription();
      vi.mocked(apiPost).mockResolvedValue({ subscription: sub });

      const result = await service.createSubscription({
        name: "Netflix",
        category: "Entertainment",
        price: 15.99,
        status: "active",
        renewsIn: 10,
        userId: "user-123",
      });

      expect(result.name).toBe("Netflix");
      expect(apiPost).toHaveBeenCalledWith(
        "/api/subscriptions",
        expect.any(Object),
      );
    });
  });

  describe("deleteSubscription", () => {
    it("should call delete with correct id", async () => {
      vi.mocked(apiDelete).mockResolvedValue({});

      await service.deleteSubscription(1);
      expect(apiDelete).toHaveBeenCalledWith("/api/subscriptions/1");
    });
  });

  describe("updateSubscription", () => {
    it("should update and return subscription", async () => {
      const updated = mockSubscription({ price: 19.99 });
      vi.mocked(apiPatch).mockResolvedValue({ subscription: updated });

      const result = await service.updateSubscription(1, { price: 19.99 });
      expect(result.price).toBe(19.99);
      expect(apiPatch).toHaveBeenCalledWith("/api/subscriptions/1", {
        price: 19.99,
      });
    });
  });

  describe("calculateTotalSpend", () => {
    it("should sum all subscription prices", () => {
      const subs = [
        mockSubscription({ price: 10 }),
        mockSubscription({ price: 20 }),
        mockSubscription({ price: 5.5 }),
      ];
      expect(service.calculateTotalSpend(subs)).toBe(35.5);
    });

    it("should return 0 for empty list", () => {
      expect(service.calculateTotalSpend([])).toBe(0);
    });
  });

  describe("getUpcomingRenewals", () => {
    it("should return subscriptions expiring within default 7 days", () => {
      const subs = [
        mockSubscription({ renewsIn: 3, status: "expiring" }),
        mockSubscription({ renewsIn: 10, status: "expiring" }),
        mockSubscription({ renewsIn: 2, status: "active" }),
      ];
      const result = service.getUpcomingRenewals(subs);
      expect(result).toHaveLength(1);
      expect(result[0].renewsIn).toBe(3);
    });

    it("should return subscriptions within custom days range", () => {
      const subs = [
        mockSubscription({ renewsIn: 5, status: "expiring" }),
        mockSubscription({ renewsIn: 15, status: "expiring" }),
      ];
      const result = service.getUpcomingRenewals(subs, 10);
      expect(result).toHaveLength(1);
      expect(result[0].renewsIn).toBe(5);
    });

    it("should return empty array when no upcoming renewals", () => {
      const subs = [mockSubscription({ renewsIn: 30, status: "expiring" })];
      const result = service.getUpcomingRenewals(subs);
      expect(result).toHaveLength(0);
    });
  });
});
