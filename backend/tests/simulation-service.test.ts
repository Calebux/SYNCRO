import { SimulationService } from "../src/services/simulation-service";
import type { Subscription } from "../src/types/subscription";

describe("SimulationService", () => {
  let service: SimulationService;

  beforeEach(() => {
    service = new SimulationService();
  });

  describe("calculateNextRenewal", () => {
    it("should add 1 week for weekly billing cycle", () => {
      const currentDate = new Date("2024-01-01T00:00:00.000Z");
      const nextDate = service.calculateNextRenewal(currentDate, "weekly");
      expect(nextDate.toISOString()).toBe(new Date("2024-01-08T00:00:00.000Z").toISOString());
    });

    it("should add 1 month for monthly billing cycle", () => {
      const currentDate = new Date("2024-01-01T00:00:00.000Z");
      const nextDate = service.calculateNextRenewal(currentDate, "monthly");
      expect(nextDate.toISOString()).toBe(new Date("2024-02-01T00:00:00.000Z").toISOString());
    });

    it("should add 1 quarter for quarterly billing cycle", () => {
      const currentDate = new Date("2024-01-01T00:00:00.000Z");
      const nextDate = service.calculateNextRenewal(currentDate, "quarterly");
      expect(nextDate.toISOString()).toBe(new Date("2024-04-01T00:00:00.000Z").toISOString());
    });

    it("should add 1 year for yearly billing cycle", () => {
      const currentDate = new Date("2024-01-01T00:00:00.000Z");
      const nextDate = service.calculateNextRenewal(currentDate, "yearly");
      expect(nextDate.toISOString()).toBe(new Date("2025-01-01T00:00:00.000Z").toISOString());
    });

    it("should treat annual the same as yearly", () => {
      const d = new Date("2024-06-15T00:00:00.000Z");
      expect(service.calculateNextRenewal(d, "annual").toISOString()).toBe(
        service.calculateNextRenewal(d, "yearly").toISOString()
      );
    });

    // Month-end edge cases — the whole point of using date-fns over manual arithmetic
    it("should clamp Jan 31 + 1 month to Feb 29 on a leap year", () => {
      const jan31 = new Date("2024-01-31T00:00:00.000Z"); // 2024 is a leap year
      const next = service.calculateNextRenewal(jan31, "monthly");
      expect(next.toISOString()).toBe(new Date("2024-02-29T00:00:00.000Z").toISOString());
    });

    it("should clamp Jan 31 + 1 month to Feb 28 on a non-leap year", () => {
      const jan31 = new Date("2023-01-31T00:00:00.000Z");
      const next = service.calculateNextRenewal(jan31, "monthly");
      expect(next.toISOString()).toBe(new Date("2023-02-28T00:00:00.000Z").toISOString());
    });

    it("should clamp Mar 31 + 1 quarter to Jun 30", () => {
      const mar31 = new Date("2024-03-31T00:00:00.000Z");
      const next = service.calculateNextRenewal(mar31, "quarterly");
      expect(next.toISOString()).toBe(new Date("2024-06-30T00:00:00.000Z").toISOString());
    });

    it("no drift: applying monthly 12 times from Jan 31 lands on Jan 31 the next year", () => {
      let date = new Date("2024-01-31T00:00:00.000Z");
      for (let i = 0; i < 12; i++) {
        date = service.calculateNextRenewal(date, "monthly");
      }
      expect(date.getUTCDate()).toBe(31);
      expect(date.getUTCMonth()).toBe(0); // January
      expect(date.getUTCFullYear()).toBe(2025);
    });

    it("no drift: applying weekly 52 times from a given date returns the same weekday one year later", () => {
      const start = new Date("2024-01-01T00:00:00.000Z"); // Monday
      let date = start;
      for (let i = 0; i < 52; i++) {
        date = service.calculateNextRenewal(date, "weekly");
      }
      expect(date.getUTCDay()).toBe(start.getUTCDay());
    });
  });

  describe("projectSubscriptionRenewals", () => {
    const baseSubscription = {
      id: "1",
      user_id: "user1",
      email_account_id: null,
      merchant_id: null,
      name: "Netflix",
      provider: "Netflix",
      price: 15.99,
      currency: "USD",
      billing_cycle: "monthly",
      status: "active",
      category: "Entertainment",
      logo_url: null,
      website_url: null,
      renewal_url: null,
      notes: null,
      visibility: "private",
      tags: [],
      expired_at: null,
      paused_at: null,
      resume_at: null,
      pause_reason: null,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    };

    it("should return empty array when no next_billing_date", () => {
      const subscription = {
        ...baseSubscription,
        next_billing_date: null,
      };

      const projections = service.projectSubscriptionRenewals(
        subscription as Subscription,
        new Date("2024-02-01")
      );

      expect(projections).toEqual([]);
    });

    it("should generate single renewal within range", () => {
      const subscription = {
        ...baseSubscription,
        next_billing_date: "2024-01-15",
      };

      const projections = service.projectSubscriptionRenewals(
        subscription as Subscription,
        new Date("2024-02-01")
      );

      expect(projections).toHaveLength(1);
      expect(projections[0].subscriptionId).toBe("1");
    });

    it("should generate multiple renewals", () => {
      const subscription = {
        ...baseSubscription,
        next_billing_date: "2024-01-01",
      };

      const projections = service.projectSubscriptionRenewals(
        subscription as Subscription,
        new Date("2024-02-15")
      );

      expect(projections).toHaveLength(2);
    });

    it("should not exceed end date", () => {
      const subscription = {
        ...baseSubscription,
        billing_cycle: "yearly",
        next_billing_date: "2024-01-01",
      };

      const projections = service.projectSubscriptionRenewals(
        subscription as Subscription,
        new Date("2024-02-01")
      );

      expect(projections).toHaveLength(1);
    });
  });

  describe("validation", () => {
    it("should reject invalid days", async () => {
      await expect(service.generateSimulation("user1", 0)).rejects.toThrow();
      await expect(service.generateSimulation("user1", 366)).rejects.toThrow();
    });
  });
});