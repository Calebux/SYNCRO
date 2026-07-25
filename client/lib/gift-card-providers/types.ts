/**
 * Provider abstraction for purchasing gift cards with crypto.
 *
 * "Provider" here means the *purchasing service* (Atomic Wallet, Bitrefill,
 * Coincards, ...) that fulfils a crypto-to-gift-card purchase -- not the
 * gift card brand/merchant itself (Amazon, Steam, ...), which is passed in
 * as `cardBrand` to `generatePurchaseUrl`. See `client/lib/atomic-wallet.ts`
 * for the existing brand-name resolution helpers (`resolveGiftCardProvider`
 * etc.), which predate this abstraction and use "provider" to mean brand.
 */

export type KycLevel = "none" | "low" | "medium" | "high"

export interface GiftCardProviderMetadata {
  /** Stable identifier, persisted as the user's preferred provider. */
  id: string
  /** Display name shown in Settings -> Privacy. */
  name: string
  /** Short description of the privacy trade-offs, shown in the UI. */
  description: string
  /** Whether the provider is reachable over Tor (has a published .onion address). */
  torSupport: boolean
  /** The provider's .onion address, when `torSupport` is true. */
  onionUrl?: string
  /** Approximate KYC burden for a typical purchase. */
  kycLevel: KycLevel
  /** ISO 3166-1 alpha-2 country codes, or "global" if unrestricted. */
  supportedRegions: string[] | "global"
  /** Cryptocurrencies/networks accepted at checkout. */
  acceptedCrypto: string[]
}

export interface GiftCardProvider extends GiftCardProviderMetadata {
  /**
   * Build the URL (web or deep-link) that starts a purchase of `amount`
   * worth of a `cardBrand` (e.g. "amazon", "steam") gift card through this
   * provider.
   */
  generatePurchaseUrl(amount: number, cardBrand: string): string
}
