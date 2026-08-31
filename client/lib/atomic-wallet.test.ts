import { describe, expect, it } from "vitest"
import {
  getAtomicWalletGiftCardDeepLink,
  getAtomicWalletGiftCardWebLink,
  getAtomicWalletGiftCardLink,
  normalizeGiftCardProvider,
  getGiftCardProviderFromSubscription,
  stripTrackingParams,
} from "./atomic-wallet"

describe("Atomic Wallet gift card deep links", () => {
  it("normalizes provider names for query params", () => {
    expect(normalizeGiftCardProvider("Google Play")).toBe("google_play")
    expect(normalizeGiftCardProvider(" AMAZON ")).toBe("amazon")
    expect(normalizeGiftCardProvider("Visa")).toBe("visa")
    expect(normalizeGiftCardProvider("Steam")).toBe("steam")
  })

  it("generates a mobile deep link with amount and provider", () => {
    expect(getAtomicWalletGiftCardDeepLink(25, "Amazon")).toBe(
      "atomicwallet://buy-gift-card?amount=25&provider=amazon",
    )
  })

  it("generates a web fallback link with amount and provider", () => {
    expect(getAtomicWalletGiftCardWebLink(25, "Amazon")).toBe(
      "https://atomicwallet.io/buy-gift-cards?amount=25&provider=amazon",
    )
  })

  it("infers a gift card provider from subscription metadata", () => {
    expect(getGiftCardProviderFromSubscription({ provider: "Steam" })).toBe("steam")
    expect(getGiftCardProviderFromSubscription({ name: "YouTube Premium" })).toBe("google_play")
    expect(getGiftCardProviderFromSubscription({ category: "Amazon" })).toBe("amazon")
  })

  it("returns null for unknown providers", () => {
    expect(getGiftCardProviderFromSubscription({ provider: "Acme Subscription" })).toBeNull()
    expect(getGiftCardProviderFromSubscription({ name: "Unknown Service" })).toBeNull()
  })

  it("returns a web link on non-browser environments", () => {
    expect(getAtomicWalletGiftCardLink(10, "Visa")).toBe(
      "https://atomicwallet.io/buy-gift-cards?amount=10&provider=visa",
    )
  })
})

describe("stripTrackingParams", () => {
  it("strips UTM parameters from URLs", () => {
    const url = "https://example.com/page?amount=25&utm_source=app&utm_medium=referral&utm_campaign=test"
    const stripped = stripTrackingParams(url)
    expect(stripped).toBe("https://example.com/page?amount=25")
  })

  it("strips fbclid and gclid parameters", () => {
    const url = "https://example.com/?item=1&fbclid=abc123&gclid=def456"
    const stripped = stripTrackingParams(url)
    expect(stripped).toBe("https://example.com/?item=1")
  })

  it("strips ref and source parameters", () => {
    const url = "https://example.com/?amount=10&ref=syncro&source=app"
    const stripped = stripTrackingParams(url)
    expect(stripped).toBe("https://example.com/?amount=10")
  })

  it("preserves non-tracking parameters", () => {
    const url = "https://example.com/buy?amount=25&provider=amazon"
    const stripped = stripTrackingParams(url)
    expect(stripped).toBe("https://example.com/buy?amount=25&provider=amazon")
  })

  it("returns original string for non-URL inputs", () => {
    const url = "not-a-url"
    expect(stripTrackingParams(url)).toBe("not-a-url")
  })

  it("handles URLs with no query params", () => {
    const url = "https://example.com/page"
    expect(stripTrackingParams(url)).toBe("https://example.com/page")
  })
})
