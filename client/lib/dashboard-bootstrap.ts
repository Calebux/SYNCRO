export type DataLoadWarning = {
  query: 'subscriptions' | 'email_accounts' | 'payments' | 'price_history' | 'consolidation_suggestions'
  message: string
  code?: string
}

type QueryError = {
  message?: string
  code?: string
  status?: number | string
} | null

const USER_MESSAGES: Record<DataLoadWarning['query'], string> = {
  subscriptions: 'Could not load subscriptions. Showing cached data.',
  email_accounts: 'Could not load email accounts.',
  payments: 'Could not load payment history.',
  price_history: 'Could not load price change history.',
  consolidation_suggestions: 'Could not load consolidation suggestions.',
}

/**
 * Converts a Supabase query error or rejected Promise reason into a structured
 * DataLoadWarning and emits a tagged log entry for monitoring.
 */
export function buildQueryWarning(
  query: DataLoadWarning['query'],
  reason: QueryError | unknown,
): DataLoadWarning {
  const err = reason as QueryError
  const code = String(err?.code ?? err?.status ?? 'unknown')
  const message = err?.message ?? String(reason)

  console.error(`[dashboard] ${query} query failed`, {
    component: 'getInitialData',
    query,
    code,
    message,
  })

  return { query, message: USER_MESSAGES[query], code }
}
