import type { GiftCardProvider } from "./types"

const COINCARDS_WEB_URL = "https://www.coincards.com"

function coincardsSlug(cardBrand: string): string {
  return cardBrand
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export const coincardsProvider: GiftCardProvider = {
  id: "coincards",
  name: "Coincards",
  description: "Canadian-based, Tor-friendly storefront. No account required to purchase.",
  torSupport: true,
  kycLevel: "none",
  // Canadian-based but sells internationally; not Bitrefill-style "150+
  // countries" so left global rather than narrowed to CA without a source.
  supportedRegions: "global",
  acceptedCrypto: ["BTC", "ETH", "LTC", "BCH", "USDC"],
  generatePurchaseUrl(amount: number, cardBrand: string): string {
    const slug = coincardsSlug(cardBrand)
    const params = new URLSearchParams({
      utm_source: "syncro",
      amount: amount.toString(),
    })
    return `${COINCARDS_WEB_URL}/product/${encodeURIComponent(slug)}-gift-card?${params.toString()}`
  },
}
