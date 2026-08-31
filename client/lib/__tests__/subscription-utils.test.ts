import { describe, it, expect, beforeEach } from "vitest"
import {
  getTrialSubscriptions,
  detectDuplicates,
  detectUnusedSubscriptions,
  getCancelledSubscriptions,
  getPausedSubscriptions,
  calculateRecurringSpend,
  calculateTotalSpend,
  checkRenewalReminders,
  checkDuplicate,
} from "../subscription-utils"
import type { Subscription } from "../supabase/subscriptions"

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    name: "Test Sub",
    category: "Productivity",
    price: 10,
    icon: "📦",
    renews_in: 30,
    status: "active",
    color: "#000000",
    renewal_url: null,
    tags: [],
    date_added: "2024-01-01",
    email_account_id: null,
    is_trial: false,
    source: "manual",
    manually_edited: false,
    edited_fields: [],
    pricing_type: "fixed",
    billing_cycle: "monthly",
    ...overrides,
  }
}

// ── getTrialSubscriptions ─────────────────────────────────────────────────────

describe("getTrialSubscriptions", () => {
  it("returns only subscriptions where is_trial is true", () => {
    const subs = [
      makeSubscription({ id: 1, is_trial: true }),
      makeSubscription({ id: 2, is_trial: false }),
      makeSubscription({ id: 3, is_trial: true }),
    ]
    const result = getTrialSubscriptions(subs)
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.id)).toEqual([1, 3])
  })

  it("returns empty array when no trials exist", () => {
    const subs = [makeSubscription({ is_trial: false })]
    expect(getTrialSubscriptions(subs)).toHaveLength(0)
  })

  it("returns empty array for empty input", () => {
    expect(getTrialSubscriptions([])).toHaveLength(0)
  })

  it("includes trials regardless of status", () => {
    const subs = [
      makeSubscription({ id: 1, is_trial: true, status: "active" }),
      makeSubscription({ id: 2, is_trial: true, status: "cancelled" }),
      makeSubscription({ id: 3, is_trial: true, status: "paused" }),
    ]
    expect(getTrialSubscriptions(subs)).toHaveLength(3)
  })
})

// ── detectDuplicates ──────────────────────────────────────────────────────────

describe("detectDuplicates", () => {
  it("detects two subscriptions with the same name (case-insensitive)", () => {
    const subs = [
      makeSubscription({ id: 1, name: "ChatGPT Plus", price: 20 }),
      makeSubscription({ id: 2, name: "chatgpt plus", price: 20 }),
    ]
    const result = detectDuplicates(subs)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("ChatGPT Plus")
    expect(result[0].count).toBe(2)
  })

  it("calculates totalCost and potentialSavings correctly", () => {
    const subs = [
      makeSubscription({ id: 1, name: "Notion", price: 16 }),
      makeSubscription({ id: 2, name: "Notion", price: 16 }),
    ]
    const [group] = detectDuplicates(subs)
    expect(group.totalCost).toBe(32)
    // potentialSavings = totalCost - price of first subscription
    expect(group.potentialSavings).toBe(16)
  })

  it("returns empty array when no duplicates exist", () => {
    const subs = [
      makeSubscription({ id: 1, name: "Notion" }),
      makeSubscription({ id: 2, name: "Figma" }),
    ]
    expect(detectDuplicates(subs)).toHaveLength(0)
  })

  it("handles three duplicates", () => {
    const subs = [
      makeSubscription({ id: 1, name: "Slack", price: 10 }),
      makeSubscription({ id: 2, name: "Slack", price: 10 }),
      makeSubscription({ id: 3, name: "Slack", price: 10 }),
    ]
    const [group] = detectDuplicates(subs)
    expect(group.count).toBe(3)
    expect(group.totalCost).toBe(30)
    expect(group.potentialSavings).toBe(20)
  })

  it("returns empty array for empty input", () => {
    expect(detectDuplicates([])).toHaveLength(0)
  })

  it("does not flag unique subscriptions as duplicates", () => {
    const subs = Array.from({ length: 5 }, (_, i) =>
      makeSubscription({ id: i, name: `Service ${i}` })
    )
    expect(detectDuplicates(subs)).toHaveLength(0)
  })
})

// ── detectUnusedSubscriptions ─────────────────────────────────────────────────

