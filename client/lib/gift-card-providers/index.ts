import { atomicWalletProvider } from "./atomic-wallet-provider"
import { bitrefillProvider } from "./bitrefill-provider"
import { coincardsProvider } from "./coincards-provider"
import type { GiftCardProvider } from "./types"

export * from "./types"
export { atomicWalletProvider } from "./atomic-wallet-provider"
export { bitrefillProvider, getBitrefillOnionPurchaseUrl } from "./bitrefill-provider"
export { coincardsProvider } from "./coincards-provider"

/** Every gift-card purchasing provider available to users. */
export const GIFT_CARD_PROVIDERS: GiftCardProvider[] = [
  atomicWalletProvider,
  bitrefillProvider,
  coincardsProvider,
]

export const DEFAULT_GIFT_CARD_PROVIDER_ID: string = atomicWalletProvider.id

export function getGiftCardProvider(id: string | null | undefined): GiftCardProvider {
  const found = GIFT_CARD_PROVIDERS.find((provider) => provider.id === id)
  return found ?? atomicWalletProvider
}

export function isValidGiftCardProviderId(id: string): boolean {
  return GIFT_CARD_PROVIDERS.some((provider) => provider.id === id)
}
