import { describe, expect, it } from "vitest"
import {
  getGlobalPriorityRank,
  getPriorityRank,
  normalizePriorityOrder,
  reorderIds,
  sortByPriorityOrder,
} from "@/lib/subscription-priority-order"

describe("subscription-priority-order", () => {
  const subs = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Charlie" },
  ]

  it("normalizes saved order by dropping stale IDs and appending new ones", () => {
    expect(normalizePriorityOrder(["c", "missing", "a"], ["a", "b", "c"])).toEqual([
      "c",
      "a",
      "b",
    ])
  })

  it("sorts subscriptions by stored priority order", () => {
    expect(sortByPriorityOrder(subs, ["c", "a", "b"]).map((sub) => sub.id)).toEqual([
      "c",
      "a",
      "b",
    ])
  })

  it("reorders IDs within a list", () => {
    expect(reorderIds(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"])
  })

  it("returns priority ranks for the top three positions", () => {
    expect(getPriorityRank(0)).toBe(1)
    expect(getPriorityRank(2)).toBe(3)
    expect(getPriorityRank(3)).toBeUndefined()
  })

  it("returns global priority rank from full order", () => {
    expect(getGlobalPriorityRank("b", ["a", "b", "c"])).toBe(2)
    expect(getGlobalPriorityRank("z", ["a", "b", "c"])).toBeUndefined()
  })
})
