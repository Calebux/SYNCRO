'use client';

import Link from 'next/link';
import { dashboardNav, type DashboardNavId } from '@/lib/dashboard-nav';

export function DashboardNav({ current }: { current: DashboardNavId }) {
  return (
    <nav aria-label="Dashboard" className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
      {dashboardNav.map((item) => {
        const active = item.id === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={active
              ? 'text-gray-950 underline underline-offset-4'
              : 'text-emerald-700 hover:text-emerald-900'}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
