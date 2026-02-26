// Subscription service for managing subscription operations

export interface Subscription {
  id: number;
  name: string;
  category: string;
  price: number;
  status: "active" | "expiring" | "expired";
  renewsIn: number;
  userId: string;
  createdAt: Date;
}

import { apiGet, apiPost, apiDelete, apiPatch } from "./api";
import {
  validateSubscriptionCreateInput,
  validateSubscriptionUpdateInput,
} from "./client-validators";

export class SubscriptionService {
  async getSubscriptions(userId: string): Promise<Subscription[]> {
    const data = await apiGet("/api/subscriptions");
    return data.subscriptions;
  }

  async createSubscription(
    subscription: Omit<Subscription, "id" | "createdAt">
  ): Promise<Subscription> {
    // Fail fast: validate before network call
    validateSubscriptionCreateInput(subscription);
    const data = await apiPost("/api/subscriptions", subscription);
    return data.subscription;
  }

  async deleteSubscription(id: number): Promise<void> {
    await apiDelete(`/api/subscriptions/${id}`);
  }

  async updateSubscription(
    id: number,
    updates: Partial<Subscription>
  ): Promise<Subscription> {
    // Fail fast: validate before network call
    validateSubscriptionUpdateInput(updates);
    const data = await apiPatch(`/api/subscriptions/${id}`, updates);
    return data.subscription;
  }

  calculateTotalSpend(subscriptions: Subscription[]): number {
    return subscriptions.reduce((sum, sub) => sum + sub.price, 0);
  }

  getUpcomingRenewals(subscriptions: Subscription[], days = 7): Subscription[] {
    return subscriptions.filter(
      (sub) => sub.renewsIn <= days && sub.status === "expiring"
    );
  }
}
