"use client"

import { useState } from "react"
import { Copy, CheckCircle2, X, Shield, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useMFA } from "@/hooks/use-mfa"
import { useToast } from "@/hooks/use-toast"

interface MFASetupProps {
  onComplete?: () => void
  onCancel?: () => void
  darkMode?: boolean
}

export function MFASetup({ onComplete, onCancel, darkMode = false }: MFASetupProps) {
  const [step, setStep] = useState<"intro" | "scan" | "verify" | "recovery">("intro")
  const [code, setCode] = useState("")
  const [copied, setCopied] = useState(false)
  const { showToast } = useToast()
  const { 
    loading, 
    enrollment, 
    recoveryCodes, 
    startEnrollment, 
    verifyEnrollment,
    cancelEnrollment,
    clearRecoveryCodes
  } = useMFA({ onToast: showToast })

  const handleStart = async () => {
    try {
      await startEnrollment()
      setStep("scan")
    } catch {
      // Error handled by hook
    }
  }

  const handleVerify = async () => {
    if (code.length !== 6) return
    
    try {
      await verifyEnrollment(code)
      setStep("recovery")
    } catch {
      // Error handled by hook
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    showToast({
      title: "Copied",
      description: "Recovery codes copied to clipboard",
      variant: "default"
    })
  }

  const handleComplete = () => {
    clearRecoveryCodes()
    onComplete?.()
  }

  return (
    <div className={`max-w-md mx-auto ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      {step === "intro" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`p-3 rounded-full ${darkMode ? 'bg-[#FFD166]/20' : 'bg-yellow-100'}`}>
              <Shield className="w-6 h-6 text-[#FFD166]" />
            </div>
            <h2 className="text-xl font-semibold">Enable Two-Factor Authentication</h2>
          </div>
          
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Two-factor authentication adds an extra layer of security to your account. 
            You will need to enter a code from your authenticator app when logging in.
          </p>

          <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#2D3748]' : 'bg-gray-100'}`}>
            <div className="flex items-center gap-3 mb-3">
              <Smartphone className="w-5 h-5 text-[#FFD166]" />
              <span className="font-medium">You will need:</span>
            </div>
            <ul className={`text-sm space-y-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                An authenticator app like Google Authenticator, Authy, or 1Password
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Your device's camera to scan the QR code
              </li>
            </ul>
          </div>

          <div className="flex gap-3">
            {onCancel && (
              <Button
                variant="secondary"
                onClick={onCancel}
                className="flex-1"
              >
                Cancel
              </Button>
            )}
            <Button
              onClick={handleStart}
              disabled={loading}
              className="flex-1 bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"
            >
              Start Setup
            </Button>
          </div>
        </div>
      )}

      {step === "scan" && enrollment && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold mb-4">Scan QR Code</h2>
          
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Open your authenticator app and scan the QR code below, or enter the secret manually.
          </p>

          <div className={`p-6 rounded-lg bg-white flex items-center justify-center`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={enrollment.qrCode} 
              alt="QR Code for MFA setup" 
              className="w-48 h-48"
            />
          </div>

          <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#2D3748]' : 'bg-gray-100'}`}>
            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'} mb-2`}>
              Can't scan? Enter this secret manually:
            </p>
            <div className="flex items-center gap-2">
              <code className={`flex-1 p-2 rounded text-sm font-mono ${darkMode ? 'bg-[#1E2A35]' : 'bg-white'}`}>
                {enrollment.secret}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleCopy(enrollment.secret)}
              >
                {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                cancelEnrollment()
                setStep("intro")
              }}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              onClick={() => setStep("verify")}
              className="flex-1 bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === "verify" && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold mb-4">Verify Code</h2>
          
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Enter the 6-digit code from your authenticator app.
          </p>

          <Input
            type="text"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="text-center text-2xl tracking-widest font-mono h-16"
            maxLength={6}
            autoFocus
          />

          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setStep("scan")}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              onClick={handleVerify}
              disabled={loading || code.length !== 6}
              className="flex-1 bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"
            >
              Verify
            </Button>
          </div>
        </div>
      )}

      {step === "recovery" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`p-3 rounded-full ${darkMode ? 'bg-green-500/20' : 'bg-green-100'}`}>
              <CheckCircle2 className="w-6 h-6 text-green-500" />
            </div>
            <h2 className="text-xl font-semibold">Setup Complete!</h2>
          </div>
          
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Save these recovery codes in a secure place. They can be used to access your account if you lose your device.
          </p>

          <div className={`p-4 rounded-lg ${darkMode ? 'bg-[#2D3748]' : 'bg-gray-100'}`}>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map((code, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className={`${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{index + 1}.</span>
                  <code>{code}</code>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => handleCopy(recoveryCodes.join('\n'))}
              className="gap-2"
            >
              {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              Copy All
            </Button>
          </div>

          <Button
            onClick={handleComplete}
            disabled={loading}
            className="w-full bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"
          >
            Done
          </Button>
        </div>
      )}
    </div>
  )
}
