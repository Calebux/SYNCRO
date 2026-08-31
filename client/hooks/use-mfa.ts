"use client"
import { Toast } from "./use-toast"
import { useState, useCallback, useEffect } from "react"
import { 
  enrollTOTP, 
  createChallenge, 
  verifyChallenge, 
  unenrollFactor, 
  listFactors, 
  getMFAStatus,
  generateRecoveryCodes
} from "@/lib/api/mfa"
import type { MFAEnrollResponse, MFAStatus, MFAFactor } from "@/lib/types"
import { getErrorMessage } from "@/lib/network-utils"

interface UseMFAOptions {
  onToast?: (toast: Omit<Toast, "id">) => void
}

export function useMFA({ onToast }: UseMFAOptions = {}) {
  const [loading, setLoading] = useState(false)
  const [enrollment, setEnrollment] = useState<MFAEnrollResponse | null>(null)
  const [status, setStatus] = useState<MFAStatus | null>(null)
  const [factors, setFactors] = useState<MFAFactor[]>([])
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  /**
   * Load MFA status and factors
   */
  const loadStatus = useCallback(async () => {
    try {
      const [statusData, factorsData] = await Promise.all([
        getMFAStatus(),
        listFactors()
      ])
      setStatus(statusData)
      setFactors(factorsData)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }, [])

  /**
   * Start MFA enrollment flow
   */
  const startEnrollment = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const data = await enrollTOTP()
      setEnrollment(data)
      return data
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      onToast?.({
        title: "Error",
        description: `Failed to start MFA setup: ${message}`,
        variant: "error"
      })
      throw err
    } finally {
      setLoading(false)
    }
  }, [onToast])

  /**
   * Verify and complete enrollment
   */
  const verifyEnrollment = useCallback(async (code: string) => {
    if (!enrollment) {
      throw new Error("No active enrollment")
    }

    setLoading(true)
    setError(null)

    try {
      const challenge = await createChallenge(enrollment.id)
      await verifyChallenge(enrollment.id, challenge.challengeId, code)
      
      // Generate and show recovery codes
      const codes = await generateRecoveryCodes()
      setRecoveryCodes(codes)
      
      // Clear enrollment and reload status
      setEnrollment(null)
      await loadStatus()

      onToast?.({
        title: "MFA Enabled",
        description: "Two-factor authentication has been successfully enabled.",
        variant: "success"
      })

      return codes
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      onToast?.({
        title: "Verification Failed",
        description: message,
        variant: "error"
      })
      throw err
    } finally {
      setLoading(false)
    }
  }, [enrollment, onToast, loadStatus])

  /**
   * Cancel ongoing enrollment
   */
  const cancelEnrollment = useCallback(() => {
    setEnrollment(null)
    setError(null)
  }, [])

  /**
   * Disable MFA
   */
  const disableMFA = useCallback(async (factorId: string) => {
    setLoading(true)
    setError(null)

    try {
      await unenrollFactor(factorId)
      await loadStatus()
      
      onToast?.({
        title: "MFA Disabled",
        description: "Two-factor authentication has been disabled.",
        variant: "success"
      })
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      onToast?.({
        title: "Error",
        description: `Failed to disable MFA: ${message}`,
        variant: "error"
      })
      throw err
    } finally {
      setLoading(false)
    }
  }, [onToast, loadStatus])

  /**
   * Verify MFA for login
   */
  const verifyLogin = useCallback(async (factorId: string, code: string) => {
    setLoading(true)
    setError(null)

    try {
      const challenge = await createChallenge(factorId)
      const result = await verifyChallenge(factorId, challenge.challengeId, code)
      return result
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Clear recovery codes after user has saved them
   */
  const clearRecoveryCodes = useCallback(() => {
    setRecoveryCodes([])
  }, [])

  // Load status on mount
  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  return {
    loading,
    error,
    enrollment,
    status,
    factors,
    recoveryCodes,
    startEnrollment,
    verifyEnrollment,
    cancelEnrollment,
    disableMFA,
    verifyLogin,
    clearRecoveryCodes,
    loadStatus,
  }
}
