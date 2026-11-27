/**
 * Feature Flags Configuration
 * Centralized feature flag management for the application
 */

import {
  getBlockchainFlags,
  type BlockchainFlags,
} from '../../shared/blockchain-flags';

export interface FeatureFlags {
    paypalEnabled: boolean
    mockPaymentsEnabled: boolean
    stripeEnabled: boolean
    paystackEnabled: boolean
    /** Whether testnet-only blockchain actions are permitted. */
    testnetActionsEnabled: boolean
    /** Master switch: whether on-chain writes are enabled. */
    blockchainEnabled: boolean
}

export type PaymentProvider = 'stripe' | 'paypal' | 'mock' | 'paystack'

/**
 * Returns true only when running in a non-production environment OR when
 * ENABLE_MOCK_PAYMENTS is explicitly set to 'true'.
 *
 * Production builds (NODE_ENV === 'production') CANNOT enable mock mode
 * via ENABLE_MOCK_PAYMENTS alone — the env check is intentionally ordered
 * so that NODE_ENV=production always wins.
 */
function isMockPaymentsAllowed(): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    return (
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test' ||
        process.env.ENABLE_MOCK_PAYMENTS === 'true'
    );
}

/**
 * Get feature flags from environment variables
 */
export function getFeatureFlags(): FeatureFlags {
    const blockchain: BlockchainFlags = getBlockchainFlags();

    return {
        // PayPal is enabled if credentials are configured
        paypalEnabled: !!(
            process.env.PAYPAL_CLIENT_ID &&
            process.env.PAYPAL_CLIENT_SECRET
        ),

        // Mock payments only enabled in development/test or if explicitly enabled — never in production
        mockPaymentsEnabled: isMockPaymentsAllowed(),

        // Stripe is enabled if API key is configured
        stripeEnabled: !!process.env.STRIPE_SECRET_KEY,

        // Paystack is enabled if secret key is configured
        paystackEnabled: !!process.env.PAYSTACK_SECRET_KEY,

        // Blockchain flags (Issue #84)
        testnetActionsEnabled: blockchain.testnetActionsEnabled,
        blockchainEnabled: blockchain.blockchainEnabled,
    }
}

/**
 * Get available payment providers based on feature flags
 */
export function getAvailablePaymentProviders(): PaymentProvider[] {
    const flags = getFeatureFlags()
    const providers: PaymentProvider[] = []

    if (flags.stripeEnabled)       providers.push('stripe')
    if (flags.paypalEnabled)       providers.push('paypal')
    if (flags.paystackEnabled)     providers.push('paystack')
    if (flags.mockPaymentsEnabled) providers.push('mock')

    return providers
}

/**
 * Check if a payment provider is enabled
 */
export function isPaymentProviderEnabled(provider: PaymentProvider): boolean {
    const flags = getFeatureFlags()

    switch (provider) {
        case 'stripe':   return flags.stripeEnabled
        case 'paypal':   return flags.paypalEnabled
        case 'paystack': return flags.paystackEnabled
        case 'mock':     return flags.mockPaymentsEnabled
        default:         return false
    }
}

/**
 * Get default payment provider
 */
export function getDefaultPaymentProvider(): PaymentProvider {
    const flags = getFeatureFlags()

    // Prefer Stripe, then PayPal, then Paystack, then mock
    if (flags.stripeEnabled)       return 'stripe'
    if (flags.paypalEnabled)       return 'paypal'
    if (flags.paystackEnabled)     return 'paystack'
    if (flags.mockPaymentsEnabled) return 'mock'

    throw new Error('No payment provider is configured')
}

/**
 * Check whether testnet-only blockchain actions are allowed.
 *
 * Use this before rendering testnet-specific UI (faucet links, friendbot
 * buttons, testnet contract call forms, etc.).
 */
export function isTestnetActionAllowed(): boolean {
    return getFeatureFlags().testnetActionsEnabled
}

/**
 * Check whether on-chain writes are enabled.
 */
export function isBlockchainEnabled(): boolean {
    return getFeatureFlags().blockchainEnabled
}