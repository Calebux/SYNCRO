/**
 * Dashboard Data Types
 * Type definitions for dashboard initial data
 */

export interface PriceChange {
    id: string
    subscriptionId: string
    subscriptionName: string
    oldPrice: number
    newPrice: number
    changedAt: Date
    changeType: 'increase' | 'decrease'
    percentChange: number
    annualImpact: number
}

export interface ConsolidationSuggestion {
    id: string
    type: 'duplicate_service' | 'unused_subscription' | 'switch_to_annual' | 'plan_downgrade'
    subscriptionIds: string[]
    subscriptionNames: string[]
    category?: string
    message: string
    potentialSavings: number
    confidence: number
}

export interface DashboardInitialData {
    subscriptions: any[]
    emailAccounts: any[]
    payments: any[]
    priceChanges: PriceChange[]
    consolidationSuggestions: ConsolidationSuggestion[]
}
