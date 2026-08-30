import { createClient } from '@/lib/supabase/server'
import { buildQueryWarning, type DataLoadWarning } from '@/lib/dashboard-bootstrap'
import { fetchConsolidationSuggestions, filterDismissedSuggestions } from '@/lib/dashboard-data'
import { getAnalyticsSummary } from '@/lib/dashboard-analytics'
import type { AnalyticsSummary } from '@/lib/api/analytics'
import type { ConsolidationSuggestion } from '@/lib/types'

export type InitialPriceChange = {
  id: string
  subscriptionId: number
  name: string
  oldPrice: number
  newPrice: number
  changeDate: string
  changeType: 'increase' | 'decrease'
  annualImpact: number
  percentChange: number
}

export type InitialDataResult = {
  subscriptions: any[];
  emailAccounts: any[];
  payments: any[];
  priceChanges: InitialPriceChange[];
  consolidationSuggestions: any[];
  analyticsSummary: AnalyticsSummary | null;
  warnings: DataLoadWarning[];
  isDemo: boolean;
}

function transformSubscription(dbSub: any): any {
  return {
    id: dbSub.id,
    name: dbSub.name,
    category: dbSub.category,
    price: dbSub.price,
    icon: dbSub.icon || '🔗',
    renewsIn: dbSub.renews_in,
    status: dbSub.status,
    color: dbSub.color || '#000000',
    renewalUrl: dbSub.renewal_url,
    tags: dbSub.tags || [],
    dateAdded: dbSub.date_added,
    emailAccountId: dbSub.email_account_id,
    lastUsedAt: dbSub.last_used_at,
    hasApiKey: dbSub.has_api_key || false,
    isTrial: dbSub.is_trial || false,
    is_encrypted: dbSub.is_encrypted ?? false,
    trialEndsAt: dbSub.trial_ends_at,
    priceAfterTrial: dbSub.price_after_trial,
    source: dbSub.source || 'manual',
    manuallyEdited: dbSub.manually_edited || false,
    editedFields: dbSub.edited_fields || [],
    pricingType: dbSub.pricing_type || 'fixed',
    billingCycle: dbSub.billing_cycle || 'monthly',
    cancelledAt: dbSub.cancelled_at,
    activeUntil: dbSub.active_until,
    pausedAt: dbSub.paused_at,
    resumesAt: dbSub.resumes_at,
    priceRange: dbSub.price_range,
    priceHistory: dbSub.price_history,
  }
}

function normalizePriceChange(
  dbChange: any,
  subscriptionsById: Map<number, any>,
): InitialPriceChange {
  const oldPrice = Number(dbChange.old_price ?? 0)
  const newPrice = Number(dbChange.new_price ?? 0)
  const subscription = subscriptionsById.get(dbChange.subscription_id)
  const changeType = newPrice >= oldPrice ? 'increase' : 'decrease'

  return {
    id: dbChange.id,
    subscriptionId: dbChange.subscription_id,
    name: subscription?.name ?? `Subscription ${dbChange.subscription_id}`,
    oldPrice,
    newPrice,
    changeDate: dbChange.changed_at,
    changeType,
    annualImpact: (newPrice - oldPrice) * 12,
    percentChange: oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : 0,
  }
}

const FLAGGABLE_CATEGORIES = ['ai_tools', 'entertainment', 'productivity', 'design', 'music']

const BUNDLE_SUGGESTIONS: Record<string, string> = {
  ai_tools: 'one AI subscription',
  entertainment: 'a streaming bundle',
  productivity: 'a single productivity suite',
  design: 'one design tool',
  music: 'one music service',
}

function buildConsolidationSuggestions(subscriptions: any[]): ConsolidationSuggestion[] {
  const byCategory: Record<string, any[]> = {}

  for (const sub of subscriptions) {
    const cat = sub.category
    if (!cat || !FLAGGABLE_CATEGORIES.includes(cat)) continue
    ;(byCategory[cat] ??= []).push(sub)
  }

  return Object.entries(byCategory)
    .filter(([, group]) => group.length >= 2)
    .map(([category, group]) => {
      const total = group.reduce((sum: number, s: any) => sum + s.price, 0)
      const cheapest = Math.min(...group.map((s: any) => s.price))
      return {
        id: `consolidation_${category}`,
        category: category.replace('_', ' '),
        services: group.map((s: any) => s.name),
        suggestedBundle: BUNDLE_SUGGESTIONS[category] ?? 'a single plan',
        savings: (total - cheapest).toFixed(2),
      }
    })
}

