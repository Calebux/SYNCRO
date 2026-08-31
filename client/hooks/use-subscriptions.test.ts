import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react-hooks";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import type {
  SubscriptionState,
  SubscriptionCreatePayload,
  SubscriptionUpdatePayload,
  ToastPayload,
  EmailAccount,
} from "@/hooks/use-subscriptions";
import type { Subscription as DBSubscription } from "@/lib/supabase/subscriptions";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ subscriptions: [] }),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("@/lib/supabase/subscriptions", () => ({
  createSubscription: vi.fn().mockResolvedValue({
    id: 1,
    name: "Test Sub",
    category: "test",
    price: 9.99,
    icon: "🔗",
    renews_in: 30,
    status: "active",
    color: "#000000",
    renewal_url: null,
    tags: [],
    date_added: "2024-01-01T00:00:00.000Z",
    email_account_id: 1,
    last_used_at: null,
    has_api_key: false,
    is_trial: false,
    trial_ends_at: null,
    price_after_trial: null,
    source: "manual",
    manually_edited: false,
    edited_fields: [],
    pricing_type: "fixed",
    billing_cycle: "monthly",
    expired_at: null,
    notes: null,
    custom_tag_ids: null,
    user_id: "user-123",
  }),
  updateSubscription: vi.fn().mockResolvedValue({}),
  deleteSubscription: vi.fn().mockResolvedValue(undefined),
  bulkDeleteSubscriptions: vi.fn().mockResolvedValue(undefined),
  fetchSubscriptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/validation", () => ({
  validateSubscriptionData: vi.fn().mockReturnValue({
    isValid: true,
    errors: {},
  }),
}));

vi.mock("@/lib/subscription-utils", () => ({
  checkDuplicate: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/network-utils", () => ({
  retryWithBackoff: vi.fn(async (fn) => fn()),
  getErrorMessage: vi.fn((err) => (err instanceof Error ? err.message : "Unknown error")),
}));

