import { Skeleton } from "@/components/ui/skeleton"

export default function AnalyticsLoading() {
  return (
    <div className="p-4 sm:p-8 space-y-8">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        <Skeleton className="h-64 sm:h-80 w-full rounded-xl" />
        <Skeleton className="h-64 sm:h-80 w-full rounded-xl" />
      </div>
      {/* Top subscriptions */}
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}
