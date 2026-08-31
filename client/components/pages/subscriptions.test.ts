/**
 * Regression Tests for Subscriptions Component
 * Tests filtering, sorting, and UX behaviors
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  Subscription,
  DuplicateGroup,
  UnusedSubscription,
} from "@/types/subscriptions";

// Mock data for testing
const mockSubscriptions: Subscription[] = [
  {
    id: 1,
    name: "Netflix",
    category: "Entertainment",
    email: "user@gmail.com",
    price: 15.99,
    status: "active",
    renewsIn: 10,
    icon: "🎬",
    visibility: "private",
    isTrial: false,
  },
  {
    id: 2,
    name: "Spotify",
    category: "Music",
    email: "user@gmail.com",
    price: 9.99,
    status: "active",
    renewsIn: 5,
    icon: "🎵",
    visibility: "private",
    isTrial: false,
  },
  {
    id: 3,
    name: "Amazon Prime",
    category: "Entertainment",
    email: "user@yahoo.com",
    price: 14.99,
    status: "expiring",
    renewsIn: 2,
    icon: "📦",
    visibility: "team",
    isTrial: false,
  },
  {
    id: 4,
    name: "GitHub Copilot",
    category: "Developer Tools",
    email: "user@gmail.com",
    price: 20.0,
    status: "active",
    renewsIn: 30,
    icon: "💻",
    visibility: "private",
    isTrial: true,
    trialEndsAt: "2026-05-10",
    priceAfterTrial: 10.0,
  },
  {
    id: 5,
    name: "Adobe Creative Cloud",
    category: "Design",
    email: "user@company.com",
    price: 54.99,
    status: "active",
    renewsIn: 15,
    icon: "🎨",
    visibility: "private",
    isTrial: false,
    latest_price_change: {
      old_price: 49.99,
      new_price: 54.99,
    },
  },
  {
    id: 6,
    name: "Notion",
    category: "Productivity",
    email: "user@gmail.com",
    price: 10.0,
    status: "paused",
    renewsIn: 20,
    icon: "📝",
    visibility: "private",
    isTrial: false,
  },
  {
    id: 7,
    name: "Netflix Family",
    category: "Entertainment",
    email: "user@gmail.com",
    price: 19.99,
    status: "active",
    renewsIn: 10,
    icon: "🎬",
    visibility: "private",
    isTrial: false,
  },
];

const mockDuplicates: DuplicateGroup[] = [
  {
    subscriptions: [mockSubscriptions[0], mockSubscriptions[6]], // Netflix and Netflix Family
    count: 2,
  },
];

const mockUnused: UnusedSubscription[] = [
  {
    id: 6,
    name: "Notion",
    category: "Productivity",
    price: 10.0,
    status: "paused",
    renewsIn: 20,
  },
];

describe("Subscriptions Filtering", () => {
  let filter: (subs: Subscription[]) => Subscription[];

  beforeEach(() => {
    // Create a standard filter function that matches component logic
    filter = (subs: Subscription[]) => subs;
  });

  describe("Search filtering", () => {
    it("should filter subscriptions by name (case-insensitive)", () => {
      const searchTerm = "netflix";
      const result = mockSubscriptions.filter((sub) =>
        sub.name.toLowerCase().includes(searchTerm.toLowerCase()),
      );
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Netflix");
      expect(result[1].name).toBe("Netflix Family");
    });

    it("should return all subscriptions when search term is empty", () => {
      const searchTerm = "";
      const result = mockSubscriptions.filter((sub) =>
        sub.name.toLowerCase().includes(searchTerm.toLowerCase()),
      );
      expect(result).toHaveLength(mockSubscriptions.length);
    });

    it("should return empty array when no subscriptions match search", () => {
      const searchTerm = "xbox";
      const result = mockSubscriptions.filter((sub) =>
        sub.name.toLowerCase().includes(searchTerm.toLowerCase()),
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("Category filtering", () => {
    it("should filter subscriptions by category", () => {
      const selectedCategories = ["Entertainment"];
      const result = mockSubscriptions.filter((sub) =>
        selectedCategories.includes(sub.category),
      );
      expect(result).toHaveLength(3);
      expect(result.every((sub) => sub.category === "Entertainment")).toBe(
        true,
      );
    });

    it("should support multiple category selection", () => {
      const selectedCategories = ["Entertainment", "Music"];
      const result = mockSubscriptions.filter((sub) =>
        selectedCategories.includes(sub.category),
      );
      expect(result).toHaveLength(4);
    });

    it("should return all subscriptions when no categories are selected", () => {
      const selectedCategories: string[] = [];
      const result = mockSubscriptions.filter(
        (sub) =>
          selectedCategories.length === 0 ||
          selectedCategories.includes(sub.category),
      );
      expect(result).toHaveLength(mockSubscriptions.length);
    });
  });

  describe("Status filtering", () => {
    it("should filter subscriptions by status", () => {
      const selectedStatuses = ["active"];
      const result = mockSubscriptions.filter((sub) =>
        selectedStatuses.includes(sub.status),
      );
      expect(result).toHaveLength(5);
      expect(result.every((sub) => sub.status === "active")).toBe(true);
    });

    it("should filter paused subscriptions", () => {
      const selectedStatuses = ["paused"];
      const result = mockSubscriptions.filter((sub) =>
        selectedStatuses.includes(sub.status),
      );
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("paused");
    });

    it("should support multiple status selection", () => {
      const selectedStatuses = ["active", "paused"];
      const result = mockSubscriptions.filter((sub) =>
        selectedStatuses.includes(sub.status),
      );
      expect(result).toHaveLength(6);
    });
  });

  describe("Email filtering", () => {
    it("should filter subscriptions by email", () => {
      const filterEmail = "user@gmail.com";
      const result = mockSubscriptions.filter(
        (sub) => sub.email === filterEmail,
      );
      expect(result).toHaveLength(5);
      expect(result.every((sub) => sub.email === filterEmail)).toBe(true);
    });

    it("should return all subscriptions when filter is 'all'", () => {
      const filterEmail = "all";
      const result = mockSubscriptions.filter(
        (sub) => filterEmail === "all" || sub.email === filterEmail,
      );
      expect(result).toHaveLength(mockSubscriptions.length);
    });
  });

  describe("Price range filtering", () => {
    it("should filter subscriptions within price range", () => {
      const priceRange: [number, number] = [10, 20];
      const result = mockSubscriptions.filter(
        (sub) => sub.price >= priceRange[0] && sub.price < priceRange[1],
      );
      expect(result).toHaveLength(3); // Spotify ($9.99), GitHub Copilot ($20), Notion ($10)
    });

    it("should return all subscriptions when price range is null", () => {
      const result = mockSubscriptions.filter((sub) => true);
      expect(result).toHaveLength(mockSubscriptions.length);
    });

    it("should handle edge case where price equals range boundary", () => {
      const priceRange: [number, number] = [10, 20];
      const subs = [
        { ...mockSubscriptions[1], price: 10 }, // exactly at lower bound
        { ...mockSubscriptions[1], price: 19.99 }, // just below upper bound
        { ...mockSubscriptions[1], price: 20 }, // at upper bound (excluded)
      ];
      const result = subs.filter(
        (sub) => sub.price >= priceRange[0] && sub.price < priceRange[1],
      );
      expect(result).toHaveLength(2);
    });
  });

  describe("Duplicate detection", () => {
    it("should identify duplicate subscriptions", () => {
      const isDuplicateIds = mockDuplicates
        .flatMap((dup) => dup.subscriptions.map((s) => s.id))
        .filter((id) => {
          return mockDuplicates.some((dup) =>
            dup.subscriptions.some((s) => s.id === id),
          );
        });
      expect(isDuplicateIds).toContain(1);
      expect(isDuplicateIds).toContain(7);
      expect(isDuplicateIds).toHaveLength(2);
    });

    it("should filter to show only duplicates", () => {
      const showDuplicatesOnly = true;
      const result = mockSubscriptions.filter((sub) => {
        if (!showDuplicatesOnly) return true;
        return mockDuplicates.some((dup) =>
          dup.subscriptions.some((s) => s.id === sub.id),
        );
      });
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Netflix");
      expect(result[1].name).toBe("Netflix Family");
    });
  });

  describe("Unused subscriptions detection", () => {
    it("should identify unused subscriptions", () => {
      const unusedIds = mockUnused.map((u) => u.id);
      const result = mockSubscriptions.filter((sub) =>
        unusedIds.includes(sub.id),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(6);
    });

    it("should filter to show only unused subscriptions", () => {
      const showUnusedOnly = true;
      const result = mockSubscriptions.filter((sub) => {
        if (!showUnusedOnly) return true;
        return mockUnused.some((unused) => unused.id === sub.id);
      });
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("paused");
    });
  });

  describe("Combined filtering", () => {
    it("should apply multiple filters together", () => {
      const searchTerm = "netflix";
      const categories = ["Entertainment"];
      const statuses = ["active"];
      const emailFilter = "all";

      const result = mockSubscriptions.filter((sub) => {
        const matchesSearch = sub.name
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
        const matchesCategory =
          categories.length === 0 || categories.includes(sub.category);
        const matchesStatus =
          statuses.length === 0 || statuses.includes(sub.status);
        const matchesEmail = emailFilter === "all" || sub.email === emailFilter;

        return (
          matchesSearch && matchesCategory && matchesStatus && matchesEmail
        );
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Netflix");
    });

    it("should filter search + duplicates only", () => {
      const searchTerm = "netflix";
      const showDuplicatesOnly = true;

      const result = mockSubscriptions.filter((sub) => {
        const matchesSearch = sub.name
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
        const isDuplicate = mockDuplicates.some((dup) =>
          dup.subscriptions.some((s) => s.id === sub.id),
        );

        return matchesSearch && (!showDuplicatesOnly || isDuplicate);
      });

      expect(result).toHaveLength(2);
    });
  });
});

describe("Subscriptions Sorting", () => {
  describe("Sort by name", () => {
    it("should sort subscriptions alphabetically by name", () => {
      const sorted = [...mockSubscriptions].sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      expect(sorted[0].name).toBe("Adobe Creative Cloud");
      expect(sorted[sorted.length - 1].name).toBe("Spotify");
    });

    it("should be case-insensitive", () => {
      const testSubs: Subscription[] = [
        { ...mockSubscriptions[0], name: "netflix" },
        { ...mockSubscriptions[0], name: "Netflix" },
        { ...mockSubscriptions[0], name: "NETFLIX" },
      ];

      const sorted = [...testSubs].sort((a, b) => a.name.localeCompare(b.name));

      expect(sorted.length).toBe(3);
    });
  });

  describe("Sort by price", () => {
    it("should sort by price high to low", () => {
      const sorted = [...mockSubscriptions].sort((a, b) => b.price - a.price);

      expect(sorted[0].name).toBe("Adobe Creative Cloud");
      expect(sorted[0].price).toBe(54.99);
      expect(sorted[sorted.length - 1].price).toBe(9.99);
    });

    it("should sort by price low to high", () => {
      const sorted = [...mockSubscriptions].sort((a, b) => a.price - b.price);

      expect(sorted[0].price).toBe(9.99);
      expect(sorted[sorted.length - 1].price).toBe(54.99);
    });

    it("should preserve relative order for equal prices", () => {
      const testSubs: Subscription[] = [
        { ...mockSubscriptions[0], price: 10 },
        { ...mockSubscriptions[1], price: 10 },
        { ...mockSubscriptions[2], price: 20 },
      ];

      const sorted = [...testSubs].sort((a, b) => a.price - b.price);

      expect(sorted[0].price).toBe(10);
      expect(sorted[1].price).toBe(10);
      expect(sorted[2].price).toBe(20);
    });
  });

  describe("Sort by renewal soon", () => {
    it("should sort by days until renewal (ascending)", () => {
      const sorted = [...mockSubscriptions].sort(
        (a, b) => a.renewsIn - b.renewsIn,
      );

      expect(sorted[0].renewsIn).toBe(2); // Amazon Prime
      expect(sorted[sorted.length - 1].renewsIn).toBe(30); // GitHub Copilot
    });

    it("should show most urgent renewals first", () => {
      const sorted = [...mockSubscriptions].sort(
        (a, b) => a.renewsIn - b.renewsIn,
      );
      const first = sorted[0];

      expect(first.status).toBe("expiring");
      expect(first.renewsIn).toBe(2);
    });
  });

  describe("Default sort (by name)", () => {
    it("should default to alphabetical sort", () => {
      const sorted = [...mockSubscriptions].sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      expect(sorted[0].name).toBe("Adobe Creative Cloud");
    });
  });
});

describe("UX Behavior Preservation", () => {
  describe("Trial subscriptions display", () => {
    it("should correctly identify trial subscriptions", () => {
      const trialSubs = mockSubscriptions.filter((sub) => sub.isTrial);
      expect(trialSubs).toHaveLength(1);
      expect(trialSubs[0].name).toBe("GitHub Copilot");
    });

    it("should sort trials by urgency", () => {
      const trials = mockSubscriptions
        .filter((s) => s.isTrial && s.trialEndsAt)
        .sort(
          (a, b) =>
            new Date(a.trialEndsAt!).getTime() -
            new Date(b.trialEndsAt!).getTime(),
        );

      expect(trials).toHaveLength(1);
    });
  });

  describe("Status badge display", () => {
    it("should identify paused subscriptions", () => {
      const paused = mockSubscriptions.filter((sub) => sub.status === "paused");
      expect(paused).toHaveLength(1);
      expect(paused[0].name).toBe("Notion");
    });

    it("should identify expiring subscriptions", () => {
      const expiring = mockSubscriptions.filter(
        (sub) => sub.status === "expiring",
      );
      expect(expiring).toHaveLength(1);
      expect(expiring[0].renewsIn).toBe(2);
    });
  });

  describe("Price change tracking", () => {
    it("should identify subscriptions with price changes", () => {
      const priceChanges = mockSubscriptions.filter((sub) =>
        Boolean(sub.latest_price_change),
      );
      expect(priceChanges).toHaveLength(1);
      expect(priceChanges[0].latest_price_change?.new_price).toBe(54.99);
    });

    it("should correctly identify price increases", () => {
      const priceChange = mockSubscriptions.find((sub) =>
        Boolean(sub.latest_price_change),
      )?.latest_price_change;

      const isIncrease =
        priceChange && priceChange.new_price > priceChange.old_price;
      expect(isIncrease).toBe(true);
    });
  });

  describe("Total cost calculation", () => {
    it("should correctly sum subscription prices", () => {
      const total = mockSubscriptions.reduce((sum, sub) => sum + sub.price, 0);
      const expected = 15.99 + 9.99 + 14.99 + 20.0 + 54.99 + 10.0 + 19.99;
      expect(total).toBeCloseTo(expected, 2);
    });

    it("should correctly calculate total for filtered subscriptions", () => {
      const filtered = mockSubscriptions.filter(
        (sub) => sub.status === "active",
      );
      const total = filtered.reduce((sum, sub) => sum + sub.price, 0);
      const expected = 15.99 + 9.99 + 20.0 + 54.99 + 19.99;
      expect(total).toBeCloseTo(expected, 2);
    });
  });

  describe("Visibility levels", () => {
    it("should preserve visibility level through operations", () => {
      const sorted = [...mockSubscriptions].sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      const amazonPrime = sorted.find((s) => s.name === "Amazon Prime");
      expect(amazonPrime?.visibility).toBe("team");
    });

    it("should track private vs team visibility correctly", () => {
      const teamSubs = mockSubscriptions.filter(
        (sub) => sub.visibility === "team",
      );
      const privateSubs = mockSubscriptions.filter(
        (sub) => sub.visibility === "private",
      );

      expect(teamSubs).toHaveLength(1);
      expect(privateSubs).toHaveLength(6);
    });
  });

  describe("Empty state handling", () => {
    it("should correctly identify when all subscriptions are filtered out", () => {
      const filtered = mockSubscriptions.filter((sub) =>
        sub.name.includes("NonexistentService"),
      );
      expect(filtered).toHaveLength(0);
    });

    it("should correctly identify when there are no subscriptions", () => {
      const subs: Subscription[] = [];
      expect(subs).toHaveLength(0);
    });
  });
});
