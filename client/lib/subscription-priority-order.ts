/**
 * Utilities for personal subscription priority ordering.
 */

export type PriorityRank = 1 | 2 | 3

const PRIORITY_RANKS: PriorityRank[] = [1, 2, 3]

export function getPriorityRank(index: number): PriorityRank | undefined {
  if (index >= 0 && index < PRIORITY_RANKS.length) {
    return PRIORITY_RANKS[index]
  }
  return undefined
}

/** Drop stale IDs and append any subscriptions missing from the saved order. */
export function normalizePriorityOrder(
  savedOrder: string[],
  subscriptionIds: string[],
): string[] {
  const idSet = new Set(subscriptionIds)
  const normalized = savedOrder.filter((id) => idSet.has(id))

  for (const id of subscriptionIds) {
    if (!normalized.includes(id)) {
      normalized.push(id)
    }
  }

  return normalized
}

/** Sort subscriptions by stored priority order; unknown IDs fall back to name sort. */
export function sortByPriorityOrder<T extends { id: string; name: string }>(
  subscriptions: T[],
  priorityOrder: string[],
): T[] {
  const order = normalizePriorityOrder(
    priorityOrder,
    subscriptions.map((sub) => sub.id),
  )
  const rank = new Map(order.map((id, index) => [id, index]))

  return [...subscriptions].sort((a, b) => {
    const rankA = rank.get(a.id)
    const rankB = rank.get(b.id)

    if (rankA !== undefined && rankB !== undefined) {
      return rankA - rankB
    }
    if (rankA !== undefined) return -1
    if (rankB !== undefined) return 1
    return a.name.localeCompare(b.name)
  })
}

/** Move an item within an ordered ID list. */
export function reorderIds(
  order: string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= order.length ||
    toIndex >= order.length
  ) {
    return order
  }

  const next = [...order]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

/** Build a full priority order after reordering a filtered subset. */
export function reorderWithinFilteredList(
  fullOrder: string[],
  filteredIds: string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  const normalized = normalizePriorityOrder(fullOrder, filteredIds)
  const reorderedFiltered = reorderIds(filteredIds, fromIndex, toIndex)
  const filteredSet = new Set(filteredIds)

  const result: string[] = []
  let filteredCursor = 0

  for (const id of normalized) {
    if (filteredSet.has(id)) {
      if (filteredCursor < reorderedFiltered.length) {
        result.push(reorderedFiltered[filteredCursor])
        filteredCursor += 1
      }
    } else {
      result.push(id)
    }
  }

  return result
}

export function getGlobalPriorityRank(
  subscriptionId: string,
  fullOrder: string[],
): PriorityRank | undefined {
  const index = fullOrder.indexOf(subscriptionId)
  return getPriorityRank(index)
}
