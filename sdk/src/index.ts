import axios, { type AxiosInstance } from "axios";
import { EventEmitter } from "node:events";
import type { GiftCardEvent, GiftCardEventType } from "./types";
import {
  validateSubscriptionCreateInput,
  validateSubscriptionUpdateInput,
  validateGiftCardHash,
} from "./validators.js";

export interface Subscription {
  id: string;
  name: string;
  price: number;
  billing_cycle: string;
  status: string;
  state: string; // Normalized
  nextRenewal?: string; // Normalized
  paymentMethod?: string; // Normalized
  renewal_url?: string;
  cancellation_url?: string;
  [key: string]: any;
}

export interface CancellationResult {
  success: boolean;
  status: "cancelled" | "failed" | "partial";
  subscription: Subscription;
  redirectUrl?: string;
  blockchain?: {
    synced: boolean;
    transactionHash?: string;
    error?: string;
  };
}

export interface StellarWallet {
  publicKey?: string | (() => string);
  signTransaction?: (...args: any[]) => any;
  sign?: (...args: any[]) => any;
  [key: string]: any;
}

export interface StellarKeypair {
  publicKey: string | (() => string);
  secret?: () => string;
  sign?: (...args: any[]) => any;
  [key: string]: any;
}

export interface SyncroSDKConfig {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  wallet?: StellarWallet | undefined;
  keypair?: StellarKeypair | undefined;
}

export interface SyncroSDKInitConfig {
  wallet?: StellarWallet | undefined;
  keypair?: StellarKeypair | undefined;
  backendApiBaseUrl: string;
  apiKey?: string | undefined;
}

export class SyncroSDK extends EventEmitter {
  private client: AxiosInstance;
  private apiKey?: string | undefined;
  private wallet?: StellarWallet | undefined;
  private keypair?: StellarKeypair | undefined;

  constructor(config: SyncroSDKConfig) {
    super();
    this.apiKey = config.apiKey ?? undefined;
    this.wallet = config.wallet ?? undefined;
    this.keypair = config.keypair ?? undefined;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    this.client = axios.create({
      baseURL: config.baseUrl || "http://localhost:3001/api",
      headers,
    });
  }

  /**
   * Cancel a subscription programmatically
   * @param subscriptionId The ID of the subscription to cancel
   * @returns Cancellation result including status and optional redirect link
   */
  async cancelSubscription(
    subscriptionId: string,
  ): Promise<CancellationResult> {
    try {
      this.emit("cancelling", { subscriptionId });

      const response = await this.client.post(
        `/subscriptions/${subscriptionId}/cancel`,
      );
      const { data, blockchain } = response.data;

      const result: CancellationResult = {
        success: true,
        status: "cancelled",
        subscription: data,
        redirectUrl: data.cancellation_url || data.renewal_url,
        blockchain: blockchain,
      };

      this.emit("success", result);
      return result;
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message;

      const failedResult: any = {
        success: false,
        status: "failed",
        error: errorMessage,
      };

      this.emit("failure", { subscriptionId, error: errorMessage });
      this.emit("error", new Error(errorMessage));
      throw new Error(`Cancellation failed: ${errorMessage}`);
    }
  }

  /**
   * Get subcription details
   */
  async getSubscription(subscriptionId: string): Promise<Subscription> {
    const response = await this.client.get(`/subscriptions/${subscriptionId}`);
    return this.normalizeSubscription(response.data.data);
  }

  /**
   * Fetch all user subscriptions with normalization and offline support
   */
  async getUserSubscriptions(): Promise<Subscription[]> {
    if (!this.apiKey) {
      throw new Error("API Key is required to fetch subscriptions");
    }

    const cacheKey = `syncro_subs_${this.apiKey}`;

    try {
      let allSubscriptions: any[] = [];
      let offset = 0;
      const limit = 50;
      let hasMore = true;

      while (hasMore) {
        const response = await this.client.get("/subscriptions", {
          params: { limit, offset },
        });

        const { data, pagination } = response.data;
        allSubscriptions = [...allSubscriptions, ...data];

        if (
          pagination &&
          data.length > 0 &&
          allSubscriptions.length < pagination.total
        ) {
          offset += limit;
        } else {
          hasMore = false;
        }
      }

      const normalized = allSubscriptions.map((sub) =>
        this.normalizeSubscription(sub),
      );

      // Update cache
      this.updateCache(cacheKey, normalized);

      return normalized;
    } catch (error) {
      // Offline/Error support: Check cache
      const cached = this.getCache(cacheKey);
      if (cached) {
        console.warn(
          "SyncroSDK: Network error, returning cached subscriptions.",
        );
        return cached;
      }
      throw error;
    }
  }

  private normalizeSubscription(sub: any): Subscription {
    return {
      ...sub,
      state: sub.status,
      nextRenewal: sub.next_billing_date,
      paymentMethod: sub.payment_method || "Credit Card", // Default if not present
    };
  }

