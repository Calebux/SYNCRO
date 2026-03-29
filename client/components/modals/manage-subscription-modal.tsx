"use client"

import {
  X,
  Edit,
  Trash2,
  ExternalLink,
  Calendar,
  DollarSign,
  Tag,
  Pause,
  Play,
  Ban,
  Bell,
} from "lucide-react"
import { useState } from "react"
import NotificationPreferencesModal from "@/components/modals/notification-preferences-modal"
import { NotesEditor } from "@/components/ui/notes-editor"
import { TagInput } from "@/components/ui/tag-input"
import { useTags } from "@/hooks/use-tags"

const CANCEL_LINKS: Record<string, string> = {
  "ChatGPT Plus": "https://platform.openai.com/account/billing/overview",
  Netflix: "https://www.netflix.com/cancelplan",
  "Spotify Premium": "https://www.spotify.com/account/subscription/",
  Notion: "https://www.notion.so/account/settings",
  "Adobe Creative Cloud": "https://account.adobe.com/plans",
  "GitHub Copilot": "https://github.com/settings/billing/summary",
  Midjourney: "https://www.midjourney.com/account/billing/manage",
  "Microsoft 365": "https://account.microsoft.com/services/",
  "Disney+": "https://www.disneyplus.com/account",
  "Figma Professional": "https://www.figma.com/settings",
  "Vercel Pro": "https://vercel.com/account/billing",
}

interface ManageSubscriptionModalProps {
  subscription: any
  onClose: () => void
  onDelete: () => void
  onEdit: () => void
  onCancel: () => void
  onPause: () => void
  onResume: () => void
  darkMode?: boolean
}

