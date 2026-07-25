export const ATOMIC_WALLET_MOBILE_SCHEME = "atomicwallet://buy-gift-card"
export const ATOMIC_WALLET_WEB_URL = "https://atomicwallet.io/buy-gift-cards"

const TRACKING_PARAM_PREFIXES = ["utm_", "fbclid", "gclid", "ref", "source", "campaign", "medium", "content", "term"]

const GIFT_CARD_PROVIDER_ALIASES: Array<[RegExp, string]> = [
  [/amazon/i, "amazon"],
  [/google\s*play|youtube|google play/i, "google_play"],
  [/steam/i, "steam"],
  [/visa/i, "visa"],
  [/apple/i, "apple"],
  [/playstation/i, "playstation"],
]

const SUPPORTED_GIFT_CARD_PROVIDERS = new Set(
  GIFT_CARD_PROVIDER_ALIASES.map(([, provider]) => provider),
)

export function stripTrackingParams(url: string): string {
  try {
    const parsed = new URL(url)
    const keysToRemove: string[] = []
    parsed.searchParams.forEach((_, key) => {
      const lower = key.toLowerCase()
      if (TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
        keysToRemove.push(key)
      }
    })
    for (const key of keysToRemove) {
      parsed.searchParams.delete(key)
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export function normalizeGiftCardProvider(provider: string): string {
  return provider.trim().replace(/\s+/g, "_").toLowerCase()
}

export function resolveGiftCardProvider(provider: string): string | null {
  const trimmed = provider.trim()
  const matched = GIFT_CARD_PROVIDER_ALIASES.find(([pattern]) => pattern.test(trimmed))
  if (matched) {
    return matched[1]
  }

  const normalized = normalizeGiftCardProvider(trimmed)
  return SUPPORTED_GIFT_CARD_PROVIDERS.has(normalized) ? normalized : null
}

export function getAtomicWalletGiftCardDeepLink(amount: number, provider: string): string {
  const normalizedProvider = normalizeGiftCardProvider(provider)
  const encodedProvider = encodeURIComponent(normalizedProvider)
  const encodedAmount = encodeURIComponent(amount.toString())
  return stripTrackingParams(
    `${ATOMIC_WALLET_MOBILE_SCHEME}?amount=${encodedAmount}&provider=${encodedProvider}`
  )
}

export function getAtomicWalletGiftCardWebLink(amount: number, provider: string): string {
  const normalizedProvider = normalizeGiftCardProvider(provider)
  const encodedProvider = encodeURIComponent(normalizedProvider)
  const encodedAmount = encodeURIComponent(amount.toString())
  return stripTrackingParams(
    `${ATOMIC_WALLET_WEB_URL}?amount=${encodedAmount}&provider=${encodedProvider}`
  )
}

export function getAtomicWalletGiftCardLink(amount: number, provider: string): string {
  if (typeof navigator === "undefined") {
    return getAtomicWalletGiftCardWebLink(amount, provider)
  }

  const userAgent = navigator.userAgent || ""
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
  return isMobile
    ? getAtomicWalletGiftCardDeepLink(amount, provider)
    : getAtomicWalletGiftCardWebLink(amount, provider)
}

export function openAtomicWalletGiftCard(amount: number, provider: string): string {
  const url = getAtomicWalletGiftCardLink(amount, provider)

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noreferrer,noopener")
  }

  return url
}

export function getGiftCardProviderFromSubscription(subscription: any): string | null {
  if (!subscription) {
    return null
  }

  const source =
    subscription.provider ||
    subscription.name ||
    subscription.category ||
    subscription.merchant_name ||
    subscription.merchantId ||
    subscription.merchant_id ||
    ""

  const candidate = String(source).trim()
  if (!candidate) {
    return null
  }

  return resolveGiftCardProvider(candidate)
}
