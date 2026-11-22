import Link from 'next/link';
import { MonthlyStatementPanel } from '@/components/statements/MonthlyStatementPanel';

export default function MonthlyStatementsPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f4] px-4 py-8 text-[#17211b] md:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              v3 Finance &amp; Accounting
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Monthly Statements
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Downloadable CSV and printable HTML/PDF monthly statements for principals (spend per agent) and providers (earnings per route), linked to on-chain Stellar settlements.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
          >
            Back to overview
          </Link>
        </header>

        <MonthlyStatementPanel role="principal" defaultMonth="2026-10" allowRoleSwitch />
      </div>
    </main>
  );
}