describe("detectUnusedSubscriptions", () => {
  const now = new Date()

  it("flags active subscriptions with no last_interaction_at", () => {
    const subs = [makeSubscription({ id: 1, status: "active" })]
    const result = detectUnusedSubscriptions(subs)
    expect(result).toHaveLength(1)
    expect(result[0].potentiallyWasted).toBe(true)
    expect(result[0].daysSinceInteraction).toBeNull()
  })

  it("flags active subscriptions last interacted with more than 90 days ago", () => {
    const ninetyOneDaysAgo = new Date(now.getTime() - 91 * 86_400_000).toISOString()
    const subs = [
      makeSubscription({
        id: 1,
        status: "active",
        last_used_at: ninetyOneDaysAgo,
      } as Subscription & { last_interaction_at: string }),
    ]
    // Inject last_interaction_at directly since the util reads it via (sub as any)
    ;(subs[0] as any).last_interaction_at = ninetyOneDaysAgo
    const result = detectUnusedSubscriptions(subs)
    expect(result).toHaveLength(1)
    expect(result[0].daysSinceInteraction).toBeGreaterThanOrEqual(91)
  })

  it("does not flag subscriptions interacted with within 90 days", () => {
    const recentDate = new Date(now.getTime() - 30 * 86_400_000).toISOString()
    const sub = makeSubscription({ id: 1, status: "active" })
    ;(sub as any).last_interaction_at = recentDate
    expect(detectUnusedSubscriptions([sub])).toHaveLength(0)
  })

  it("does not flag non-active subscriptions", () => {
    const subs = [
      makeSubscription({ id: 1, status: "cancelled" }),
      makeSubscription({ id: 2, status: "paused" }),
      makeSubscription({ id: 3, status: "trial" }),
    ]
    expect(detectUnusedSubscriptions(subs)).toHaveLength(0)
  })

  it("returns empty array for empty input", () => {
    expect(detectUnusedSubscriptions([])).toHaveLength(0)
  })

  it("preserves all original subscription fields on returned items", () => {
    const sub = makeSubscription({ id: 42, name: "Figma", price: 15 })
    const result = detectUnusedSubscriptions([sub])
    expect(result[0].id).toBe(42)
    expect(result[0].name).toBe("Figma")
    expect(result[0].price).toBe(15)
  })
})

// ── getCancelledSubscriptions ─────────────────────────────────────────────────

describe("getCancelledSubscriptions", () => {
  it("returns only cancelled subscriptions", () => {
    const subs = [
      makeSubscription({ id: 1, status: "active" }),
      makeSubscription({ id: 2, status: "cancelled" }),
      makeSubscription({ id: 3, status: "paused" }),
    ]
    const result = getCancelledSubscriptions(subs)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(2)
  })
})

// ── getPausedSubscriptions ────────────────────────────────────────────────────

describe("getPausedSubscriptions", () => {
  it("returns only paused subscriptions", () => {
    const subs = [
      makeSubscription({ id: 1, status: "active" }),
      makeSubscription({ id: 2, status: "paused" }),
    ]
    const result = getPausedSubscriptions(subs)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(2)
  })
})

// ── calculateRecurringSpend ───────────────────────────────────────────────────

describe("calculateRecurringSpend", () => {
  it("sums prices of active non-lifetime subscriptions", () => {
    const subs = [
      makeSubscription({ id: 1, status: "active", price: 10, billing_cycle: "monthly" }),
      makeSubscription({ id: 2, status: "active", price: 20, billing_cycle: "yearly" }),
      makeSubscription({ id: 3, status: "active", price: 999, billing_cycle: "lifetime" }),
      makeSubscription({ id: 4, status: "cancelled", price: 5, billing_cycle: "monthly" }),
    ]
    expect(calculateRecurringSpend(subs)).toBe(30)
  })

  it("returns 0 for empty input", () => {
    expect(calculateRecurringSpend([])).toBe(0)
  })
})

// ── calculateTotalSpend ───────────────────────────────────────────────────────

describe("calculateTotalSpend", () => {
  it("includes active and cancelled, excludes lifetime billing", () => {
    const subs = [
      makeSubscription({ id: 1, status: "active", price: 10, billing_cycle: "monthly" }),
      makeSubscription({ id: 2, status: "cancelled", price: 5, billing_cycle: "monthly" }),
      makeSubscription({ id: 3, status: "active", price: 999, billing_cycle: "lifetime" }),
      makeSubscription({ id: 4, status: "paused", price: 15, billing_cycle: "monthly" }),
    ]
    expect(calculateTotalSpend(subs)).toBe(15)
  })
})

// ── checkRenewalReminders ─────────────────────────────────────────────────────

describe("checkRenewalReminders", () => {
  it("returns active subscriptions renewing within 3 days", () => {
    const subs = [
      makeSubscription({ id: 1, status: "active", renews_in: 1 }),
      makeSubscription({ id: 2, status: "active", renews_in: 3 }),
      makeSubscription({ id: 3, status: "active", renews_in: 4 }),
      makeSubscription({ id: 4, status: "cancelled", renews_in: 1 }),
    ]
    const result = checkRenewalReminders(subs)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id)).toEqual([1, 2])
  })

  it("includes renewsIn and name on each reminder", () => {
    const subs = [makeSubscription({ id: 1, name: "Notion", status: "active", renews_in: 2 })]
    const [reminder] = checkRenewalReminders(subs)
    expect(reminder.name).toBe("Notion")
    expect(reminder.renewsIn).toBe(2)
  })
})

// ── checkDuplicate ────────────────────────────────────────────────────────────

describe("checkDuplicate", () => {
  it("returns true when a subscription with the same name exists (case-insensitive)", () => {
    const subs = [makeSubscription({ name: "Notion" })]
    expect(checkDuplicate(subs, "notion")).toBe(true)
    expect(checkDuplicate(subs, "NOTION")).toBe(true)
  })

  it("returns false when no match exists", () => {
    const subs = [makeSubscription({ name: "Notion" })]
    expect(checkDuplicate(subs, "Figma")).toBe(false)
  })

  it("returns false for empty subscription list", () => {
    expect(checkDuplicate([], "Notion")).toBe(false)
  })
})
