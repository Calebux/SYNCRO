"use client"

import { useState, useEffect } from "react"
import { Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { listFactors } from "@/lib/api/mfa"
import { getErrorMessage } from "@/lib/network-utils"

interface MFAVerifyProps {
  onSuccess: () => void
  darkMode?: boolean
}

export function MFAVerify({ onSuccess, darkMode = false }: MFAVerifyProps) {
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)

  // Get the first TOTP factor on mount
  useEffect(() => {
    const loadFactor = async () => {
      try {
        const factors = await listFactors()
        const totpFactor = factors.find(f => f.type === 'totp')
        if (totpFactor) {
          setFactorId(totpFactor.id)
        }
      } catch (err) {
        setError(getErrorMessage(err))
      }
    }
    loadFactor()
  }, [])

  const handleVerify = async () => {
    if (code.length !== 6 || !factorId) return
    
    setLoading(true)
    setError(null)

    try {
      // Import here to avoid circular dependency
      const { createChallenge, verifyChallenge } = await import("@/lib/api/mfa")
      const challenge = await createChallenge(factorId)
      await verifyChallenge(factorId, challenge.challengeId, code)
      onSuccess()
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && code.length === 6) {
      handleVerify()
    }
  }

  return (
    <div className={`max-w-md mx-auto ${darkMode ? 'text-white' : 'text-gray-900'}`}>
      <div className="flex items-center justify-center gap-3 mb-6">
        <div className={`p-3 rounded-full ${darkMode ? 'bg-[#FFD166]/20' : 'bg-yellow-100'}`}>
          <Shield className="w-6 h-6 text-[#FFD166]" />
        </div>
      </div>

      <h2 className="text-xl font-semibold text-center mb-2">Two-Factor Authentication</h2>
      
      <p className={`text-sm text-center mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        Enter the 6-digit code from your authenticator app to continue.
      </p>

      {error && (
        <div className="p-3 mb-4 rounded-lg bg-red-500/10 text-red-500 text-sm text-center">
          {error}
        </div>
      )}

      <Input
        type="text"
        placeholder="000000"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
          setError(null)
        }}
        onKeyPress={handleKeyPress}
        className="text-center text-2xl tracking-widest font-mono h-16 mb-6"
        maxLength={6}
        autoFocus
      />

      <Button
        onClick={handleVerify}
        disabled={loading || code.length !== 6}
        className="w-full bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"
      >
        Verify
      </Button>

      <p className={`text-xs text-center mt-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        Lost your device? Use a recovery code instead.
      </p>
    </div>
  )
}
