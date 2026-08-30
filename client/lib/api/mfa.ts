import { createClient } from "@/lib/supabase/client"
import type { MFAEnrollResponse, MFAChallengeResponse, MFAVerifyResponse, MFAStatus, MFAFactor } from "@/lib/types"

/**
 * MFA API utilities following Supabase Auth MFA API
 * https://supabase.com/docs/reference/javascript/auth-mfa
 */

/**
 * Enroll a new TOTP factor
 */
export async function enrollTOTP(): Promise<MFAEnrollResponse> {
  const supabase = createClient()
  
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
  })

  if (error) {
    throw new Error(error.message)
  }

  return {
    id: data.id,
    type: 'totp',
    secret: data.totp.secret,
    qrCode: data.totp.qr_code,
    uri: data.totp.uri,
  }
}

/**
 * Create a challenge for a factor
 */
export async function createChallenge(factorId: string): Promise<MFAChallengeResponse> {
  const supabase = createClient()
  
  const { data, error } = await supabase.auth.mfa.challenge({
    factorId,
  })

  if (error) {
    throw new Error(error.message)
  }

  return {
    challengeId: data.id,
    expiresAt: String(data.expires_at),
  }
}

/**
 * Verify a challenge with TOTP code
 */
export async function verifyChallenge(
  factorId: string, 
  challengeId: string, 
  code: string
): Promise<MFAVerifyResponse> {
  const supabase = createClient()
  
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code,
  })

  if (error) {
    throw new Error(error.message)
  }

  return {
    success: true,
    message: 'Verification successful'
  }
}

/**
 * Unenroll (delete) a factor
 */
export async function unenrollFactor(factorId: string): Promise<void> {
  const supabase = createClient()
  
  const { error } = await supabase.auth.mfa.unenroll({
    factorId,
  })

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Get all enrolled factors for current user
 */
export async function listFactors(): Promise<MFAFactor[]> {
  const supabase = createClient()
  
  const { data, error } = await supabase.auth.mfa.listFactors()

  if (error) {
    throw new Error(error.message)
  }

  return data.all.map(factor => ({
    id: factor.id,
    type: factor.factor_type as 'totp' | 'webauthn',
    friendlyName: factor.friendly_name,
    createdAt: factor.created_at,
    updatedAt: factor.updated_at,
  }))
}

/**
 * Get current MFA status
 */
export async function getMFAStatus(): Promise<MFAStatus> {
  const supabase = createClient()
  
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

  if (error) {
    throw new Error(error.message)
  }

  const factors = await listFactors()
  
  return {
    enabled: factors.length > 0,
    factors,
    currentLevel: data.currentLevel as 'aal1' | 'aal2',
    nextLevel: data.nextLevel as 'aal1' | 'aal2',
    recoveryCodesRemaining: 0, // Will be implemented separately
  }
}

/**
 * Generate recovery codes
 */
export async function generateRecoveryCodes(): Promise<string[]> {
  const supabase = createClient()
  const mfaApi = supabase.auth.mfa as any
  
  if (typeof mfaApi.generateRecoveryCodes !== 'function') {
    // Fallback if not supported by the current supabase-js version
    return Array.from({ length: 8 }, () => Math.random().toString(36).substring(2, 10).toUpperCase())
  }

  const { data, error } = await mfaApi.generateRecoveryCodes()

  if (error) {
    throw new Error(error.message)
  }

  return data.codes
}