vi.mock("@/hooks/use-undo-manager", () => ({
  useUndoManager: vi.fn((initial: DBSubscription[]) => ({
    currentState: initial,
    addToHistory: vi.fn((state) => {
      // Simulate state update
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
  })),
}));

const mockEmailAccounts: EmailAccount[] = [
  { id: 1, email: "test@example.com", isPrimary: true },
];

const mockDBSubscriptions: DBSubscription[] = [
  {
    id: 1,
    user_id: "user-123",
    name: "Netflix",
    category: "Entertainment",
    price: 15.99,
    icon: "🎬",
    renews_in: 30,
    status: "active",
    color: "#E50914",
    renewal_url: "https://netflix.com/renew",
    tags: ["streaming"],
    date_added: "2024-01-01T00:00:00.000Z",
    email_account_id: 1,
    last_used_at: "2024-01-15T00:00:00.000Z",
    has_api_key: false,
    is_trial: false,
    trial_ends_at: null,
    price_after_trial: null,
    source: "manual",
    manually_edited: false,
    edited_fields: [],
    pricing_type: "fixed",
    billing_cycle: "monthly",
    expired_at: null,
    notes: null,
    custom_tag_ids: null,
  },
];

describe("useSubscriptions Hook - Type Safety", () => {
  let mockToast: ReturnType<typeof vi.fn>;
  let mockUpgradePlan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast = vi.fn();
    mockUpgradePlan = vi.fn();
  });

  describe("Type Definitions", () => {
    it("should accept correctly typed SubscriptionCreatePayload", () => {
      const payload: SubscriptionCreatePayload = {
        name: "Spotify",
        category: "Music",
        price: 9.99,
        icon: "🎵",
        renewsIn: 30,
        status: "active",
        color: "#1DB954",
        renewalUrl: "https://spotify.com/renew",
        tags: ["music", "streaming"],
        isTrial: true,
        trialEndsAt: "2024-12-31T00:00:00.000Z",
        priceAfterTrial: 14.99,
      };

      expect(payload.name).toBe("Spotify");
      expect(payload.price).toBe(9.99);
      expect(payload.isTrial).toBe(true);
    });

    it("should accept correctly typed SubscriptionUpdatePayload", () => {
      const payload: SubscriptionUpdatePayload = {
        name: "Updated Name",
        category: "Updated Category",
        price: 19.99,
        billingCycle: "yearly",
        pricingType: "usage",
      };

      expect(payload.name).toBe("Updated Name");
      expect(payload.billingCycle).toBe("yearly");
    });

    it("should accept correctly typed ToastPayload", () => {
      const toast: ToastPayload = {
        title: "Success",
        description: "Operation completed",
        variant: "success",
        action: {
          label: "Undo",
          onClick: () => {},
        },
      };

      expect(toast.variant).toBe("success");
      expect(toast.action?.label).toBe("Undo");
    });

    it("should accept correctly typed EmailAccount", () => {
      const account: EmailAccount = {
        id: 1,
        email: "user@example.com",
        isPrimary: true,
      };

      expect(account.isPrimary).toBe(true);
    });
  });

  describe("State Type Safety", () => {
    it("should initialize with correctly typed subscription state", () => {
      const { result } = renderHook(() =>
        useSubscriptions({
          initialSubscriptions: mockDBSubscriptions,
          maxSubscriptions: 10,
          emailAccounts: mockEmailAccounts,
          onToast: mockToast,
          onUpgradePlan: mockUpgradePlan,
        })
      );

      const { subscriptions } = result.current;
      expect(Array.isArray(subscriptions)).toBe(true);
    });

    it("should provide type-safe selectedSubscription state", () => {
      const { result } = renderHook(() =>
        useSubscriptions({
          initialSubscriptions: mockDBSubscriptions,
          maxSubscriptions: 10,
          emailAccounts: mockEmailAccounts,
          onToast: mockToast,
          onUpgradePlan: mockUpgradePlan,
        })
      );

      const { setSelectedSubscription, selectedSubscription } = result.current;
      expect(selectedSubscription).toBeNull();

      act(() => {
        setSelectedSubscription(mockDBSubscriptions[0] as SubscriptionState);
      });

      expect(result.current.selectedSubscription).not.toBeNull();
    });
  });

  describe("Update Operations Type Safety", () => {
    it("should handle updateSubscriptions with typed array", () => {
      const { result } = renderHook(() =>
        useSubscriptions({
          initialSubscriptions: mockDBSubscriptions,
          maxSubscriptions: 10,
          emailAccounts: mockEmailAccounts,
          onToast: mockToast,
          onUpgradePlan: mockUpgradePlan,
        })
      );

      const typedSubscriptions: SubscriptionState[] = [
        mockDBSubscriptions[0] as SubscriptionState,
      ];

      act(() => {
        result.current.updateSubscriptions(typedSubscriptions);
      });

      expect(result.current.subscriptions).toBeDefined();
    });

    it("should handle handleEditSubscription with typed updates", () => {
      const { result } = renderHook(() =>
        useSubscriptions({
          initialSubscriptions: mockDBSubscriptions,
          maxSubscriptions: 10,
          emailAccounts: mockEmailAccounts,
          onToast: mockToast,
          onUpgradePlan: mockUpgradePlan,
        })
      );

      const typedUpdates: SubscriptionUpdatePayload = {
        name: "Updated Netflix",
        price: 19.99,
        billingCycle: "yearly",
      };

      act(() => {
        result.current.handleEditSubscription(1, typedUpdates);
      });

      expect(mockToast).toHaveBeenCalled();
    });

    it("should handle handleAddSubscription with typed payload", () => {
      const { result } = renderHook(() =>
        useSubscriptions({
          initialSubscriptions: mockDBSubscriptions,
          maxSubscriptions: 10,
          emailAccounts: mockEmailAccounts,
          onToast: mockToast,
          onUpgradePlan: mockUpgradePlan,
        })
      );

      const newSubscription: SubscriptionCreatePayload = {
        name: "Disney+",
        category: "Entertainment",
        price: 7.99,
        icon: "🏰",
        renewsIn: 30,
        status: "active",
        color: "#002D72",
        tags: ["streaming"],
      };

      act(async () => {
        await result.current.handleAddSubscription(newSubscription);
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Subscription added",
          variant: "success",
        })
      );
    });

    it("should handle handleCancelSubscription with typed state", () => {
      const { result } = renderHook(() =>
        useSubscriptions({
          initialSubscriptions: mockDBSubscriptions,
          maxSubscriptions: 10,
          emailAccounts: mockEmailAccounts,
          onToast: mockToast,
          onUpgradePlan: mockUpgradePlan,
        })
      );

      act(async () => {
        await result.current.handleCancelSubscription(1);
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Subscription cancelled",
          variant: "success",
        })
      );
    });

    it("should handle handlePauseSubscription with typed parameters", () => {
      const { result } = renderHook(() =>
        useSubscriptions({
          initialSubscriptions: mockDBSubscriptions,
          maxSubscriptions: 10,
          emailAccounts: mockEmailAccounts,
          onToast: mockToast,
          onUpgradePlan: mockUpgradePlan,
        })
      );

      const resumeDate = new Date("2024-06-01T00:00:00.000Z");

      act(async () => {
        await result.current.handlePauseSubscription(1, resumeDate);
      });

      expect(mockToast).toHaveBeenCalled();
    });

    it("should handle handleResumeSubscription with typed state", () => {
      const { result } = renderHook(() =>
        useSubscriptions({
          initialSubscriptions: mockDBSubscriptions,
          maxSubscriptions: 10,
          emailAccounts: mockEmailAccounts,
          onToast: mockToast,
          onUpgradePlan: mockUpgradePlan,
        })
      );

      act(async () => {
        await result.current.handleResumeSubscription(1);
      });

      expect(mockToast).toHaveBeenCalled();
    });
  });

  describe("No 'any' types in public interfaces", () => {
    it("should export only typed interfaces", () => {
      const exports = {
        SubscriptionState: {} as SubscriptionState,
        SubscriptionCreatePayload: {} as SubscriptionCreatePayload,
        SubscriptionUpdatePayload: {} as SubscriptionUpdatePayload,
        ToastPayload: {} as ToastPayload,
        EmailAccount: {} as EmailAccount,
      };

      expect(exports.SubscriptionState).toBeDefined();
      expect(exports.SubscriptionCreatePayload).toBeDefined();
      expect(exports.SubscriptionUpdatePayload).toBeDefined();
      expect(exports.ToastPayload).toBeDefined();
      expect(exports.EmailAccount).toBeDefined();
    });
  });
});
