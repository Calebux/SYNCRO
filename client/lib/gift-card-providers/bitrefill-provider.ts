import type { GiftCardProvider } from "./types"

const BITREFILL_WEB_URL = "https://www.bitrefill.com"
// Published Bitrefill Tor mirror (see bitrefill.com footer / onion-location
// header). Verify against https://bitrefill.com before relying on this in
// production -- onion addresses occasionally rotate.
const BITREFILL_ONION_URL =
  "http://bitrefillxa3kr2zljvkc2wbsiy5y6vmgs3zr2lkbcq6ohwlbtwsfo7id.onion"

function bitrefillSlug(cardBrand: string): string {
  return cardBrand
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Builds a Bitrefill purchase URL for `cardBrand`. Bitrefill's product
 * pages follow the pattern `/buy/{slug}`; `amount` is passed as a query
 * hint (Bitrefill product pages expose fixed denominations and will
 * highlight/select the closest one client-side).
 */
function buildPurchaseUrl(base: string, amount: number, cardBrand: string): string {
  const slug = bitrefillSlug(cardBrand)
  const params = new URLSearchParams({
    utm_source: "syncro",
    amount: amount.toString(),
  })
  return `${base}/buy/${encodeURIComponent(slug)}-gift-card?${params.toString()}`
}

export const bitrefillProvider: GiftCardProvider = {
  id: "bitrefill",
  name: "Bitrefill",
  description:
    "Accessible via a Tor .onion mirror, accepts Lightning Network payments, and supports 150+ countries.",
  torSupport: true,
  onionUrl: BITREFILL_ONION_URL,
  kycLevel: "none",
  supportedRegions: "global",
  acceptedCrypto: ["BTC", "BTC (Lightning)", "ETH", "LTC", "DOGE", "USDT"],
  generatePurchaseUrl(amount: number, cardBrand: string): string {
    return buildPurchaseUrl(BITREFILL_WEB_URL, amount, cardBrand)
  },
}

/** Returns the .onion purchase URL instead of the clearnet one, for users on Tor Browser. */
export function getBitrefillOnionPurchaseUrl(amount: number, cardBrand: string): string {
  return buildPurchaseUrl(BITREFILL_ONION_URL, amount, cardBrand)
}
