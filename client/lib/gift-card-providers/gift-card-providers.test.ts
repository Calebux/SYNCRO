import { describe, expect, it } from "vitest"
import {
  GIFT_CARD_PROVIDERS,
  DEFAULT_GIFT_CARD_PROVIDER_ID,
  getGiftCardProvider,
  isValidGiftCardProviderId,
  atomicWalletProvider,
  bitrefillProvider,
  coincardsProvider,
  getBitrefillOnionPurchaseUrl,
} from "./index"

describe("gift card provider registry", () => {
  it("includes Atomic Wallet, Bitrefill, and Coincards", () => {
    const ids = GIFT_CARD_PROVIDERS.map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(["atomic_wallet", "bitrefill", "coincards"]))
  })

  it("defaults to the existing Atomic Wallet provider", () => {
    expect(DEFAULT_GIFT_CARD_PROVIDER_ID).toBe("atomic_wallet")
  })

  it("getGiftCardProvider falls back to the default for an unknown id", () => {
    expect(getGiftCardProvider("not-a-real-provider").id).toBe("atomic_wallet")
    expect(getGiftCardProvider(undefined).id).toBe("atomic_wallet")
  })

  it("getGiftCardProvider resolves a known id", () => {
    expect(getGiftCardProvider("bitrefill").id).toBe("bitrefill")
    expect(getGiftCardProvider("coincards").id).toBe("coincards")
  })

  it("isValidGiftCardProviderId distinguishes known from unknown ids", () => {
    expect(isValidGiftCardProviderId("bitrefill")).toBe(true)
    expect(isValidGiftCardProviderId("coincards")).toBe(true)
    expect(isValidGiftCardProviderId("atomic_wallet")).toBe(true)
    expect(isValidGiftCardProviderId("paypal")).toBe(false)
  })
})

describe("Bitrefill provider", () => {
  it("supports Tor and exposes an onion URL", () => {
    expect(bitrefillProvider.torSupport).toBe(true)
    expect(bitrefillProvider.onionUrl).toMatch(/\.onion$/)
  })

  it("generates a clearnet purchase URL with brand slug and amount", () => {
    const url = bitrefillProvider.generatePurchaseUrl(25, "Amazon")
    expect(url).toContain("bitrefill.com/buy/amazon-gift-card")
    expect(url).toContain("amount=25")
  })

  it("normalizes multi-word brand names into a hyphenated slug", () => {
    const url = bitrefillProvider.generatePurchaseUrl(50, "Google Play")
    expect(url).toContain("/buy/google-play-gift-card")
  })

  it("getBitrefillOnionPurchaseUrl returns an onion-hosted URL", () => {
    const url = getBitrefillOnionPurchaseUrl(10, "Steam")
    expect(url).toContain(".onion/buy/steam-gift-card")
  })
})

describe("Coincards provider", () => {
  it("supports Tor and requires no account / KYC", () => {
    expect(coincardsProvider.torSupport).toBe(true)
    expect(coincardsProvider.kycLevel).toBe("none")
  })

  it("generates a purchase URL with brand slug and amount", () => {
    const url = coincardsProvider.generatePurchaseUrl(40, "Visa")
    expect(url).toContain("coincards.com/product/visa-gift-card")
    expect(url).toContain("amount=40")
  })
})

describe("Atomic Wallet provider (wrapped)", () => {
  it("does not support Tor", () => {
    expect(atomicWalletProvider.torSupport).toBe(false)
  })

  it("delegates to the existing atomic-wallet.ts URL builder", () => {
    const url = atomicWalletProvider.generatePurchaseUrl(15, "Amazon")
    expect(url).toContain("provider=amazon")
    expect(url).toContain("amount=15")
  })
})
