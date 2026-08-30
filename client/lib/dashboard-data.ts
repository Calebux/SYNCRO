/**
 * Dashboard Data Fetching and Transformation
 * Handles fetching and transforming price changes and consolidation suggestions
 */

import { createClient } from '@/lib/supabase/server'
import type { PriceChange, ConsolidationSuggestion } from '@/lib/types/dashboard'

/**
 * Fetch price changes from subscription_price_history table
 */
export async function fetchPriceChanges(userId: string): Promise<PriceChange[]> {
    try {
        const supabase = await createClient()

        // Fetch price history with subscription details
        const { data, error } = await supabase
            .from('subscription_price_history')
            .select(`
        id,
        subscription_id,
        old_price,
        new_price,
        changed_at,
        subscriptions!inner(
          id,
          name
        )
      `)
            .eq('user_id', userId)
            .order('changed_at', { ascending: false })
            .limit(50) // Limit to most recent 50 changes

        if (error) {
            console.error('[fetchPriceChanges] Database error:', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint,
            })
            return []
        }

        if (!data || data.length === 0) {
            console.log('[fetchPriceChanges] No price changes found for user:', userId)
            return []
        }

        // Transform database records to PriceChange type
        const priceChanges: PriceChange[] = data.map((record: any) => {
            const oldPrice = parseFloat(record.old_price)
            const newPrice = parseFloat(record.new_price)
            const changeType = newPrice > oldPrice ? 'increase' : 'decrease'
            const percentChange = ((newPrice - oldPrice) / oldPrice) * 100
            const annualImpact = (newPrice - oldPrice) * 12 // Assuming monthly billing

            return {
                id: record.id,
                subscriptionId: record.subscription_id,
                subscriptionName: record.subscriptions?.name || 'Unknown',
                oldPrice,
                newPrice,
                changedAt: new Date(record.changed_at),
                changeType,
                percentChange: Math.round(percentChange * 100) / 100, // Round to 2 decimals
                annualImpact: Math.round(annualImpact * 100) / 100,
            }
        })

        console.log(`[fetchPriceChanges] Successfully fetched ${priceChanges.length} price changes`)
        return priceChanges
    } catch (error) {
        console.error('[fetchPriceChanges] Unexpected error:', {
            error,
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        })
        return []
    }
}

/**
 * Generate consolidation suggestions based on user's subscriptions
 * This analyzes subscriptions to find opportunities for savings
 */
export async function fetchConsolidationSuggestions(
    userId: string
): Promise<ConsolidationSuggestion[]> {
    try {
        const supabase = await createClient()

        // Fetch user's active subscriptions
        const { data: subscriptions, error } = await supabase
            .from('subscriptions')
            .select('id, name, category, price, billing_cycle, status, last_used_at, created_at')
            .eq('user_id', userId)
            .eq('status', 'active')

        if (error) {
            console.error('[fetchConsolidationSuggestions] Database error:', {
                code: error.code,
                message: error.message,
                details: error.details,
            })
            return []
        }

        if (!subscriptions || subscriptions.length === 0) {
            console.log('[fetchConsolidationSuggestions] No active subscriptions found')
            return []
        }

        const suggestions: ConsolidationSuggestion[] = []

        // 1. Detect duplicate services (same category, similar names)
        const duplicates = detectDuplicateServices(subscriptions)
        suggestions.push(...duplicates)

        // 2. Detect unused subscriptions (no recent usage)
        const unused = detectUnusedSubscriptions(subscriptions)
        suggestions.push(...unused)

        // 3. Detect annual billing opportunities (monthly subscriptions)
        const annualOpportunities = detectAnnualBillingOpportunities(subscriptions)
        suggestions.push(...annualOpportunities)

        console.log(`[fetchConsolidationSuggestions] Generated ${suggestions.length} suggestions`)
        return suggestions
    } catch (error) {
        console.error('[fetchConsolidationSuggestions] Unexpected error:', {
            error,
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
        })
        return []
    }
}

/**
 * Detect duplicate services in the same category
 */
