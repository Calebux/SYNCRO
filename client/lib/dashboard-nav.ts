export const dashboardNav = [
  { href: '/dashboard', label: 'Overview', id: 'overview' },
  { href: '/dashboard/playground', label: 'Playground', id: 'playground' },
] as const;

export type DashboardNavId = (typeof dashboardNav)[number]['id'];
