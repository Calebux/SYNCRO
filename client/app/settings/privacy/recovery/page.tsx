'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, RotateCcw, AlertCircle, CheckCircle2, Loader } from 'lucide-react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScanProgress {
  stage: 'initializing' | 'scanning_ledger' | 'deriving_addresses' | 'verifying_payments' | 'complete';
  currentIndex: number;
  totalItems: number;
  recoveredPayments: number;
  message: string;
}

interface RecoveredPayment {
  stealthAddress: string;
  ephemeralPubkey: string;
  amount: number;
  ledger: number;
  timestamp: string;
  transactionHash: string;
  source: 'ledger_scan';
}

interface RecoveryState {
  isScanning: boolean;
  progress: ScanProgress | null;
  payments: RecoveredPayment[];
  error: string | null;
  isComplete: boolean;
}

// ─── Progress Stage Display ────────────────────────────────────────────────────

function StageIndicator({ stage, current, total }: { stage: ScanProgress['stage']; current: number; total: number }) {
  const stages: Array<ScanProgress['stage']> = ['initializing', 'scanning_ledger', 'deriving_addresses', 'verifying_payments', 'complete'];
  const stageIndex = stages.indexOf(stage);

  return (
    <div className="space-y-3">
      {stages.map((s, idx) => (
        <div key={s} className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
              idx < stageIndex
                ? 'bg-green-500 text-white'
                : idx === stageIndex
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-600'
            }`}
          >
            {idx < stageIndex ? '✓' : idx === stageIndex ? <Loader className="h-4 w-4 animate-spin" /> : idx + 1}
          </div>
          <div>
            <p className={`text-sm font-medium ${idx <= stageIndex ? 'text-gray-900' : 'text-gray-500'}`}>
              {s === 'initializing' && 'Initializing'}
              {s === 'scanning_ledger' && 'Scanning Ledger'}
              {s === 'deriving_addresses' && 'Deriving Addresses'}
              {s === 'verifying_payments' && 'Verifying Payments'}
              {s === 'complete' && 'Complete'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Recovery Page ────────────────────────────────────────────────────────────

export default function RecoveryPage() {
  const [state, setState] = useState<RecoveryState>({
    isScanning: false,
    progress: null,
    payments: [],
    error: null,
    isComplete: false,
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  // Start recovery scan
  const handleStartRecovery = async () => {
    setState({
      isScanning: true,
      progress: null,
      payments: [],
      error: null,
      isComplete: false,
    });

    try {
      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Open SSE connection
      const eventSource = new EventSource(`${API_BASE}/api/privacy/stealth/recover`, {
        withCredentials: true,
      });

      eventSourceRef.current = eventSource;

      eventSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'progress') {
            setState((prev) => ({
              ...prev,
              progress: {
                stage: data.stage,
                currentIndex: data.currentIndex,
                totalItems: data.totalItems,
                recoveredPayments: data.recoveredPayments,
                message: data.message,
              },
            }));
          } else if (data.type === 'complete') {
            setState((prev) => ({
              ...prev,
              payments: data.payments || [],
              isScanning: false,
              isComplete: true,
              progress: {
                stage: 'complete',
                currentIndex: prev.progress?.totalItems || 0,
                totalItems: prev.progress?.totalItems || 0,
                recoveredPayments: data.count || 0,
                message: `Recovery complete! Recovered ${data.count || 0} payments.`,
              },
            }));
            eventSource.close();
          } else if (data.type === 'error') {
            setState((prev) => ({
              ...prev,
              error: data.error || 'Recovery failed',
              isScanning: false,
            }));
            eventSource.close();
          }
        } catch (err) {
          console.error('Failed to parse SSE message:', err);
        }
      });

      eventSource.addEventListener('error', () => {
        setState((prev) => ({
          ...prev,
          error: 'Connection lost during recovery',
          isScanning: false,
        }));
        eventSource.close();
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Recovery failed to start',
        isScanning: false,
      }));
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-2xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link
              href="/settings/privacy"
              className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Privacy
            </Link>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Stealth Payment Recovery</h1>
          <p className="mt-2 text-sm text-gray-600">
            Reconstruct your stealth payment history from your Stellar viewing key and the blockchain ledger.
            This process may take several minutes for accounts with long histories.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Information Banner */}
        {!state.isScanning && !state.isComplete && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0 text-blue-600" />
              <div className="text-sm text-blue-800">
                <p className="font-medium">Recovery Overview</p>
                <p className="mt-1">
                  This process will scan the Stellar ledger for all payments to your stealth addresses. Full recovery can
                  take 2-10 minutes depending on your payment history. Do not close this tab.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {state.error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900">Recovery Failed</p>
                <p className="mt-1 text-sm text-red-700">{state.error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Scanning State */}
        {state.isScanning && state.progress && (
          <div className="space-y-8">
            {/* Progress Stages */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-6 text-lg font-semibold text-gray-900">Recovery Progress</h2>
              <StageIndicator stage={state.progress.stage} current={state.progress.currentIndex} total={state.progress.totalItems} />
            </div>

            {/* Current Status */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Current Status</h2>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Processing</p>
                  <p className="mt-1 text-lg font-medium text-gray-900">
                    {state.progress.currentIndex} / {state.progress.totalItems} items
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Recovered Payments</p>
                  <p className="mt-1 text-lg font-medium text-green-600">{state.progress.recoveredPayments}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Message</p>
                  <p className="mt-1 text-sm text-gray-700">{state.progress.message}</p>
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="overflow-hidden rounded-lg bg-gray-200">
              <div
                className="h-2 bg-blue-600 transition-all duration-300"
                style={{ width: `${Math.round((state.progress.currentIndex / state.progress.totalItems) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Complete State */}
        {state.isComplete && (
          <div className="space-y-6">
            {/* Success Message */}
            <div className="rounded-lg border border-green-200 bg-green-50 p-6">
              <div className="flex gap-3">
                <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-green-600" />
                <div>
                  <h3 className="font-semibold text-green-900">Recovery Complete</h3>
                  <p className="mt-1 text-sm text-green-700">
                    Successfully recovered {state.payments.length} payments from your stealth addresses.
                  </p>
                </div>
              </div>
            </div>

            {/* Recovered Payments */}
            {state.payments.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900">Recovered Payments</h3>
                  <p className="mt-1 text-sm text-gray-600">{state.payments.length} payments found</p>
                </div>
                <div className="divide-y">
                  {state.payments.slice(0, 10).map((payment, idx) => (
                    <div key={idx} className="px-6 py-4">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-xs text-gray-500">Stealth Address</p>
                          <p className="mt-1 font-mono text-xs text-gray-900">
                            {payment.stealthAddress.slice(0, 20)}...
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Amount</p>
                          <p className="mt-1 font-medium text-gray-900">{payment.amount || 'N/A'} XLM</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Date</p>
                          <p className="mt-1 text-sm text-gray-900">
                            {new Date(payment.timestamp).toLocaleDateString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Status</p>
                          <p className="mt-1 text-sm text-green-600">Verified</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {state.payments.length > 10 && (
                  <div className="border-t bg-gray-50 px-6 py-4 text-center text-sm text-gray-600">
                    ... and {state.payments.length - 10} more payments
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
                <p className="text-gray-600">No stealth payments were found during the scan.</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleStartRecovery}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <RotateCcw className="h-4 w-4" />
                Run Recovery Again
              </button>
              <Link
                href="/settings/privacy"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back to Privacy Settings
              </Link>
            </div>
          </div>
        )}

        {/* Start Button */}
        {!state.isScanning && !state.isComplete && (
          <button
            onClick={handleStartRecovery}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-base font-medium text-white hover:bg-blue-700"
          >
            <RotateCcw className="h-5 w-5" />
            Start Recovery Scan
          </button>
        )}
      </div>
    </div>
  );
}
