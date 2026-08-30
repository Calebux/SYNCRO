'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchUserPreferences, updateUserPreferences } from '@/lib/api/user-preferences';
import { GIFT_CARD_PROVIDERS, DEFAULT_GIFT_CARD_PROVIDER_ID } from '@/lib/gift-card-providers';
import { useUserSettings } from '@/components/providers/user-settings-provider';
import { generateStealthMetaAddress, isValidStealthMetaAddress } from '@syncro/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ─── Types ────────────────────────────────────────────────────────────────────

type ExportStatus = 'idle' | 'pending' | 'ready' | 'error';
type DeleteStatus = 'idle' | 'scheduled' | 'error';
type JitterLevel = 'off' | 'low' | 'medium' | 'high';

interface JobState {
  jobId: string | null;
  status: ExportStatus;
  downloadUrl: string | null;
  error: string | null;
  /** ISO timestamp of last poll */
  lastChecked: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 40; // 2 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function startExportJob(): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE}/api/compliance/export`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Export request failed (${res.status})`);
  const json = await res.json().catch(() => ({}));
  // If the backend returns a blob directly (legacy), handle it inline
  if (res.headers.get('content-type')?.includes('application/zip')) {
    const blob = await res.blob();
    triggerDownload(blob, 'syncro-data-export.zip');
    return { jobId: '__direct__' };
  }
  return { jobId: json.jobId ?? json.job_id ?? '__direct__' };
}

