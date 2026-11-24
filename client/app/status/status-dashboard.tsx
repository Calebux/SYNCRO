'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { API_BASE } from '@/lib/api-base'

type ComponentStatus = 'operational' | 'degraded' | 'major_outage' | 'unknown'

interface StatusComponent {
  id: string
  name: string
  status: ComponentStatus
  metrics: Record<string, number | null>
}

interface IncidentUpdate {
  id: string
  status: string
  message: string
  created_at: string
}

interface StatusIncident {
  id: string
  title: string
  impact: string
  status: string
  created_at: string
  updates: IncidentUpdate[]
}

interface StatusSnapshot {
  status: ComponentStatus
  components: StatusComponent[]
  incidents: StatusIncident[]
  updated_at: string
}

const STATUS_LABELS: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  major_outage: 'Major outage',
  unknown: 'Awaiting metrics',
}

const STATUS_STYLES: Record<ComponentStatus, string> = {
  operational: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  degraded: 'bg-amber-50 text-amber-900 ring-amber-200',
  major_outage: 'bg-red-50 text-red-800 ring-red-200',
  unknown: 'bg-slate-100 text-slate-700 ring-slate-200',
}

function formatMetric(name: string, value: number | null): string {
  if (value === null) return 'Collecting data'
  if (name.endsWith('_pct')) return `${value.toFixed(2)}%`
  if (name.endsWith('_hours')) return `${value.toFixed(2)} hours`
  if (name === 'latest_ledger') return value.toLocaleString()
  return value.toLocaleString()
}

function formatLabel(name: string): string {
  return name
    .replace(/_pct$/, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function StatusDashboard() {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null)
  const [loadError, setLoadError] = useState('')
  const [email, setEmail] = useState('')
  const [subscriptionMessage, setSubscriptionMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${API_BASE}/api/status`, {
        cache: 'no-store',
        signal,
      })
      if (!response.ok) throw new Error('Status data is temporarily unavailable.')
      const data = (await response.json()) as StatusSnapshot
      setSnapshot(data)
      setLoadError('')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setLoadError(error instanceof Error ? error.message : 'Status data is temporarily unavailable.')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [refresh])

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setSubscriptionMessage('')
    try {
      const response = await fetch(`${API_BASE}/api/status/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = (await response.json()) as { message?: string; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Unable to subscribe right now.')
      setEmail('')
      setSubscriptionMessage(body.message ?? 'Check your email to confirm the subscription.')
    } catch (error) {
      setSubscriptionMessage(error instanceof Error ? error.message : 'Unable to subscribe right now.')
    } finally {
      setSubmitting(false)
    }
  }

  const overallStatus = snapshot?.status ?? 'unknown'

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">SYNCRO</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">System status</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Live service health and incident updates for the gateway, settlement, and Stellar network connection.
          </p>
        </header>

        <section
          aria-live="polite"
          className={`mb-7 flex flex-wrap items-center justify-between gap-3 rounded-xl px-5 py-4 ring-1 ${STATUS_STYLES[overallStatus]}`}
        >
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-3 w-3 rounded-full bg-current" />
            <h2 className="text-lg font-semibold">
              {snapshot ? STATUS_LABELS[overallStatus] : 'Loading current status'}
            </h2>
          </div>
          <p className="text-sm">
            {snapshot ? `Last updated ${formatDate(snapshot.updated_at)}` : 'Connecting to status metrics…'}
          </p>
        </section>

        {loadError && (
          <p role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {loadError} {snapshot ? 'Showing the last successful update.' : ''}
          </p>
        )}

        <section aria-labelledby="components-title" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="components-title" className="text-xl font-semibold">Services</h2>
            <span className="text-xs text-slate-500">Automatically refreshed every 30 seconds</span>
          </div>
          <div className="divide-y divide-slate-100">
            {(snapshot?.components ?? [
              { id: 'gateway', name: 'Gateway', status: 'unknown' as const, metrics: {} },
              { id: 'settlement', name: 'Settlement', status: 'unknown' as const, metrics: {} },
              { id: 'soroban_rpc', name: 'Soroban RPC', status: 'unknown' as const, metrics: {} },
            ]).map((component) => (
              <article key={component.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-medium">{component.name}</h3>
                  <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                    {Object.entries(component.metrics).map(([name, value]) => (
                      <div key={name} className="flex gap-1">
                        <dt>{formatLabel(name)}:</dt>
                        <dd className="font-medium text-slate-800">{formatMetric(name, value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <span className={`w-fit rounded-full px-3 py-1 text-sm font-medium ring-1 ${STATUS_STYLES[component.status]}`}>
                  {STATUS_LABELS[component.status]}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="incidents-title" className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 id="incidents-title" className="text-xl font-semibold">Incident history</h2>
          {snapshot && snapshot.incidents.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No incidents reported in the past 30 days.</p>
          ) : (
            <ol className="mt-4 space-y-5">
              {(snapshot?.incidents ?? []).map((incident) => (
                <li key={incident.id} className="border-l-2 border-slate-200 pl-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{incident.title}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-700">
                      {incident.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs capitalize text-slate-500">
                    {incident.impact} impact · Started {formatDate(incident.created_at)}
                  </p>
                  <ol className="mt-3 space-y-3">
                    {incident.updates.map((update) => (
                      <li key={update.id}>
                        <p className="text-sm font-medium capitalize">{update.status.replaceAll('_', ' ')}</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{update.message}</p>
                        <time className="mt-1 block text-xs text-slate-500" dateTime={update.created_at}>
                          {formatDate(update.created_at)}
                        </time>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="subscribe-title" className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 id="subscribe-title" className="text-xl font-semibold">Get incident updates</h2>
          <p className="mt-1 text-sm text-slate-600">
            Confirm your email to receive incident announcements and resolution updates. You can unsubscribe at any time.
          </p>
          <form onSubmit={subscribe} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label htmlFor="status-email" className="sr-only">Email address</label>
            <input
              id="status-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Subscribe'}
            </button>
          </form>
          {subscriptionMessage && (
            <p role="status" className="mt-3 text-sm text-slate-700">{subscriptionMessage}</p>
          )}
        </section>
      </div>
    </main>
  )
}