  private updateCache(key: string, data: Subscription[]): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(
          key,
          JSON.stringify({
            data,
            timestamp: Date.now(),
          }),
        );
      }
    } catch (e) {
      // Silently fail if storage is full or unavailable
    }
  }

  private getCache(key: string): Subscription[] | null {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const cached = localStorage.getItem(key);
        if (cached) {
          return JSON.parse(cached).data;
        }
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  /**
   * Create a subscription with pre-flight validation.
   * Invalid payloads are rejected before any network request.
   */
  async createSubscription(
    input: unknown,
  ): Promise<Subscription> {
    const validated = validateSubscriptionCreateInput(input);

    this.emit("creating", validated);

    const response = await this.client.post("/subscriptions", validated);
    const subscription = this.normalizeSubscription(response.data.data);

    this.emit("created", subscription);
    return subscription;
  }

  /**
   * Update a subscription with pre-flight validation.
   * Invalid payloads are rejected before any network request.
   */
  async updateSubscription(
    subscriptionId: string,
    input: unknown,
  ): Promise<Subscription> {
    if (!subscriptionId || typeof subscriptionId !== "string") {
      throw new Error("Validation failed: subscriptionId must be a non-empty string.");
    }

    const validated = validateSubscriptionUpdateInput(input);

    this.emit("updating", { subscriptionId, updates: validated });

    const response = await this.client.patch(
      `/subscriptions/${subscriptionId}`,
      validated,
    );
    const subscription = this.normalizeSubscription(response.data.data);

    this.emit("updated", subscription);
    return subscription;
  }

  /**
   * Attach a gift card to a subscription with hash validation.
   * Invalid hashes are rejected before any network request.
   */
  async attachGiftCard(
    subscriptionId: string,
    giftCardHash: unknown,
    provider?: string,
  ): Promise<GiftCardEvent> {
    if (!subscriptionId || typeof subscriptionId !== "string") {
      throw new Error("Validation failed: subscriptionId must be a non-empty string.");
    }

    const validatedHash = validateGiftCardHash(giftCardHash);

    const payload = { giftCardHash: validatedHash, provider };

    this.emit("giftcard:attaching", { subscriptionId, ...payload });

    const response = await this.client.post(
      `/subscriptions/${subscriptionId}/giftcard`,
      payload,
    );

    const event: GiftCardEvent = {
      type: "attached",
      subscriptionId,
      giftCardHash: validatedHash,
      provider,
      data: response.data.data,
    };

    this.emit("giftcard:attached", event);
    return event;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasFunctionOrStringPublicKey(
  value: unknown,
): value is string | (() => string) {
  return typeof value === "string" || typeof value === "function";
}

function validateInitConfig(config: SyncroSDKInitConfig): void {
  const errors: string[] = [];

  if (!isObject(config)) {
    throw new Error(
      "Invalid SDK initialization config: config must be an object.",
    );
  }

  if (
    typeof config.backendApiBaseUrl !== "string" ||
    config.backendApiBaseUrl.trim().length === 0
  ) {
    errors.push(
      "backendApiBaseUrl is required and must be a non-empty string.",
    );
  } else {
    try {
      new URL(config.backendApiBaseUrl);
    } catch {
      errors.push("backendApiBaseUrl must be a valid URL.");
    }
  }

  if (!config.wallet && !config.keypair) {
    errors.push("Provide either a wallet object or a keypair.");
  }

  if (config.wallet && !isObject(config.wallet)) {
    errors.push("wallet must be an object.");
  }

  if (config.keypair) {
    if (!isObject(config.keypair)) {
      errors.push("keypair must be an object.");
    } else if (!hasFunctionOrStringPublicKey(config.keypair.publicKey)) {
      errors.push(
        "keypair.publicKey must be a string or a function returning a string.",
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid SDK initialization config: ${errors.join(" ")}`);
  }
}

function getSignerPublicKey(
  wallet?: StellarWallet,
  keypair?: StellarKeypair,
): string | undefined {
  if (wallet?.publicKey) {
    return typeof wallet.publicKey === "function"
      ? wallet.publicKey()
      : wallet.publicKey;
  }

  if (keypair?.publicKey) {
    return typeof keypair.publicKey === "function"
      ? keypair.publicKey()
      : keypair.publicKey;
  }

  return undefined;
}

export function init(config: SyncroSDKInitConfig): SyncroSDK {
  validateInitConfig(config);

  const sdk = new SyncroSDK({
    apiKey: config.apiKey,
    baseUrl: config.backendApiBaseUrl,
    wallet: config.wallet,
    keypair: config.keypair,
  });

  const readyPayload = {
    backendApiBaseUrl: config.backendApiBaseUrl,
    publicKey: getSignerPublicKey(config.wallet, config.keypair),
  };

  queueMicrotask(() => {
    sdk.emit("ready", readyPayload);
  });

  return sdk;
}

export default SyncroSDK;
export type { GiftCardEvent, GiftCardEventType } from "./types";
export {
  validateSubscriptionCreateInput,
  validateSubscriptionUpdateInput,
  validateGiftCardHash,
  SubscriptionCreateSchema,
  SubscriptionUpdateSchema,
  GiftCardHashSchema,
} from "./validators.js";
export type {
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
} from "./validators.js";