async function pollExportJob(jobId: string): Promise<{ status: string; downloadUrl?: string }> {
  const res = await fetch(`${API_BASE}/api/compliance/export/${jobId}/status`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json();
}

async function downloadExport(downloadUrl: string): Promise<void> {
  const res = await fetch(downloadUrl, { credentials: 'include' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  triggerDownload(blob, 'syncro-data-export.zip');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function fetchUserPreferences(): Promise<{ reminder_jitter_level?: JitterLevel }> {
  const res = await fetch(`${API_BASE}/api/user-preferences`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch user preferences');
  const json = await res.json();
  return json.data;
}

async function updateUserPreferences(updates: { reminder_jitter_level?: JitterLevel; [key: string]: any }): Promise<void> {
  const res = await fetch(`${API_BASE}/api/user-preferences`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update user preferences');
}

async function fetchPrivacyPreferences(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/privacy-preferences`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch privacy preferences');
  const json = await res.json();
  return json.data;
}

async function updatePrivacyPreferences(updates: any): Promise<void> {
  const res = await fetch(`${API_BASE}/api/privacy-preferences`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update privacy preferences');
}
async function fetchSubscriptionEncryptionSummary(): Promise<{ total: number; encrypted: number; unencrypted: number }> {
  const res = await fetch(`${API_BASE}/api/subscriptions/encryption-summary`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch subscription encryption summary');
  const json = await res.json();
  return json.data;
}

async function encryptAllSubscriptions(): Promise<{ encryptedCount: number }> {
  const res = await fetch(`${API_BASE}/api/subscriptions/encrypt-all`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('Failed to encrypt subscriptions');
  const json = await res.json();
  return json.data;
}
// ─── Component ────────────────────────────────────────────────────────────────

export default function DataPrivacyPage() {
  const { settings, updateSettings } = useUserSettings();
  const [isPrivacyModeChanging, setIsPrivacyModeChanging] = useState(false);
  // ── Export state ──────────────────────────────────────────────────────────
  const [exportJob, setExportJob] = useState<JobState>({
    jobId: null,
    status: 'idle',
    downloadUrl: null,
    error: null,
    lastChecked: null,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef(0);

  // ── Delete state ──────────────────────────────────────────────────────────
  const [deleteStatus, setDeleteStatus] = useState<DeleteStatus>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Gift card provider state
  const [giftCardProviderId, setGiftCardProviderId] = useState(DEFAULT_GIFT_CARD_PROVIDER_ID);
  const [giftCardProviderLoading, setGiftCardProviderLoading] = useState(true);
  const [giftCardProviderSaving, setGiftCardProviderSaving] = useState(false);
  const [giftCardProviderError, setGiftCardProviderError] = useState<string | null>(null);

  // ── Jitter state ──────────────────────────────────────────────────────────
  const [jitterLevel, setJitterLevel] = useState<JitterLevel>('off');
  const [jitterLoading, setJitterLoading] = useState(false);
  const [jitterError, setJitterError] = useState<string | null>(null);
  const [stealthMetaAddress, setStealthMetaAddress] = useState('');
  const [stealthStatus, setStealthStatus] = useState<string | null>(null);
  const [stealthLoading, setStealthLoading] = useState(false);

  // ── Privacy preferences state ─────────────────────────────────────────────
  const [privacyPrefs, setPrivacyPrefs] = useState({
    stealthAddressesEnabled: false,
    encryptionEnabled: false,
    paymentChannelsEnabled: false,
    privateAuditLogsEnabled: false,
    preferredGiftCardProvider: 'paypal',
  });
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [encryptionSummary, setEncryptionSummary] = useState<{
    total: number;
    encrypted: number;
    unencrypted: number;
  } | null>(null);
  const [encryptionLoading, setEncryptionLoading] = useState(false);
  const [encryptionError, setEncryptionError] = useState<string | null>(null);
  const [encryptionMessage, setEncryptionMessage] = useState<string | null>(null);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Load preferences ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchUserPreferences()
      .then((prefs) => {
        if (!cancelled) {
          if (prefs.preferred_gift_card_provider) {
            setGiftCardProviderId(prefs.preferred_gift_card_provider);
          }
          if (prefs.reminder_jitter_level) {
            setJitterLevel(prefs.reminder_jitter_level);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setGiftCardProviderError(err instanceof Error ? err.message : 'Failed to load preferences');
        }
      })
      .finally(() => {
        if (!cancelled) setGiftCardProviderLoading(false);
      });

    // Load privacy preferences
    fetchPrivacyPreferences()
      .then(prefs => {
        if (!cancelled && prefs) {
          setPrivacyPrefs(prefs);
        }
      })
      .catch(err => console.error('Failed to load privacy preferences:', err));

    fetchSubscriptionEncryptionSummary()
      .then(summary => {
        if (!cancelled) {
          setEncryptionSummary(summary);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setEncryptionError(err instanceof Error ? err.message : 'Failed to load encryption summary');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleGiftCardProviderChange = async (providerId: string) => {
    const previous = giftCardProviderId;
    setGiftCardProviderId(providerId);
    setGiftCardProviderSaving(true);
    setGiftCardProviderError(null);
    try {
      await updateUserPreferences({ preferred_gift_card_provider: providerId });
    } catch (err) {
      setGiftCardProviderId(previous);
      setGiftCardProviderError(err instanceof Error ? err.message : 'Failed to save provider');
    } finally {
      setGiftCardProviderSaving(false);
    }
  };

  // ── Handle jitter change ──────────────────────────────────────────────────
  const handleJitterChange = async (newLevel: JitterLevel) => {
    setJitterLoading(true);
    setJitterError(null);
    try {
      await updateUserPreferences({ reminder_jitter_level: newLevel });
      setJitterLevel(newLevel);
    } catch (err) {
      setJitterError(err instanceof Error ? err.message : 'Failed to update preference');
    } finally {
      setJitterLoading(false);
    }
  };

  const handleGenerateStealthAddress = () => {
    const generated = generateStealthMetaAddress();
    setStealthMetaAddress(generated.encoded);
    setStealthStatus('Generated a new versioned stealth meta-address. Save it to register it.');
  };

  const handleRegisterStealthAddress = async () => {
    if (!isValidStealthMetaAddress(stealthMetaAddress)) {
      setStealthStatus('Enter a valid versioned stealth meta-address before saving.');
      return;
    }

    setStealthLoading(true);
    setStealthStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/user/stealth-meta-address`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stealthMetaAddress: stealthMetaAddress.trim() }),
      });
      if (!res.ok) throw new Error('Failed to register stealth meta-address');
      setStealthStatus('Stealth meta-address saved and protected by your account access rules.');
    } catch (err) {
      setStealthStatus(err instanceof Error ? err.message : 'Failed to register stealth meta-address.');
    } finally {
      setStealthLoading(false);
    }
  };

  // ── Export polling ────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollAttemptsRef.current = 0;
  }, []);

  const checkJobStatus = useCallback(
    async (jobId: string) => {
      pollAttemptsRef.current += 1;

      if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
        stopPolling();
        setExportJob((prev) => ({
          ...prev,
          status: 'error',
          error: 'Export is taking too long. Please try again.',
        }));
        return;
      }

      try {
        const result = await pollExportJob(jobId);
        const now = new Date().toISOString();

        if (result.status === 'ready' || result.status === 'completed') {
          stopPolling();
          if (result.downloadUrl) {
            await downloadExport(result.downloadUrl);
          }
          setExportJob((prev) => ({
            ...prev,
            status: 'ready',
            downloadUrl: result.downloadUrl ?? null,
            lastChecked: now,
          }));
        } else if (result.status === 'failed' || result.status === 'error') {
          stopPolling();
          setExportJob((prev) => ({
            ...prev,
            status: 'error',
            error: 'Export failed on the server. Please try again.',
            lastChecked: now,
          }));
        } else {
          // still pending
          setExportJob((prev) => ({ ...prev, lastChecked: now }));
        }
      } catch (err) {
        stopPolling();
        setExportJob((prev) => ({
          ...prev,
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to check export status.',
        }));
      }
    },
    [stopPolling],
  );

  const handleExport = async () => {
    stopPolling();
    setExportJob({ jobId: null, status: 'pending', downloadUrl: null, error: null, lastChecked: null });

    try {
      const { jobId } = await startExportJob();

      // Direct download (legacy backend) — already triggered inside startExportJob
      if (jobId === '__direct__') {
        setExportJob({ jobId: null, status: 'ready', downloadUrl: null, error: null, lastChecked: new Date().toISOString() });
        return;
      }

      setExportJob((prev) => ({ ...prev, jobId }));
      pollAttemptsRef.current = 0;

      // Kick off polling
      pollRef.current = setInterval(() => {
        checkJobStatus(jobId);
      }, POLL_INTERVAL_MS);

      // Also check immediately
      await checkJobStatus(jobId);
    } catch (err) {
      setExportJob({
        jobId: null,
        status: 'error',
        downloadUrl: null,
        error: err instanceof Error ? err.message : 'Export request failed.',
        lastChecked: null,
      });
    }
  };

  const retryExport = () => handleExport();

  // ── Delete ────────────────────────────────────────────────────────────────
  const openModal = () => {
    setReason('');
    setConfirmed(false);
    setDeleteError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (deleting) return; // prevent accidental close mid-request
    setModalOpen(false);
  };

  const handleDelete = async () => {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`${API_BASE}/api/compliance/account/delete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setDeleteStatus('scheduled');
      setModalOpen(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete request failed. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  // ── Derived UI state ──────────────────────────────────────────────────────
  const exportIsBusy = exportJob.status === 'pending';
  const exportLabel = exportIsBusy ? 'Preparing export…' : 'Download Export (ZIP)';

  const jitterOptions: { value: JitterLevel; label: string; description: string }[] = [
    { value: 'off', label: 'Off', description: 'No jitter — reminders sent exactly on schedule' },
    { value: 'low', label: 'Low', description: '± 2 hours' },
    { value: 'medium', label: 'Medium', description: '± 6 hours' },
    { value: 'high', label: 'High', description: '± 12 hours' },
  ];

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Back link */}
        <Link
          href="/settings/security"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8 transition-colors"
        >
          <svg aria-hidden="true" className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Security Settings
        </Link>

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Data &amp; Privacy</h1>
        <p className="text-sm text-gray-500 mb-8">Manage your personal data and privacy preferences.</p>

        {/* ── Privacy Score Card ────────────────────────────────────────────── */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Privacy Score</h3>
              <p className="text-xs text-gray-600">How many privacy features you've enabled</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-indigo-600">{privacyScore.current}/{privacyScore.max}</div>
              <div className="w-32 h-2 bg-gray-200 rounded-full mt-2">
                <div
                  className="h-full bg-indigo-600 rounded-full transition-all"
                  style={{ width: `${(privacyScore.current / privacyScore.max) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
          {/* ── Section 1: Privacy Mode ─────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6" aria-labelledby="privacy-mode-heading">
            <h2 id="privacy-mode-heading" className="text-base font-semibold text-gray-900 mb-1">Privacy Mode</h2>
            <p className="text-sm text-gray-500 mb-4">
              When enabled, your subscription metadata (names, prices, categories) will be encrypted client-side before being stored in our database. Only you have the encryption key to decrypt and view your data.
            </p>
            <div className="flex items-center justify-between">
              <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.privacyModeEnabled}
                  onChange={async (e) => {
                    setIsPrivacyModeChanging(true);
                    try {
                      await updateSettings({ privacyModeEnabled: e.target.checked });
                    } finally {
                      setIsPrivacyModeChanging(false);
                    }
                  }}
                  disabled={isPrivacyModeChanging}
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-gray-700">Enable Privacy Mode</span>
              </label>
              {encryptionSummary && (
                <p className="text-sm text-gray-500 mt-2">
                  {encryptionSummary.encrypted} of {encryptionSummary.total} subscriptions encrypted.
                </p>
              )}
              </div>
              {settings.encryptionKey && (
                <div className="text-right">
                  <p className="text-xs text-gray-400 mb-1">Encryption Key:</p>
                  <p className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">
                    {settings.encryptionKey.slice(0, 16)}...
                  </p>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {encryptionMessage && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
                  {encryptionMessage}
                </div>
              )}
              {encryptionError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {encryptionError}
                </div>
              )}
              <button
                type="button"
                onClick={async () => {
                  setEncryptionError(null);
                  setEncryptionMessage(null);
                  setEncryptionLoading(true);
                  try {
                    const data = await encryptAllSubscriptions();
                    setEncryptionMessage(`Encrypted ${data.encryptedCount} subscription${data.encryptedCount === 1 ? '' : 's'}.`);
                    setEncryptionSummary((prev) =>
                      prev
                        ? {
                            ...prev,
                            encrypted: prev.encrypted + data.encryptedCount,
                            unencrypted: Math.max(0, prev.unencrypted - data.encryptedCount),
                          }
                        : null,
                    );
                  } catch (err) {
                    setEncryptionError(err instanceof Error ? err.message : 'Failed to encrypt subscriptions');
                  } finally {
                    setEncryptionLoading(false);
                  }
                }}
                disabled={encryptionLoading || encryptionSummary?.unencrypted === 0}
                className="w-full inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {encryptionLoading ? 'Encrypting…' : 'Encrypt all unencrypted subscriptions'}
              </button>
            </div>
          </section>

          {/* ── Section: Stealth Meta-address ───────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6" aria-labelledby="stealth-heading">
            <h2 id="stealth-heading" className="text-base font-semibold text-gray-900 mb-1">Stealth Meta-address</h2>
            <p className="text-sm text-gray-500 mb-4">
              Register a versioned stealth meta-address to support privacy-preserving payments and recipient discovery. The format is versioned as <span className="font-mono">syncro:stealth:v1:&lt;spend_pubkey&gt;:&lt;view_pubkey&gt;</span>.
            </p>

            <div className="space-y-3">
              <label htmlFor="stealth-meta-address" className="block text-sm font-medium text-gray-700">
                Meta-address
              </label>
              <textarea
                id="stealth-meta-address"
                value={stealthMetaAddress}
                onChange={(e) => setStealthMetaAddress(e.target.value)}
                rows={3}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="syncro:stealth:v1:64hex:64hex"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleGenerateStealthAddress}
                  className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Generate
                </button>
                <button
                  type="button"
                  onClick={handleRegisterStealthAddress}
                  disabled={stealthLoading}
                  className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {stealthLoading ? 'Saving…' : 'Save'}
                </button>
              </div>
              {stealthStatus && (
                <p className="text-sm text-gray-600">{stealthStatus}</p>
              )}
            </div>
          </section>

          {/* ── Section: Stealth Payment Recovery ────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6" aria-labelledby="recovery-heading">
            <h2 id="recovery-heading" className="text-base font-semibold text-gray-900 mb-1">Stealth Payment Recovery</h2>
            <p className="text-sm text-gray-500 mb-4">
              Reconstruct your full stealth payment history directly from the Stellar ledger using your viewing key. This process scans for all payments to your stealth addresses and may take several minutes.
            </p>
            <Link
              href="/settings/privacy/recovery"
              className="inline-flex px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Start Recovery Scan
            </Link>
          </section>

          {/* ── Section: Reminder Jitter ────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6" aria-labelledby="jitter-heading">
            <h2 id="jitter-heading" className="text-base font-semibold text-gray-900 mb-1">Reminder Timing Jitter</h2>
            <p className="text-sm text-gray-500 mb-4">
              Add random jitter to subscription renewal reminders to prevent network observers from correlating reminders with gift card purchases.
            </p>

            {jitterError && (
              <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
                {jitterError}
              </div>
            )}

            <div className="space-y-3">
              {jitterOptions.map(option => (
                <label key={option.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="jitter"
                    value={option.value}
                    checked={jitterLevel === option.value}
                    onChange={() => handleJitterChange(option.value)}
                    disabled={jitterLoading}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{option.label}</div>
                    <div className="text-xs text-gray-500">{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* ── Section: Export ─────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6" aria-labelledby="export-heading">
            <h2 id="export-heading" className="text-base font-semibold text-gray-900 mb-1">Export Your Data</h2>
            <p className="text-sm text-gray-500 mb-4">
              Download a copy of all the data Syncro holds about your account, including subscriptions, billing
              history, and profile information.
            </p>

            {/* Job status banner */}
            {exportJob.status === 'pending' && (
              <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 mb-4">
                <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="currentColor" strokeWidth={2}>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Preparing your export — this may take a minute…
              </div>
            )}

            {exportJob.status === 'ready' && (
              <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Your export is ready — download started automatically.
              </div>
            )}

            {exportJob.status === 'error' && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span>
                  {exportJob.error}{' '}
                  <button
                    onClick={retryExport}
                    className="underline font-medium hover:no-underline focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
                  >
                    Try again
                  </button>
                </span>
              </div>
            )}

            <button
              onClick={handleExport}
              disabled={exportIsBusy}
              aria-busy={exportIsBusy}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              {exportLabel}
            </button>
          </section>

          {/* ── Section: Email Preferences ─────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6" aria-labelledby="email-prefs-heading">
            <h2 id="email-prefs-heading" className="text-base font-semibold text-gray-900 mb-1">Email Preferences</h2>
            <p className="text-sm text-gray-500 mb-4">
              Control which emails Syncro sends you, including renewal reminders, digests, and marketing
              communications.
            </p>
            <Link
              href="/email-preferences"
              className="inline-flex px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Manage Email Preferences
            </Link>
          </section>

          {/* Section: Gift Card Provider */}
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Gift Card Purchase Provider</h2>
            <p className="text-sm text-gray-500 mb-4">
              Choose which provider Syncro uses when you buy a crypto-funded gift card to pay for a subscription.
              Providers vary in Tor support, KYC requirements, and accepted cryptocurrencies.
            </p>

            {giftCardProviderError && (
              <p className="text-sm text-red-600 mb-3">{giftCardProviderError}</p>
            )}

            {giftCardProviderLoading ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : (
              <div className="space-y-2">
                {GIFT_CARD_PROVIDERS.map((provider) => (
                  <label
                    key={provider.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      giftCardProviderId === provider.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gift-card-provider"
                      className="mt-1 w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                      checked={giftCardProviderId === provider.id}
                      disabled={giftCardProviderSaving}
                      onChange={() => handleGiftCardProviderChange(provider.id)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">
                        {provider.name}
                        {provider.torSupport && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                            Tor-friendly
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-gray-500 mt-0.5">{provider.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>

          {/* ── Section: Delete Account ─────────────────────────────────── */}
          <section className="bg-white rounded-2xl border border-red-200 shadow-sm p-6" aria-labelledby="delete-heading">
            <h2 id="delete-heading" className="text-base font-semibold text-gray-900 mb-1">Delete Account</h2>
            <p className="text-sm text-gray-500 mb-4">
              Permanently delete your Syncro account. Your data will be removed after a 30-day grace period, during
              which you can cancel this request.
            </p>

            {deleteStatus === 'scheduled' && (
              <div role="status" className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 mb-4 text-sm text-yellow-800">
                Your account deletion has been scheduled. You have 30 days to cancel this request before your data
                is permanently removed.
              </div>
            )}

            <button
              onClick={openModal}
              disabled={deleteStatus === 'scheduled'}
              className="px-4 py-2 text-sm font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Delete Account
            </button>
          </section>

        {/* Footer links */}
        <p className="text-center text-xs text-gray-400 mt-8">
          <Link href="/privacy" className="text-indigo-600 hover:underline">Privacy Policy</Link>
          {' · '}
          <Link href="/terms" className="text-indigo-600 hover:underline">Terms of Service</Link>
        </p>
      </div>

      {/* ── Delete confirmation modal ──────────────────────────────────────── */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 id="delete-dialog-title" className="text-lg font-semibold text-gray-900 mb-2">Delete Account</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will begin a <strong>30-day countdown</strong> before your account and all associated data are
              permanently deleted. All active subscriptions will be cancelled immediately.
            </p>

            {/* Optional reason */}
            <label htmlFor="delete-reason" className="block mb-4">
              <span className="text-sm font-medium text-gray-700">Reason (optional)</span>
              <textarea
                id="delete-reason"
                className="mt-1 block w-full text-sm rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                rows={3}
                placeholder="Tell us why you're leaving…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={deleting}
              />
            </label>

            {/* Explicit confirmation checkbox — required before submit */}
            <label className="flex items-start gap-3 mb-5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={deleting}
                aria-required="true"
              />
              <span className="text-sm text-gray-700">
                I understand this will cancel my subscriptions and permanently delete my data after 30 days.
              </span>
            </label>

            {deleteError && (
              <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
                {deleteError}{' '}
                <button
                  onClick={handleDelete}
                  disabled={!confirmed || deleting}
                  className="underline font-medium hover:no-underline focus:outline-none"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!confirmed || deleting}
                aria-busy={deleting}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                {deleting ? 'Deleting…' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
