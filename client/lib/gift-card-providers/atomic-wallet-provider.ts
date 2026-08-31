import { getAtomicWalletGiftCardLink } from "../atomic-wallet"
import type { GiftCardProvider } from "./types"

/**
 * Wraps the pre-existing Atomic Wallet integration (`lib/atomic-wallet.ts`)
 * as a `GiftCardProvider`, so it participates in the same provider registry
 * as the new Tor-friendly providers without changing its existing exports
 * (still used directly by `manage-subscription-modal.tsx`'s tests).
 */
export const atomicWalletProvider: GiftCardProvider = {
  id: "atomic_wallet",
  name: "Atomic Wallet",
  description: "Non-custodial wallet with built-in gift card purchases. No Tor support; standard KYC may apply.",
  torSupport: false,
  kycLevel: "low",
  supportedRegions: "global",
  acceptedCrypto: ["BTC", "ETH", "XLM", "USDC", "60+ other assets"],
  generatePurchaseUrl(amount: number, cardBrand: string): string {
    return getAtomicWalletGiftCardLink(amount, cardBrand)
  },
}
