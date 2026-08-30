import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  addTagToSubscription,
  removeTagFromSubscription,
} from "../tags"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

import { createClient } from "@/lib/supabase/server"

describe("subscription tag helpers (user-scoped)", () => {
  const userId = "user-owner"
  const otherUserId = "user-other"
  const subscriptionId = "sub-1"
  const tagId = "tag-1"

  let fromMock: ReturnType<typeof vi.fn>
  let upsertMock: ReturnType<typeof vi.fn>
  let deleteMock: ReturnType<typeof vi.fn>

  function chainFor(result: { data: unknown; error: unknown }) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {}
    const methods = ["select", "eq", "upsert", "delete", "insert", "update", "order"]
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    chain.single = vi.fn().mockResolvedValue(result)
    chain.upsert = upsertMock.mockResolvedValue({ error: null })
    chain.delete = deleteMock.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })
    return chain
  }

  beforeEach(() => {
    vi.clearAllMocks()
    upsertMock = vi.fn().mockResolvedValue({ error: null })
    deleteMock = vi.fn()
    fromMock = vi.fn()

    vi.mocked(createClient).mockResolvedValue({
      from: fromMock,
    } as never)
  })

  function mockOwnedResources() {
    // First from: subscriptions, second: subscription_tags, third: assignments
    const subChain = chainFor({ data: { user_id: userId }, error: null })
    const tagChain = chainFor({ data: { user_id: userId }, error: null })
    const assignChain = chainFor({ data: null, error: null })
    assignChain.upsert = upsertMock
    assignChain.delete = deleteMock.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })

    fromMock
      .mockReturnValueOnce(subChain)
      .mockReturnValueOnce(tagChain)
      .mockReturnValueOnce(assignChain)

    return { subChain, tagChain, assignChain }
  }

  it("addTagToSubscription assigns when subscription and tag belong to user", async () => {
    mockOwnedResources()

    await expect(
      addTagToSubscription(userId, subscriptionId, tagId),
    ).resolves.toBeUndefined()

    expect(upsertMock).toHaveBeenCalledWith({
      subscription_id: subscriptionId,
      tag_id: tagId,
    })
  })

  it("addTagToSubscription rejects cross-user subscription", async () => {
    const subChain = chainFor({ data: { user_id: otherUserId }, error: null })
    fromMock.mockReturnValueOnce(subChain)

    await expect(
      addTagToSubscription(userId, subscriptionId, tagId),
    ).rejects.toThrow(/Subscription does not belong to user/)

    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("addTagToSubscription rejects cross-user tag", async () => {
    const subChain = chainFor({ data: { user_id: userId }, error: null })
    const tagChain = chainFor({ data: { user_id: otherUserId }, error: null })
    fromMock.mockReturnValueOnce(subChain).mockReturnValueOnce(tagChain)

    await expect(
      addTagToSubscription(userId, subscriptionId, tagId),
    ).rejects.toThrow(/Tag does not belong to user/)

    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("removeTagFromSubscription removes when subscription and tag belong to user", async () => {
    mockOwnedResources()

    await expect(
      removeTagFromSubscription(userId, subscriptionId, tagId),
    ).resolves.toBeUndefined()

    expect(deleteMock).toHaveBeenCalled()
  })

  it("removeTagFromSubscription rejects cross-user subscription", async () => {
    const subChain = chainFor({ data: { user_id: otherUserId }, error: null })
    fromMock.mockReturnValueOnce(subChain)

    await expect(
      removeTagFromSubscription(userId, subscriptionId, tagId),
    ).rejects.toThrow(/Subscription does not belong to user/)

    expect(deleteMock).not.toHaveBeenCalled()
  })

  it("removeTagFromSubscription rejects cross-user tag", async () => {
    const subChain = chainFor({ data: { user_id: userId }, error: null })
    const tagChain = chainFor({ data: { user_id: otherUserId }, error: null })
    fromMock.mockReturnValueOnce(subChain).mockReturnValueOnce(tagChain)

    await expect(
      removeTagFromSubscription(userId, subscriptionId, tagId),
    ).rejects.toThrow(/Tag does not belong to user/)

    expect(deleteMock).not.toHaveBeenCalled()
  })
})