function detectDuplicateServices(subscriptions: any[]): ConsolidationSuggestion[] {
    const suggestions: ConsolidationSuggestion[] = []
    const categoryGroups = new Map<string, any[]>()

    // Group by category
    subscriptions.forEach(sub => {
        if (!sub.category) return
        const existing = categoryGroups.get(sub.category) || []
        existing.push(sub)
        categoryGroups.set(sub.category, existing)
    })

    // Find categories with multiple subscriptions
    categoryGroups.forEach((subs, category) => {
        if (subs.length >= 2) {
            const totalCost = subs.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0)
            const avgCost = totalCost / subs.length
            const potentialSavings = totalCost - avgCost // Estimate: keep one, save the rest

            suggestions.push({
                id: `duplicate_${category}_${Date.now()}`,
                type: 'duplicate_service',
                subscriptionIds: subs.map(s => s.id),
                subscriptionNames: subs.map(s => s.name),
                category,
                message: `You have ${subs.length} ${category} subscriptions. Consider consolidating to save money.`,
                potentialSavings: Math.round(potentialSavings * 100) / 100,
                confidence: 0.8,
            })
        }
    })

    return suggestions
}

/**
 * Detect unused subscriptions (no usage in last 60 days)
 */
function detectUnusedSubscriptions(subscriptions: any[]): ConsolidationSuggestion[] {
    const suggestions: ConsolidationSuggestion[] = []
    const sixtyDaysAgo = new Date()
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

    subscriptions.forEach(sub => {
        const lastUsed = sub.last_used_at ? new Date(sub.last_used_at) : null
        const createdAt = new Date(sub.created_at)

        // If never used and created more than 30 days ago, or last used > 60 days ago
        const isUnused = (!lastUsed && createdAt < sixtyDaysAgo) ||
            (lastUsed && lastUsed < sixtyDaysAgo)

        if (isUnused) {
            const monthlyCost = parseFloat(sub.price) || 0
            const annualSavings = monthlyCost * 12

            suggestions.push({
                id: `unused_${sub.id}_${Date.now()}`,
                type: 'unused_subscription',
                subscriptionIds: [sub.id],
                subscriptionNames: [sub.name],
                message: `${sub.name} hasn't been used in over 60 days. Consider canceling to save money.`,
                potentialSavings: Math.round(annualSavings * 100) / 100,
                confidence: 0.9,
            })
        }
    })

    return suggestions
}

/**
 * Detect opportunities to switch to annual billing
 */
function detectAnnualBillingOpportunities(subscriptions: any[]): ConsolidationSuggestion[] {
    const suggestions: ConsolidationSuggestion[] = []

    subscriptions.forEach(sub => {
        // Only suggest for monthly subscriptions with price > $10
        if (sub.billing_cycle === 'monthly' && parseFloat(sub.price) > 10) {
            const monthlyCost = parseFloat(sub.price)
            const annualCost = monthlyCost * 12
            // Typical annual discount is 15-20%
            const estimatedAnnualPrice = annualCost * 0.85
            const potentialSavings = annualCost - estimatedAnnualPrice

            suggestions.push({
                id: `annual_${sub.id}_${Date.now()}`,
                type: 'switch_to_annual',
                subscriptionIds: [sub.id],
                subscriptionNames: [sub.name],
                message: `Switch ${sub.name} to annual billing and save ~15% (estimated $${potentialSavings.toFixed(2)}/year).`,
                potentialSavings: Math.round(potentialSavings * 100) / 100,
                confidence: 0.7,
            })
        }
    })

    return suggestions
}

/**
 * Filter out dismissed suggestions
 */
export async function filterDismissedSuggestions(
    userId: string,
    suggestions: ConsolidationSuggestion[]
): Promise<ConsolidationSuggestion[]> {
    try {
        const supabase = await createClient()

        // Fetch dismissed suggestions that are still active
        const { data: dismissed, error } = await supabase
            .from('dismissed_suggestions')
            .select('subscription_id, suggestion_type, dismissed_until')
            .eq('user_id', userId)
            .gte('dismissed_until', new Date().toISOString())

        if (error) {
            console.error('[filterDismissedSuggestions] Error fetching dismissed:', error)
            return suggestions // Return all suggestions if we can't fetch dismissed
        }

        if (!dismissed || dismissed.length === 0) {
            return suggestions
        }

        // Create a set of dismissed combinations
        const dismissedSet = new Set(
            dismissed.map(d => `${d.subscription_id}_${d.suggestion_type}`)
        )

        // Filter out dismissed suggestions
        const filtered = suggestions.filter(suggestion => {
            // Check if any of the subscription IDs in this suggestion are dismissed
            return !suggestion.subscriptionIds.some(subId =>
                dismissedSet.has(`${subId}_${suggestion.type}`)
            )
        })

        console.log(`[filterDismissedSuggestions] Filtered ${suggestions.length - filtered.length} dismissed suggestions`)
        return filtered
    } catch (error) {
        console.error('[filterDismissedSuggestions] Unexpected error:', error)
        return suggestions // Return all suggestions on error
    }
}