export default function ManageSubscriptionModal({
  subscription,
  onClose,
  onDelete,
  onEdit,
  onCancel,
  onPause,
  onResume,
  darkMode,
}: ManageSubscriptionModalProps) {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showConfirmCancel, setShowConfirmCancel] = useState(false)
  const [showConfirmPause, setShowConfirmPause] = useState(false)
  const [showNotificationModal, setShowNotificationModal] = useState(false)
  const { tags, addTagToSubscription, removeTagFromSubscription, createTag, saveNotes } = useTags()
  const [assignedTagIds, setAssignedTagIds] = useState<string[]>(
    subscription.custom_tag_ids ?? [],
  )

  const handleAddTag = async (tagId: string) => {
    await addTagToSubscription(String(subscription.id), tagId)
    setAssignedTagIds((prev) => [...prev, tagId])
  }

  const handleRemoveTag = async (tagId: string) => {
    await removeTagFromSubscription(String(subscription.id), tagId)
    setAssignedTagIds((prev) => prev.filter((id) => id !== tagId))
  }

  const cancelLink = CANCEL_LINKS[subscription.name] || subscription.renewalUrl

  const handleDelete = () => {
    onDelete()
    onClose()
  }

  const handleCancel = () => {
    if (onCancel) onCancel()
    onClose()
  }

  const handlePause = () => {
    if (onPause) onPause()
    onClose()
  }

  const handleResume = () => {
    if (onResume) onResume()
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-labelledby="manage-modal-title"
          aria-describedby="manage-modal-desc"
          aria-modal="true"
          className={`${
            darkMode
              ? "bg-[#2D3748] text-[#F9F6F2]"
              : "bg-white text-[#1E2A35]"
          } rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden`}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-[#1E2A35] to-[#2D3748] p-6">
            <div className="flex items-center justify-between">
              <h2
                id="manage-modal-title"
                className="text-2xl font-bold text-white"
              >
                Manage Subscription
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNotificationModal(true)}
                  aria-label="Open notification settings"
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <Bell
                    className="w-5 h-5 text-[#FFD166]"
                    aria-hidden="true"
                  />
                </button>
                <button
                  onClick={onClose}
                  aria-label="Close manage subscription dialog"
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-white" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          <div className="p-6">
            {/* Subscription Info Card */}
            <div
              id="manage-modal-desc"
              className={`mb-6 p-5 ${
                darkMode ? "bg-[#1E2A35]" : "bg-[#F9F6F2]"
              } rounded-xl`}
            >
              <div className="flex items-center gap-4 mb-4">
                <div
                  aria-hidden="true"
                  className="w-16 h-16 bg-white rounded-xl flex items-center justify-center shadow-md"
                >
                  <span className="text-3xl">{subscription.icon}</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg">{subscription.name}</h3>
                  <p
                    className={`text-sm ${
                      darkMode ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    {subscription.category}
                  </p>
                </div>
                <div
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    subscription.status === "active"
                      ? "bg-[#007A5C]/20 text-[#007A5C]"
                      : subscription.status === "paused"
                        ? "bg-[#FFD166]/20 text-[#FFD166]"
                        : subscription.status === "cancelled"
                          ? "bg-[#E86A33]/20 text-[#E86A33]"
                          : subscription.status === "expired"
                            ? "bg-red-500/20 text-red-500"
                            : "bg-gray-500/20 text-gray-500"
                  }`}
                >
                  {subscription.status}
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div
                  className={`p-3 ${
                    darkMode ? "bg-[#2D3748]" : "bg-white"
                  } rounded-lg`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-4 h-4 text-[#FFD166]" />
                    <span
                      className={`text-xs ${
                        darkMode ? "text-gray-400" : "text-gray-600"
                      }`}
                    >
                      {subscription.billingCycle === "lifetime"
                        ? "One-time"
                        : "Monthly cost"}
                    </span>
                  </div>
                  <p className="text-xl font-bold">${subscription.price}</p>
                </div>

                {subscription.billingCycle !== "lifetime" && (
                  <div
                    className={`p-3 ${
                      darkMode ? "bg-[#2D3748]" : "bg-white"
                    } rounded-lg`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Calendar className="w-4 h-4 text-[#FFD166]" />
                      <span
                        className={`text-xs ${
                          darkMode ? "text-gray-400" : "text-gray-600"
                        }`}
                      >
                        {subscription.status === "cancelled"
                          ? "Active until"
                          : "Renews in"}
                      </span>
                    </div>
                    <p className="text-xl font-bold">
                      {subscription.status === "cancelled" &&
                      subscription.activeUntil
                        ? new Date(
                            subscription.activeUntil,
                          ).toLocaleDateString()
                        : `${subscription.renewsIn} days`}
                    </p>
                  </div>
                )}
              </div>

              {/* Status Messages */}
              {subscription.status === "paused" && subscription.resumesAt && (
                <div className="mt-4 p-3 bg-[#FFD166]/10 border border-[#FFD166]/30 rounded-lg">
                  <p className="text-sm text-[#FFD166]">
                    Paused - Resumes on{" "}
                    {new Date(subscription.resumesAt).toLocaleDateString()}
                  </p>
                </div>
              )}

              {subscription.status === "cancelled" &&
                subscription.activeUntil && (
                  <div className="mt-4 p-3 bg-[#E86A33]/10 border border-[#E86A33]/30 rounded-lg">
                    <p className="text-sm text-[#E86A33]">
                      Cancelled - Active until{" "}
                      {new Date(
                        subscription.activeUntil,
                      ).toLocaleDateString()}
                    </p>
                  </div>
                )}

              {subscription.status === "expired" && subscription.expiredAt && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-500">
                    Expired on{" "}
                    {new Date(subscription.expiredAt).toLocaleDateString()} due
                    to inactivity
                  </p>
                </div>
              )}

              {/* Tags */}
              {subscription.tags && subscription.tags.length > 0 && (
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <Tag className="w-4 h-4 text-gray-400" />
                  {subscription.tags.map((tag: string, idx: number) => (
                    <span
                      key={idx}
                      className={`px-2 py-1 text-xs rounded-full ${
                        darkMode
                          ? "bg-[#2D3748] text-gray-300"
                          : "bg-white text-gray-700"
                      }`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              {cancelLink && subscription.status === "active" && (
                <button
                  onClick={() => window.open(cancelLink, "_blank")}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#FFD166] text-[#1E2A35] rounded-lg font-semibold hover:bg-[#FFD166]/90 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Cancel on Provider Site
                </button>
              )}
            {/* Legacy plain tags */}
            {subscription.tags && subscription.tags.length > 0 && (
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <Tag className="w-4 h-4 text-gray-400" />
                {subscription.tags?.map((tag: string, idx: number) => (
                  <span
                    key={idx}
                    className={`px-2 py-1 text-xs rounded-full ${darkMode ? "bg-[#2D3748] text-gray-300" : "bg-white text-gray-700"}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Custom coloured tags */}
            <div className="mt-4">
              <p className={`text-xs font-medium mb-1.5 ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                Custom tags
              </p>
              <TagInput
                allTags={tags}
                selectedTagIds={assignedTagIds}
                onAdd={handleAddTag}
                onRemove={handleRemoveTag}
                onCreateTag={createTag}
                darkMode={darkMode}
              />
            </div>

            {/* Notes */}
            <NotesEditor
              subscriptionId={String(subscription.id)}
              initialNotes={subscription.notes ?? ""}
              onSave={saveNotes}
              darkMode={darkMode}
            />
          </div>

              {subscription.renewalUrl &&
                subscription.status !== "cancelled" && (
                  <button
                    onClick={() =>
                      window.open(subscription.renewalUrl, "_blank")
                    }
                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 border-2 ${
                      darkMode
                        ? "border-[#374151] hover:border-[#FFD166] text-[#F9F6F2]"
                        : "border-gray-300 hover:border-[#1E2A35] text-[#1E2A35]"
                    } rounded-lg transition-colors font-medium`}
                  >
                    <ExternalLink className="w-4 h-4" />
                    Manage on Provider Site
                  </button>
                )}

              <button
                onClick={onEdit}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 border-2 ${
                  darkMode
                    ? "border-[#374151] hover:border-[#FFD166] text-[#F9F6F2]"
                    : "border-gray-300 hover:border-[#1E2A35] text-[#1E2A35]"
                } rounded-lg transition-colors font-medium`}
              >
                <Edit className="w-4 h-4" />
                Edit Subscription Details
              </button>

              {/* Notification Settings */}
              <button
                onClick={() => setShowNotificationModal(true)}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 border-2 ${
                  darkMode
                    ? "border-[#374151] hover:border-[#FFD166] text-[#F9F6F2]"
                    : "border-gray-300 hover:border-[#1E2A35] text-[#1E2A35]"
                } rounded-lg transition-colors font-medium`}
              >
                <Bell className="w-4 h-4" />
                Notification Settings
              </button>

              {subscription.status === "active" &&
                subscription.billingCycle !== "lifetime" && (
                  <button
                    onClick={() => setShowConfirmPause(true)}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 border-2 ${
                      darkMode
                        ? "border-[#374151] hover:border-[#FFD166] text-[#F9F6F2]"
                        : "border-gray-300 hover:border-[#1E2A35] text-[#1E2A35]"
                    } rounded-lg transition-colors font-medium`}
                  >
                    <Pause className="w-4 h-4" />
                    Pause Subscription
                  </button>
                )}

              {subscription.status === "paused" && (
                <button
                  onClick={handleResume}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#007A5C] text-white rounded-lg font-semibold hover:bg-[#007A5C]/90 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Resume Subscription
                </button>
              )}

              {subscription.status === "active" &&
                subscription.billingCycle !== "lifetime" && (
                  <button
                    onClick={() => setShowConfirmCancel(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#E86A33]/10 text-[#E86A33] hover:bg-[#E86A33]/20 rounded-lg transition-colors font-medium"
                  >
                    <Ban className="w-4 h-4" />
                    Cancel Subscription
                  </button>
                )}

              <button
                onClick={() => setShowConfirmDelete(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#E86A33]/10 text-[#E86A33] hover:bg-[#E86A33]/20 rounded-lg transition-colors font-medium"
              >
                <Trash2 className="w-4 h-4" />
                Remove from Dashboard
              </button>
            </div>
          </div>
        </div>

        {/* Confirm Delete */}
        {showConfirmDelete && (
          <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
            <div
              className={`${
                darkMode ? "bg-[#2D3748]" : "bg-white"
              } rounded-xl p-6 max-w-md w-full shadow-2xl`}
            >
              <h3
                className={`text-lg font-bold mb-2 ${
                  darkMode ? "text-white" : "text-gray-900"
                }`}
              >
                Remove subscription?
              </h3>
              <p
                className={`text-sm mb-6 ${
                  darkMode ? "text-gray-400" : "text-gray-600"
                }`}
              >
                This will remove {subscription.name} from your dashboard. This
                action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmDelete(false)}
                  className={`flex-1 px-4 py-2 border rounded-lg ${
                    darkMode
                      ? "border-[#374151] text-gray-300"
                      : "border-gray-300 text-gray-700"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 px-4 py-2 bg-[#E86A33] text-white rounded-lg hover:bg-[#E86A33]/90"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Cancel */}
        {showConfirmCancel && (
          <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
            <div
              className={`${
                darkMode ? "bg-[#2D3748]" : "bg-white"
              } rounded-xl p-6 max-w-md w-full shadow-2xl`}
            >
              <h3
                className={`text-lg font-bold mb-2 ${
                  darkMode ? "text-white" : "text-gray-900"
                }`}
              >
                Cancel subscription?
              </h3>
              <p
                className={`text-sm mb-6 ${
                  darkMode ? "text-gray-400" : "text-gray-600"
                }`}
              >
                {subscription.name} will remain active until{" "}
                {new Date(
                  Date.now() +
                    (subscription.renewsIn || 0) * 24 * 60 * 60 * 1000,
                ).toLocaleDateString()}
                , then stop renewing.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmCancel(false)}
                  className={`flex-1 px-4 py-2 border rounded-lg ${
                    darkMode
                      ? "border-[#374151] text-gray-300"
                      : "border-gray-300 text-gray-700"
                  }`}
                >
                  Keep Active
                </button>
                <button
                  onClick={handleCancel}
                  className="flex-1 px-4 py-2 bg-[#E86A33] text-white rounded-lg hover:bg-[#E86A33]/90"
                >
                  Cancel Subscription
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Pause */}
        {showConfirmPause && (
          <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
            <div
              className={`${
                darkMode ? "bg-[#2D3748]" : "bg-white"
              } rounded-xl p-6 max-w-md w-full shadow-2xl`}
            >
              <h3
                className={`text-lg font-bold mb-2 ${
                  darkMode ? "text-white" : "text-gray-900"
                }`}
              >
                Pause subscription?
              </h3>
              <p
                className={`text-sm mb-6 ${
                  darkMode ? "text-gray-400" : "text-gray-600"
                }`}
              >
                This will pause tracking for {subscription.name}. You can
                resume it anytime. The subscription will automatically resume in
                30 days.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmPause(false)}
                  className={`flex-1 px-4 py-2 border rounded-lg ${
                    darkMode
                      ? "border-[#374151] text-gray-300"
                      : "border-gray-300 text-gray-700"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={handlePause}
                  className="flex-1 px-4 py-2 bg-[#FFD166] text-[#1E2A35] rounded-lg hover:bg-[#FFD166]/90"
                >
                  Pause
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Notification Modal — z-[60] so it sits above the manage modal */}
      {showNotificationModal && (
        <NotificationPreferencesModal
          subscriptionId={String(subscription.id)}
          subscriptionName={subscription.name}
          darkMode={darkMode}
          onClose={() => setShowNotificationModal(false)}
        />
      )}
    </>
  )
}