export async function getInitialData(): Promise<InitialDataResult> {
  const warnings: DataLoadWarning[] = []

  let supabase: Awaited<ReturnType<typeof createClient>>
  let user: { id: string } | null = null

  try {
    supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      console.error('[dashboard] auth.getUser failed', {
        component: 'getInitialData',
        query: 'auth',
        code: error.status,
        message: error.message,
      })
    }
    user = data?.user ?? null
  } catch (error) {
    console.error('[dashboard] supabase client init failed', {
      component: 'getInitialData',
      query: 'auth',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  if (!user) {
    return {
      subscriptions: [],
      emailAccounts: [],
      payments: [],
      priceChanges: [],
      consolidationSuggestions: [],
      analyticsSummary: null,
      warnings: [],
      isDemo: true,
    }
  }

  const [subscriptionsResult, emailAccountsResult, paymentsResult] =
    await Promise.allSettled([
      supabase!
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('date_added', { ascending: false }),
      supabase!.from('email_accounts').select('*').eq('user_id', user.id),
      supabase!
        .from('payments')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ])

  let subscriptions: any[]
  if (
    subscriptionsResult.status === 'fulfilled' &&
    !subscriptionsResult.value.error &&
    subscriptionsResult.value.data
  ) {
    subscriptions = subscriptionsResult.value.data.map(transformSubscription)
  } else {
    const reason =
      subscriptionsResult.status === 'rejected'
        ? subscriptionsResult.reason
        : subscriptionsResult.value.error
    warnings.push(buildQueryWarning('subscriptions', reason))
    subscriptions = []
  }

  let emailAccounts: any[]
  if (
    emailAccountsResult.status === 'fulfilled' &&
    !emailAccountsResult.value.error &&
    emailAccountsResult.value.data
  ) {
    emailAccounts = emailAccountsResult.value.data
  } else {
    const reason =
      emailAccountsResult.status === 'rejected'
        ? emailAccountsResult.reason
        : emailAccountsResult.value.error
    warnings.push(buildQueryWarning('email_accounts', reason))
    emailAccounts = []
  }

  let payments: any[]
  if (
    paymentsResult.status === 'fulfilled' &&
    !paymentsResult.value.error &&
    paymentsResult.value.data
  ) {
    payments = paymentsResult.value.data
  } else {
    const reason =
      paymentsResult.status === 'rejected'
        ? paymentsResult.reason
        : paymentsResult.value.error
    warnings.push(buildQueryWarning('payments', reason))
    payments = []
  }

  const subscriptionsById = new Map<number, any>(
    subscriptions.map((sub: any) => [sub.id, sub]),
  )

  const priceHistoryResult = await supabase!
    .from('subscription_price_history')
    .select('id,subscription_id,old_price,new_price,changed_at')
    .eq('user_id', user.id)
    .order('changed_at', { ascending: false })

  let priceChanges: InitialPriceChange[]
  if (priceHistoryResult.error) {
    warnings.push(buildQueryWarning('price_history', priceHistoryResult.error))
    priceChanges = []
  } else {
    priceChanges = (priceHistoryResult.data ?? []).map((change: any) =>
      normalizePriceChange(change, subscriptionsById),
    )
  }

  let consolidationSuggestions: ConsolidationSuggestion[]
  try {
    const raw = await fetchConsolidationSuggestions(user.id)
    consolidationSuggestions = await filterDismissedSuggestions(user.id, raw)
  } catch (err) {
    warnings.push(buildQueryWarning('consolidation_suggestions', err))
    consolidationSuggestions = []
  }

  return {
    subscriptions,
    emailAccounts,
    payments,
    priceChanges,
    consolidationSuggestions: buildConsolidationSuggestions(subscriptions),
    analyticsSummary: await getAnalyticsSummary(user.id).catch(() => null),
    warnings,
    isDemo: false,
  }
}
