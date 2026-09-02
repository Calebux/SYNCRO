/**
 * Home page — server component.
 */

import { Suspense } from 'react'
import { getInitialData } from './page-data'
import { AppClient } from '@/components/app/app-client'
import { LoadingSpinner } from "@syncro/ui"

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const initialData = await getInitialData()

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F9F6F2] dark:bg-[#1E2A35] flex items-center justify-center">
          <LoadingSpinner size="lg" darkMode={false} />
        </div>
      }
    >
      <AppClient
        initialSubscriptions={initialData.subscriptions}
        initialEmailAccounts={initialData.emailAccounts}
        initialPayments={initialData.payments}
        initialPriceChanges={initialData.priceChanges}
        initialConsolidationSuggestions={initialData.consolidationSuggestions}
        initialAnalyticsSummary={initialData.analyticsSummary}
        dataLoadWarnings={initialData.warnings}
        isDemo={initialData.isDemo}
      />
    </Suspense>
  )
}
