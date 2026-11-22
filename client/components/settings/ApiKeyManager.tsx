"use client"

import { useCallback, useEffect, useState } from "react"

type ApiKey = {
  id: string
  service_name: string
  scopes: string[]
  revoked: boolean
  created_at: string
  last_used_at: string | null
  request_count: number
}

const AVAILABLE_SCOPES = [
  { value: "subscriptions:read", label: "Read subscriptions" },
  { value: "subscriptions:write", label: "Manage subscriptions" },
  { value: "webhooks:write", label: "Manage webhooks" },
  { value: "analytics:read", label: "Read analytics" },
]

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || "Request failed")
  return payload as T
}

export function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<string[]>(["subscriptions:read"])
  const [secret, setSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadKeys = useCallback(async () => {
    try {
      const result = await apiRequest<{ data: ApiKey[] }>("/api/keys")
      setKeys(result.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load API keys")
    }
  }, [])

  useEffect(() => { void loadKeys() }, [loadKeys])

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(null); setNotice(null); setSecret(null)
    try {
      const result = await apiRequest<{ key: string }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), scopes }),
      })
      setSecret(result.key)
      setName("")
      setNotice("API key created. Copy it now; the secret is only shown once.")
      await loadKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create API key")
    } finally { setBusy(false) }
  }

  async function rotateKey(id: string) {
    if (!window.confirm("Rotate this key? The current key will stop working immediately.")) return
    setBusy(true); setError(null); setNotice(null); setSecret(null)
    try {
      const result = await apiRequest<{ key: string }>(`/api/keys/${id}/rotate`, { method: "POST" })
      setSecret(result.key)
      setNotice("Replacement key created. Copy it now; the secret is only shown once.")
      await loadKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rotate API key")
    } finally { setBusy(false) }
  }

  async function revokeKey(id: string) {
    if (!window.confirm("Revoke this key? Requests using it will be rejected.")) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await apiRequest(`/api/keys/${id}`, { method: "DELETE" })
      setNotice("API key revoked.")
      await loadKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to revoke API key")
    } finally { setBusy(false) }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Create an API key</h2>
        <p className="mt-1 text-sm text-gray-600">Give each integration only the permissions it needs. The secret is displayed once.</p>
        <form onSubmit={createKey} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Key name
            <input required maxLength={80} value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Production billing integration"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </label>
          <fieldset>
            <legend className="text-sm font-medium text-gray-700">Permissions</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {AVAILABLE_SCOPES.map(scope => (
                <label key={scope.value} className="flex items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
                  <input type="checkbox" checked={scopes.includes(scope.value)}
                    onChange={e => setScopes(current => e.target.checked
                      ? [...current, scope.value] : current.filter(value => value !== scope.value))}
                    className="h-4 w-4 rounded border-gray-300" />
                  {scope.label}
                </label>
              ))}
            </div>
          </fieldset>
          <button disabled={busy || !name.trim() || scopes.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Working…" : "Create API key"}
          </button>
        </form>
      </div>

      {secret && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h3 className="font-semibold text-amber-950">Copy your API key now</h3>
          <p className="mt-1 text-sm text-amber-900">For security, this secret cannot be viewed again after you close this message.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-amber-200 bg-white p-3 text-sm text-gray-900">{secret}</code>
            <button onClick={() => void navigator.clipboard.writeText(secret)}
              className="rounded-lg border border-amber-400 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100">Copy key</button>
          </div>
          <button onClick={() => setSecret(null)} className="mt-3 text-sm font-medium text-amber-900 underline">I have saved the key</button>
        </div>
      )}

      {notice && <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Your API keys</h2>
          <p className="mt-1 text-sm text-gray-600">Review permissions and usage, rotate exposed credentials, or revoke unused keys.</p>
        </div>
        {keys.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">No API keys yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {keys.map(key => (
              <li key={key.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-gray-900">{key.service_name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${key.revoked ? "bg-gray-100 text-gray-600" : "bg-green-100 text-green-800"}`}>
                        {key.revoked ? "Revoked" : "Active"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Created {new Date(key.created_at).toLocaleString()}</p>
                    <p className="text-xs text-gray-500">Last used: {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "Never"} · {key.request_count ?? 0} requests</p>
                  </div>
                  {!key.revoked && (
                    <div className="flex shrink-0 gap-2">
                      <button disabled={busy} onClick={() => void rotateKey(key.id)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Rotate</button>
                      <button disabled={busy} onClick={() => void revokeKey(key.id)}
                        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Revoke</button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(key.scopes || []).map(scope => <span key={scope} className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-800">{scope}</span>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
