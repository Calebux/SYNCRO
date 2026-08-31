"use client"

import { useState } from "react"
import { Shield, Lock, CheckCircle2, XCircle, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MFASetup } from "./mfa-setup"
import { useMFA } from "@/hooks/use-mfa"
import { useToast } from "@/hooks/use-toast"
import { useConfirmationDialog } from "@/hooks/use-confirmation-dialog"

interface MFAManagementProps {
  darkMode?: boolean
  teamRequiresMFA?: boolean
}

export function MFAManagement({ darkMode = false, teamRequiresMFA = false }: MFAManagementProps) {
  const [showSetup, setShowSetup] = useState(false)
  const { showToast } = useToast()
  const { showDialog, hideDialog } = useConfirmationDialog()
  const { 
    loading, 
    status, 
    factors, 
    disableMFA,
    loadStatus
  } = useMFA({ onToast: showToast })

  const handleDisable = (factorId: string) => {
    if (teamRequiresMFA) {
      showToast({
        title: "Cannot Disable MFA",
        description: "Your team requires two-factor authentication to be enabled.",
        variant: "error"
      })
      return
    }

    showDialog({
      title: "Disable Two-Factor Authentication",
      description: "Are you sure you want to disable MFA? Your account will be less secure.",
      variant: "danger",
      confirmLabel: "Disable",
      onConfirm: async () => {
        try {
          await disableMFA(factorId)
          hideDialog()
        } catch {
          // Error handled by hook
        }
      },
      onCancel: hideDialog
    })
  }

  if (showSetup) {
    return (
      <div className={`p-6 rounded-lg border ${darkMode ? 'bg-[#2D3748] border-[#374151]' : 'bg-white border-gray-200'}`}>
        <button
          onClick={() => setShowSetup(false)}
          className={`mb-4 text-sm ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
        >
          ← Back
        </button>
        <MFASetup 
          darkMode={darkMode} 
          onComplete={() => {
            setShowSetup(false)
            loadStatus()
          }}
          onCancel={() => setShowSetup(false)}
        />
      </div>
    )
  }

  return (
    <div className={`p-6 rounded-lg border ${darkMode ? 'bg-[#2D3748] border-[#374151]' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${darkMode ? 'bg-[#FFD166]/20' : 'bg-yellow-100'}`}>
            <Shield className="w-5 h-5 text-[#FFD166]" />
          </div>
          <div>
            <h3 className="font-semibold">Two-Factor Authentication</h3>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Add an extra layer of security to your account
            </p>
          </div>
        </div>

        {status && !status.enabled && (
          <Button
            onClick={() => setShowSetup(true)}
            disabled={loading}
            className="bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90 gap-2"
          >
            <Plus className="w-4 h-4" />
            Enable MFA
          </Button>
        )}
      </div>

      {teamRequiresMFA && !status?.enabled && (
        <div className="mb-4 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <div className="flex items-center gap-2 text-yellow-500">
            <Lock className="w-4 h-4" />
            <span className="text-sm font-medium">
              Your team requires two-factor authentication
            </span>
          </div>
        </div>
      )}

      {status && status.enabled ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-green-500/10">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-green-500">MFA is enabled</p>
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Your account is protected with two-factor authentication
                </p>
              </div>
            </div>
            {!teamRequiresMFA && factors.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => handleDisable(factors[0].id)}
                disabled={loading}
                className="text-red-500 hover:bg-red-500/10 gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Disable
              </Button>
            )}
          </div>

          {factors.map(factor => (
            <div key={factor.id} className={`p-4 rounded-lg ${darkMode ? 'bg-[#1E2A35]' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Authenticator App</p>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Added on {new Date(factor.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${darkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700'}`}>
                    Active
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#1E2A35]' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-3">
            <XCircle className={`w-5 h-5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Two-factor authentication is not enabled
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
