"use client"

import { useState, useRef, useCallback } from "react"
import {
  X,
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  FileText,
  Loader2,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────

type RowStatus = "valid" | "duplicate" | "error"

interface PreviewRow {
  row: number
  status: RowStatus
  data: {
    name?: string
    price?: number
    currency?: string
    billing_cycle?: string
    next_renewal?: string | null
    category?: string
    renewal_url?: string | null
  } | null
  error?: string
  duplicateId?: string
}

interface Preview {
  rows: PreviewRow[]
  validCount: number
  duplicateCount: number
  errorCount: number
}

interface ImportResult {
  imported: number
  skipped: number
  errors: number
}

type Step = "upload" | "preview" | "done"

// ─── Props ────────────────────────────────────────────────────────────────

interface CSVImportModalProps {
  onClose: () => void
  onImportComplete: () => void
  darkMode?: boolean
}

// ─── Status badge ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RowStatus }) {
  if (status === "valid")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
        <CheckCircle className="w-3 h-3" /> Ready
      </span>
    )
  if (status === "duplicate")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
        <AlertTriangle className="w-3 h-3" /> Duplicate
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
      <AlertCircle className="w-3 h-3" /> Error
    </span>
  )
}

// ─── Main component ──────────────────────────────────────────────────────

export default function CSVImportModal({
  onClose,
  onImportComplete,
  darkMode,
}: CSVImportModalProps) {
  const [step, setStep] = useState<Step>("upload")
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [skipDupes, setSkipDupes] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Styles ──
  const card = `${darkMode ? "bg-[#2D3748] text-[#F9F6F2]" : "bg-white text-[#1E2A35]"} rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden max-h-[90vh] flex flex-col`
  const inputCls = `${darkMode ? "bg-[#1E2A35] border-[#374151] text-white" : "bg-white border-gray-200 text-gray-900"}`
  const btnSecondary = `px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${darkMode ? "border-[#374151] text-gray-300 hover:border-[#FFD166]" : "border-gray-300 text-gray-700 hover:border-[#1E2A35]"}`

  // ── File handling ──
  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith(".csv")) {
      setError("Only CSV files are accepted.")
      return
    }
    if (f.size > 1 * 1024 * 1024) {
      setError("File is too large — maximum size is 1 MB.")
      return
    }
    setFile(f)
    setError(null)
  }, [])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  // ── Preview ──
  const handlePreview = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)

      const res = await fetch("/api/subscriptions/import", {
        method: "POST",
        body: form,
      })
      const json = await res.json()

      if (!json.success) throw new Error(json.error ?? "Preview failed")

      setPreview(json.data.preview)
      setStep("preview")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed")
    } finally {
      setLoading(false)
    }
  }

  // ── Commit ──
  const handleCommit = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)

      const url = `/api/subscriptions/import?commit=true&skip_dupes=${skipDupes}`
      const res = await fetch(url, { method: "POST", body: form })
      const json = await res.json()

      if (!json.success) throw new Error(json.error ?? "Import failed")

      setResult(json.data)
      setStep("done")
      onImportComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed")
    } finally {
      setLoading(false)
    }
  }

  // ── Template download ──
  const handleTemplate = () => {
    window.location.href = "/api/subscriptions/import?template=true"
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={card}>
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1E2A35] to-[#2D3748] p-6 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Import from CSV</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                {step === "upload" && "Upload a CSV file to bulk-import subscriptions"}
                {step === "preview" && "Review what will be imported"}
                {step === "done" && "Import complete"}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close import dialog"
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-2 mt-4">
            {(["upload", "preview", "done"] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    step === s
                      ? "bg-[#FFD166] text-[#1E2A35]"
                      : (step === "preview" && s === "upload") || step === "done"
                      ? "bg-[#007A5C] text-white"
                      : "bg-white/20 text-white/60"
                  }`}
                >
                  {(step === "preview" && s === "upload") || step === "done" ? "✓" : i + 1}
                </div>
                <span className={`text-xs ${step === s ? "text-white" : "text-white/50"}`}>
                  {s === "upload" ? "Upload" : s === "preview" ? "Preview" : "Done"}
                </span>
                {i < 2 && <div className="w-8 h-px bg-white/20" />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* ── Upload step ── */}
          {step === "upload" && (
            <div className="space-y-5">
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragging
                    ? "border-[#FFD166] bg-[#FFD166]/5"
                    : darkMode
                    ? "border-[#374151] hover:border-[#FFD166]/60"
                    : "border-gray-300 hover:border-[#1E2A35]"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                <Upload className={`w-10 h-10 mx-auto mb-3 ${darkMode ? "text-gray-500" : "text-gray-400"}`} />
                {file ? (
                  <div>
                    <p className={`font-medium ${darkMode ? "text-white" : "text-gray-900"}`}>
                      <FileText className="w-4 h-4 inline mr-1" />
                      {file.name}
                    </p>
                    <p className={`text-sm mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                      {(file.size / 1024).toFixed(1)} KB — click to change
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className={`font-medium ${darkMode ? "text-white" : "text-gray-900"}`}>
                      Drop your CSV here or click to browse
                    </p>
                    <p className={`text-sm mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                      Maximum 500 rows · 1 MB
                    </p>
                  </div>
                )}
              </div>

              {/* Expected columns */}
              <div className={`rounded-lg p-4 text-sm ${darkMode ? "bg-[#1E2A35]" : "bg-gray-50"}`}>
                <p className={`font-semibold mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Expected columns
                </p>
                <code className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                  name, price, currency, billing_cycle, next_renewal, category, renewal_url
                </code>
                <p className={`text-xs mt-2 ${darkMode ? "text-gray-500" : "text-gray-500"}`}>
                  billing_cycle: monthly · yearly · quarterly · weekly · lifetime
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button onClick={handleTemplate} className={btnSecondary}>
                  <Download className="w-4 h-4 inline mr-1.5" />
                  Download template
                </button>
                <div className="flex-1" />
                <button onClick={onClose} className={btnSecondary}>Cancel</button>
                <button
                  onClick={handlePreview}
                  disabled={!file || loading}
                  className="flex items-center gap-2 px-5 py-2 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold text-sm hover:bg-[#FFD166]/90 transition-colors disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Preview import
                </button>
              </div>
            </div>
          )}

          {/* ── Preview step ── */}
          {step === "preview" && preview && (
            <div className="space-y-4">
              {/* Summary chips */}
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium">
                  {preview.validCount} ready to import
                </span>
                {preview.duplicateCount > 0 && (
                  <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
                    {preview.duplicateCount} duplicate{preview.duplicateCount !== 1 ? "s" : ""}
                  </span>
                )}
                {preview.errorCount > 0 && (
                  <span className="px-3 py-1 rounded-full bg-red-100 text-red-700 text-sm font-medium">
                    {preview.errorCount} error{preview.errorCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Duplicate handling option */}
              {preview.duplicateCount > 0 && (
                <div className={`flex items-start gap-3 p-3 rounded-lg border ${darkMode ? "border-[#374151] bg-[#1E2A35]" : "border-amber-200 bg-amber-50"}`}>
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${darkMode ? "text-gray-200" : "text-amber-800"}`}>
                      {preview.duplicateCount} subscription{preview.duplicateCount !== 1 ? "s" : ""} already exist
                    </p>
                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skipDupes}
                        onChange={(e) => setSkipDupes(e.target.checked)}
                        className="rounded"
                      />
                      <span className={`text-sm ${darkMode ? "text-gray-400" : "text-amber-700"}`}>
                        Skip duplicates (recommended)
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Preview table */}
              <div className={`border rounded-lg overflow-hidden ${darkMode ? "border-[#374151]" : "border-gray-200"}`}>
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={darkMode ? "bg-[#1E2A35]" : "bg-gray-50"}>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Row</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Name</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Price</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Cycle</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Category</th>
                        <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.rows.map((row) => (
                        <tr
                          key={row.row}
                          className={
                            row.status === "error"
                              ? darkMode ? "bg-red-900/20" : "bg-red-50"
                              : row.status === "duplicate"
                              ? darkMode ? "bg-amber-900/20" : "bg-amber-50"
                              : ""
                          }
                        >
                          <td className={`px-3 py-2 text-xs ${darkMode ? "text-gray-500" : "text-gray-400"}`}>{row.row}</td>
                          <td className={`px-3 py-2 font-medium ${darkMode ? "text-gray-200" : "text-gray-900"}`}>
                            {row.data?.name ?? <span className="text-gray-400">—</span>}
                          </td>
                          <td className={`px-3 py-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                            {row.data?.price != null ? `$${row.data.price.toFixed(2)}` : "—"}
                          </td>
                          <td className={`px-3 py-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                            {row.data?.billing_cycle ?? "—"}
                          </td>
                          <td className={`px-3 py-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                            {row.data?.category ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge status={row.status} />
                            {row.status === "error" && row.error && (
                              <p className="text-xs text-red-500 mt-0.5">{row.error}</p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setStep("upload")} className={btnSecondary}>
                  ← Back
                </button>
                <div className="flex-1" />
                <button onClick={onClose} className={btnSecondary}>Cancel</button>
                <button
                  onClick={handleCommit}
                  disabled={loading || preview.validCount === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold text-sm hover:bg-[#FFD166]/90 transition-colors disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Import {skipDupes ? preview.validCount : preview.validCount + preview.duplicateCount} subscription{(preview.validCount + (skipDupes ? 0 : preview.duplicateCount)) !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          )}

          {/* ── Done step ── */}
          {step === "done" && result && (
            <div className="text-center py-8 space-y-6">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <CheckCircle className="w-9 h-9 text-green-600" />
              </div>
              <div>
                <h3 className={`text-xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
                  Import complete!
                </h3>
                <p className={`mt-2 text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                  Your subscriptions have been added to your dashboard.
                </p>
              </div>

              <div className="flex justify-center gap-4">
                <div className="text-center">
                  <p className="text-3xl font-bold text-green-600">{result.imported}</p>
                  <p className={`text-xs mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>imported</p>
                </div>
                {result.skipped > 0 && (
                  <div className="text-center">
                    <p className="text-3xl font-bold text-amber-500">{result.skipped}</p>
                    <p className={`text-xs mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>skipped</p>
                  </div>
                )}
                {result.errors > 0 && (
                  <div className="text-center">
                    <p className="text-3xl font-bold text-red-500">{result.errors}</p>
                    <p className={`text-xs mt-1 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>errors</p>
                  </div>
                )}
              </div>

              <button
                onClick={onClose}
                className="px-8 py-2.5 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
