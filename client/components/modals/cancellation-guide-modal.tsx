"use client"

import { useState, useEffect } from "react"
import { X, ExternalLink, CheckCircle2, AlertTriangle, Clock, MessageSquare, Phone, Info } from "lucide-react"
import { fetchCancellationGuide, reportDifficulty, markAsCancelled, type CancellationGuide } from "@/lib/supabase/cancellation-guides"

interface CancellationGuideModalProps {
  subscription: any
  onClose: () => void
  onCancelled: () => void
  darkMode?: boolean
}

export default function CancellationGuideModal({
  subscription,
  onClose,
  onCancelled,
  darkMode,
}: CancellationGuideModalProps) {
  const [guide, setGuide] = useState<CancellationGuide | null>(null)
  const [loading, setLoading] = useState(true)
  const [completedSteps, setCompletedSteps] = useState<boolean[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [showReportForm, setShowReportForm] = useState(false)
  const [reportDiff, setReportDiff] = useState<"easy" | "medium" | "hard" | "">("")

  useEffect(() => {
    async function loadGuide() {
      try {
        const data = await fetchCancellationGuide(subscription.name)
        setGuide(data)
        if (data) {
          setCompletedSteps(new Array(data.steps.length).fill(false))
        }
      } catch (error) {
        console.error("Failed to load cancellation guide:", error)
      } finally {
        setLoading(false)
      }
    }
    loadGuide()
  }, [subscription.name])

  const handleStepToggle = (index: number) => {
    const newSteps = [...completedSteps]
    newSteps[index] = !newSteps[index]
    setCompletedSteps(newSteps)
  }

  const handleMarkAsCancelled = async () => {
    setSubmitting(true)
    try {
      await markAsCancelled(subscription.id)
      onCancelled()
      onClose()
    } catch (error) {
      console.error("Failed to mark as cancelled:", error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleReportDifficulty = async () => {
    if (!reportDiff) return
    try {
      await reportDifficulty({
        service_name: subscription.name,
        reported_difficulty: reportDiff as "easy" | "medium" | "hard",
      })
      setShowReportForm(false)
      alert("Thank you for your report!")
    } catch (error) {
      console.error("Failed to report difficulty:", error)
    }
  }

  const allStepsCompleted = completedSteps.length > 0 && completedSteps.every((step) => step)

  const difficultyColors = {
    easy: "text-green-500 bg-green-500/10",
    medium: "text-yellow-500 bg-yellow-500/10",
    hard: "text-red-500 bg-red-500/10",
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-labelledby="cancel-modal-title"
        aria-modal="true"
        className={`${darkMode ? "bg-[#2D3748] text-[#F9F6F2]" : "bg-white text-[#1E2A35]"} rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col`}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1E2A35] to-[#2D3748] p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-2xl p-2">
                {subscription.icon}
              </div>
              <div>
                <h2 id="cancel-modal-title" className="text-2xl font-bold text-white">Cancel {subscription.name}</h2>
                <p className="text-sm text-gray-300 mt-1">Follow the guide to end your subscription</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close guide" className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <X aria-hidden="true" className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FFD166]"></div>
              <p className="mt-4 text-gray-500">Loading cancellation guide...</p>
            </div>
          ) : guide ? (
            <div className="space-y-6">
              {/* Difficulty & Time */}
              <div className="flex items-center gap-4">
                <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${difficultyColors[guide.difficulty]}`}>
                  {guide.difficulty} Difficulty
                </div>
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <Clock className="w-4 h-4" />
                  {guide.estimated_time}
                </div>
              </div>

              {/* Warning Note */}
              {guide.warning_note && (
                <div className={`p-4 rounded-xl border ${darkMode ? "bg-red-500/5 border-red-500/20" : "bg-red-50 border-red-100"} flex gap-3`}>
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                  <div>
                    <p className={`text-sm font-semibold ${darkMode ? "text-red-400" : "text-red-700"}`}>Important Warning</p>
                    <p className={`text-sm ${darkMode ? "text-red-300/80" : "text-red-600/80"} mt-0.5`}>{guide.warning_note}</p>
                  </div>
                </div>
              )}

              {/* Steps */}
              <div className="space-y-3">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Info className="w-5 h-5 text-[#FFD166]" />
                  Step-by-Step Instructions
                </h3>
                <div className="space-y-2">
                  {guide.steps.map((step, index) => (
                    <div
                      key={index}
                      onClick={() => handleStepToggle(index)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                        completedSteps[index]
                          ? darkMode ? "bg-[#FFD166]/5 border-[#FFD166]/50" : "bg-green-50 border-green-200"
                          : darkMode ? "bg-[#1E2A35] border-[#374151]" : "bg-gray-50 border-gray-100"
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        completedSteps[index]
                          ? "bg-[#FFD166] text-[#1E2A35]"
                          : darkMode ? "bg-[#374151] text-gray-500" : "bg-white text-gray-400 border border-gray-200"
                      }`}>
                        {completedSteps[index] ? <CheckCircle2 className="w-4 h-4" /> : index + 1}
                      </div>
                      <p className={`text-sm flex-1 ${completedSteps[index] ? "line-through opacity-60" : ""}`}>
                        {step}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Direct Link */}
              <div className="bg-[#FFD166]/10 p-4 rounded-xl border border-[#FFD166]/20">
                <p className="text-sm font-medium mb-3">Ready to go? Jump straight to the cancellation page:</p>
                <a
                  href={guide.direct_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#1E2A35] text-white rounded-lg font-semibold hover:bg-[#2D3748] transition-colors"
                >
                  Go to Cancellation Page
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              {/* Support Links */}
              {(guide.chat_support_link || guide.phone_number) && (
                <div className="pt-4 border-t border-gray-200 dark:border-[#374151]">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Stuck? Try support</p>
                  <div className="flex gap-4 text-sm font-medium">
                    {guide.chat_support_link && (
                      <a href={guide.chat_support_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-blue-500 hover:text-blue-600 transition-colors">
                        <MessageSquare className="w-4 h-4" />
                        Live Chat
                      </a>
                    )}
                    {guide.phone_number && (
                      <a href={`tel:${guide.phone_number}`} className="flex items-center gap-1.5 text-blue-500 hover:text-blue-600 transition-colors">
                        <Phone className="w-4 h-4" />
                        {guide.phone_number}
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Community Contribution */}
              <div className="pt-4">
                {!showReportForm ? (
                  <button
                    onClick={() => setShowReportForm(true)}
                    className="text-xs text-gray-500 hover:text-[#FFD166] underline underline-offset-2 transition-colors"
                  >
                    Guide incorrect? Report difficulty or changes
                  </button>
                ) : (
                  <div className={`p-4 rounded-xl border ${darkMode ? "bg-[#1E2A35] border-[#374151]" : "bg-gray-50 border-gray-200"}`}>
                    <p className="text-sm font-semibold mb-3">Rate the real difficulty:</p>
                    <div className="flex gap-3 mb-4">
                      {["easy", "medium", "hard"].map((d) => (
                        <button
                          key={d}
                          onClick={() => setReportDiff(d as any)}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border-2 transition-all ${
                            reportDiff === d
                              ? difficultyColors[d as keyof typeof difficultyColors] + " border-current"
                              : "border-transparent bg-gray-100 dark:bg-[#2D3748] text-gray-400"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                       <button
                        onClick={handleReportDifficulty}
                        disabled={!reportDiff}
                        className="flex-1 py-2 bg-[#FFD166] text-[#1E2A35] rounded-lg text-xs font-bold hover:bg-[#FFD166]/90 disabled:opacity-50"
                      >
                        Submit Report
                      </button>
                      <button
                        onClick={() => setShowReportForm(false)}
                        className="px-4 py-2 border border-gray-300 dark:border-[#374151] rounded-lg text-xs font-bold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-20 h-20 bg-gray-100 dark:bg-[#1E2A35] rounded-full flex items-center justify-center text-4xl mb-4">
                ❓
              </div>
              <h3 className="text-xl font-bold mb-2">No Guide Available</h3>
              <p className="text-gray-500 max-w-sm">We don&apos;t have a specific cancellation guide for {subscription.name} yet.</p>
              <a
                href={subscription.renewal_url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 transition-colors"
              >
                Go to Account Settings
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`p-6 border-t ${darkMode ? "border-[#374151]" : "border-gray-200"}`}>
          <button
            onClick={handleMarkAsCancelled}
            disabled={submitting || (guide && !allStepsCompleted)}
            className={`w-full px-4 py-4 ${allStepsCompleted ? "bg-[#007A5C] text-white hover:bg-[#007A5C]/90" : "bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"} rounded-xl font-bold text-lg shadow-lg shadow-[#FFD166]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2`}
          >
            {submitting ? (
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current"></div>
            ) : (
              <>
                {allStepsCompleted && <CheckCircle2 className="w-6 h-6" />}
                Mark as Cancelled
              </>
            )}
          </button>
          {!allStepsCompleted && guide && (
             <p className="text-center text-xs text-gray-500 mt-3 flex items-center justify-center gap-1">
               <Info className="w-3 h-3" />
               Complete all steps to mark as cancelled
             </p>
          )}
        </div>
      </div>
    </div>
  )
}
