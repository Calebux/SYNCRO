import type { Metadata } from 'next'
import StatusDashboard from './status-dashboard'

export const metadata: Metadata = {
  title: 'SYNCRO Status',
  description: 'Live status for the SYNCRO gateway, settlement, and Soroban RPC.',
}

export default function StatusPage() {
  return <StatusDashboard />
}
