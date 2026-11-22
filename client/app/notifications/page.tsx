import Link from 'next/link';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';

export default function NotificationsPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f4] px-4 py-8 text-[#17211b] md:px-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              v3 Operations &amp; Alerts
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Notification Center
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Unified real-time feed and per-type delivery preferences (in-app, email, webhook) for spend caps, channel disputes, payouts, and agent revocations.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
          >
            Back to overview
          </Link>
        </header>

        <NotificationCenter />
      </div>
    </main>
  );
}
